// Imports only the auto-replies (out-of-office etc.) from the whole Inbox history, without
// importing the rest of the mailbox. Resumable: the next page link is saved after every page,
// so it continues where it stopped on the next /api/sync call (browser or cron).
// Brand-new auto-replies keep arriving through the normal sync, so this only has to run once.
import { db } from "./db";
import { graph, MAILBOX } from "./graph";
import { SELECT, upsertMessage } from "./sync";
import { classifyPending } from "./classify";

const ID = "autoreplies";
const SCOPE = "auto-v1";
const DONE = "DONE";
// Subjects that classify.ts files under Auto-replies
const PREFIXES = ["Automatic reply", "Auto reply", "Auto-reply", "Autoreply", "Auto Response", "Automatic response", "Out of Office"];
const start = () => `/users/${MAILBOX}/mailFolders/inbox/messages?$select=${SELECT}&$top=50&$filter=` +
  encodeURIComponent(PREFIXES.map(p => `startswith(subject,'${p}')`).join(" or "));

const lock = globalThis as unknown as { autoImportRunning?: boolean };

export async function importAutoReplies(budgetMs = 20_000) {
  const state = await db.syncState.findUnique({ where: { id: ID } });
  const saved = state?.scope === SCOPE ? state.deltaLink : null;
  if (saved === DONE) return { done: true, imported: 0 };
  if (lock.autoImportRunning) return { busy: true as const };
  lock.autoImportRunning = true;
  const deadline = Date.now() + budgetMs;
  let url: string | null = saved ?? start(), imported = 0;
  try {
    while (url && Date.now() < deadline) {
      const page: any = await graph(url);
      for (const m of page.value) { await upsertMessage(m, "in"); imported++; }
      url = page["@odata.nextLink"] ?? null;
      const link = url ?? DONE;
      await db.syncState.upsert({
        where: { id: ID }, create: { id: ID, deltaLink: link, scope: SCOPE }, update: { deltaLink: link, scope: SCOPE },
      });
    }
    // File them under Auto-replies now so the contact scan picks them up in the same request
    const until = Date.now() + 10_000;
    while (Date.now() < until && (await classifyPending()).remaining > 0);
  } finally {
    lock.autoImportRunning = false;
  }
  return { done: !url, imported };
}
