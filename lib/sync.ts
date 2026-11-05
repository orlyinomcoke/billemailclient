import { db } from "./db";
import { graph, MAILBOX } from "./graph";
import { classifyPending } from "./classify";

const SELECT = "id,conversationId,subject,from,toRecipients,ccRecipients,body,bodyPreview,receivedDateTime,isRead";
const FOLDERS = [
  { id: "inbox", direction: "in" as const },
  { id: "sentitems", direction: "out" as const },
];
const deltaStart = (folder: string) => `/users/${MAILBOX}/mailFolders/${folder}/messages/delta?$select=${SELECT}`;
// A saved link is a finished checkpoint once Graph hands back a deltatoken (vs. a skiptoken mid-import)
const isComplete = (link?: string | null) => !!link && /deltatoken=/i.test(link);

// One sync at a time per server process. Kept on globalThis so dev hot-reloads don't reset it.
const lock = globalThis as unknown as { mailSyncRunning?: boolean };

// Full sync of Inbox + Sent Items using Graph delta queries, so nothing is ever missed.
// - First run imports the whole mailbox; progress is checkpointed after every page,
//   so it resumes where it stopped.
// - Works in chunks of ~budgetMs; returns done:false when there is more to do.
// - Once complete, each run only fetches what changed (new, updated, deleted mail).
export async function syncMailbox(budgetMs = 20_000) {
  if (lock.mailSyncRunning) return { busy: true };
  lock.mailSyncRunning = true;
  const deadline = Date.now() + budgetMs;
  let synced = 0, done = true;
  try {
    const states = await db.syncState.findMany();
    const allComplete = FOLDERS.every(f => isComplete(states.find(s => s.id === f.id)?.deltaLink));
    // While the big import is still running, grab brand-new mail first so it shows up right away
    if (!allComplete) synced += await catchUpNewest();

    // PAUSE_IMPORT=1 in .env: only fetch new mail (above), don't continue importing older mail
    const paused = process.env.PAUSE_IMPORT === "1" && !allComplete;

    for (const f of paused ? [] : FOLDERS) {
      let url: string | null = states.find(s => s.id === f.id)?.deltaLink ?? deltaStart(f.id);
      let reset = false;
      while (url) {
        if (Date.now() > deadline) { done = false; break; }
        let page: any;
        try {
          page = await graph(url, { headers: { Prefer: "odata.maxpagesize=50" } });
        } catch (e: any) {
          // Expired checkpoint: start this folder over (existing rows are upserted, tags kept)
          if (!reset && /Graph 410|SyncStateNotFound|resyncRequired/i.test(e.message)) {
            reset = true; url = deltaStart(f.id); continue;
          }
          throw e;
        }
        for (const m of page.value) {
          if (m["@removed"]) { await db.message.deleteMany({ where: { graphId: m.id } }); continue; }
          await upsertMessage(m, f.direction);
          synced++;
        }
        const next: string | null = page["@odata.nextLink"] ?? null;
        const checkpoint = next ?? page["@odata.deltaLink"];
        if (checkpoint) await db.syncState.upsert({
          where: { id: f.id }, create: { id: f.id, deltaLink: checkpoint }, update: { deltaLink: checkpoint },
        });
        url = next;
      }
      if (!done) break;
    }
    // Sort newly synced mail into Inbox / Newsletters / Auto-replies
    const classifyUntil = Date.now() + 30_000;
    while (Date.now() < classifyUntil && (await classifyPending()).remaining > 0);
  } finally {
    lock.mailSyncRunning = false;
  }
  return { synced, done, total: await db.message.count() };
}

// Fetch mail newer than the newest message already saved (per folder), newest first.
async function catchUpNewest() {
  let n = 0;
  for (const f of FOLDERS) {
    const newest = await db.message.findFirst({
      where: { direction: f.direction }, orderBy: { receivedAt: "desc" }, select: { receivedAt: true },
    });
    const since = new Date((newest?.receivedAt.getTime() ?? Date.now() - 86_400_000) - 10 * 60_000).toISOString();
    let url: string | null = `/users/${MAILBOX}/mailFolders/${f.id}/messages?$select=${SELECT}` +
      `&$filter=receivedDateTime ge ${since}&$orderby=receivedDateTime desc&$top=25`;
    while (url) {
      const page: any = await graph(url);
      for (const m of page.value) { await upsertMessage(m, f.direction); n++; }
      url = page["@odata.nextLink"] ?? null;
    }
  }
  return n;
}

// Test mode: fetch only the newest `n` messages across Inbox + Sent Items (newest first),
// then drop any other cached messages that aren't tagged with a business.
// Does not touch the delta checkpoints used by the full sync.
export async function syncLatest(n: number) {
  const all: { m: any; direction: "in" | "out" }[] = [];
  for (const f of FOLDERS) {
    let url: string | null =
      `/users/${MAILBOX}/mailFolders/${f.id}/messages?$select=${SELECT}&$orderby=receivedDateTime desc&$top=25`;
    let got = 0;
    while (url && got < n) {
      const page: any = await graph(url);
      for (const m of page.value) all.push({ m, direction: f.direction });
      got += page.value.length;
      url = page["@odata.nextLink"] ?? null;
    }
  }
  const newest = all
    .sort((a, b) => +new Date(b.m.receivedDateTime) - +new Date(a.m.receivedDateTime))
    .slice(0, n);
  for (const { m, direction } of newest) await upsertMessage(m, direction);

  const keep = newest.map(x => x.m.id);
  const removed = await db.message.deleteMany({ where: { graphId: { notIn: keep }, businessId: null } });
  await db.contact.deleteMany({ where: { messages: { none: {} }, doNotContact: false, businessId: null } });
  return { synced: newest.length, removed: removed.count };
}

async function upsertMessage(m: any, direction: "in" | "out") {
  const from = m.from?.emailAddress ?? {};
  const addrs = (list: any[] | undefined): string[] =>
    (list ?? []).map((r: any) => r?.emailAddress?.address?.toLowerCase()).filter(Boolean);
  const to = addrs(m.toRecipients);
  const cc = addrs(m.ccRecipients);
  const otherEmail = direction === "in" ? from.address?.toLowerCase() : to[0];
  const otherName = direction === "in" ? from.name : undefined;

  let contactId: string | null = null, businessId: string | null = null;
  if (otherEmail) {
    const c = await db.contact.upsert({
      where: { email: otherEmail },
      create: { email: otherEmail, name: otherName },
      update: otherName ? { name: otherName } : {},
    });
    contactId = c.id; businessId = c.businessId; // inherit contact's default business
  }

  const data = {
    conversationId: m.conversationId, subject: m.subject || "(no subject)",
    fromEmail: from.address?.toLowerCase() ?? "", fromName: from.name,
    toEmails: to, ccEmails: cc, bodyHtml: m.body?.content ?? "",
    preview: m.bodyPreview ?? "", receivedAt: new Date(m.receivedDateTime),
    isRead: !!m.isRead, direction, contactId,
  };
  await db.message.upsert({
    where: { graphId: m.id },
    create: { graphId: m.id, ...data, businessId },
    update: data, // keep business assigned in app
  });
}
