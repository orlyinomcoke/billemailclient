import { db } from "./db";
import { graph, MAILBOX } from "./graph";

const SELECT = "id,conversationId,subject,from,toRecipients,ccRecipients,body,bodyPreview,receivedDateTime,isRead";

// Pulls new/changed mail from Inbox and Sent Items using Graph delta queries.
// Each external address becomes a Contact (its own "folder").
export async function syncMailbox() {
  let count = 0;
  for (const folder of ["inbox", "sentitems"]) {
    const state = await db.syncState.findUnique({ where: { id: folder } });
    let url: string | null = state?.deltaLink ??
      `/users/${MAILBOX}/mailFolders/${folder}/messages/delta?$select=${SELECT}`;
    let deltaLink: string | null = null;

    while (url) {
      const page: any = await graph(url, { headers: { Prefer: "odata.maxpagesize=50" } });
      for (const m of page.value) {
        if (m["@removed"]) { await db.message.deleteMany({ where: { graphId: m.id } }); continue; }
        await upsertMessage(m, folder === "sentitems" ? "out" : "in");
        count++;
      }
      url = page["@odata.nextLink"] ?? null;
      deltaLink = page["@odata.deltaLink"] ?? deltaLink;
    }
    if (deltaLink) await db.syncState.upsert({
      where: { id: folder }, create: { id: folder, deltaLink }, update: { deltaLink },
    });
  }
  return count;
}

async function upsertMessage(m: any, direction: "in" | "out") {
  const from = m.from?.emailAddress ?? {};
  const to = (m.toRecipients ?? []).map((r: any) => r.emailAddress.address.toLowerCase());
  const cc = (m.ccRecipients ?? []).map((r: any) => r.emailAddress.address.toLowerCase());
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
