// Sorts incoming mail into: "inbox" (real email), "newsletter" (bulk / marketing / notifications),
// or "auto" (out-of-office replies, bounces, read receipts).
// Only this app's database is changed; Outlook folders are never touched.
import { db } from "./db";
import { htmlToText } from "./extract";

export type Category = "inbox" | "newsletter" | "auto";

const AUTO_SUBJECT = /^\s*(automatic reply|auto(matic)?[- ]?(reply|response)|autoreply|out of (the )?office|ooo\b|undeliverable|undelivered mail|delivery (status notification|has failed|failure|incomplete|delayed)|mail delivery (failed|subsystem)|returned mail|failure notice|read:|not read:|delivered:|recall:)/i;
const AUTO_SENDER = /^(mailer-daemon|postmaster|microsoftexchange[0-9a-f]*)@/i;
const OOO_BODY = /\b(out of (the )?office|on (annual |parental |maternity |sick )?leave|away from (the |my )?(office|desk)|limited access to (my )?e-?mail|currently (away|travell?ing|unavailable)|will (be )?(back|returning) on)\b/i;
const BULK_SENDER = /(^|[._+-])(no-?reply|do-?not-?reply|newsletters?|news|marketing|promo(tions?)?|offers|deals|mailer|mailings?|notifications?|notify|alerts?|updates?|digest|campaigns?|bounces?|info-?mail)([._+-]|@)/i;
const BULK_BODY = /unsubscribe|opt[- ]?out|(manage|update) (your )?(email |e-mail |subscription |notification |communication )?preferences|email preferences|view (this|it) (email |e-mail )?in (a|your) (web )?browser|view (this email |it )?online|you are receiving this|you('re| are) receiving this (email|message|because)|to stop receiving/i;

// Part of a real conversation (reply/forward) or a calendar response from a person
const REPLY_SUBJECT = /^\s*(re|fw|fwd|aw|sv|tr|wg)\s*:/i;
const CALENDAR_SUBJECT = /^\s*(accepted|declined|tentative(ly accepted)?|invitation|updated invitation|new event|canceled event|cancelled|proposed new time)\b/i;

type Msg = { direction: string; subject: string; fromEmail: string; bodyHtml: string };
type Ctx = { rule: string | null | undefined; corresponded: boolean };

export function classify(m: Msg, ctx: Ctx): Category {
  if (m.direction === "out") return "inbox";
  if (AUTO_SENDER.test(m.fromEmail) || AUTO_SUBJECT.test(m.subject)) return "auto";
  // Short message that reads like an out-of-office, even without the usual subject
  const text = htmlToText(m.bodyHtml.slice(0, 20_000));
  if (text.length < 1200 && OOO_BODY.test(text.slice(0, 500))) return "auto";

  if (ctx.rule === "inbox" || ctx.rule === "newsletter") return ctx.rule; // manual override wins
  if (ctx.corresponded) return "inbox"; // anyone the owner has emailed is a real contact
  const bulkSender = BULK_SENDER.test(m.fromEmail);
  if (!bulkSender && (REPLY_SUBJECT.test(m.subject) || CALENDAR_SUBJECT.test(m.subject))) return "inbox";
  if (bulkSender) return "newsletter";
  if (BULK_BODY.test(m.bodyHtml)) return "newsletter";
  return "inbox";
}

// Classify messages that haven't been sorted yet (existing mail), in batches
export async function classifyPending(limit = 1000) {
  const msgs = await db.message.findMany({
    where: { category: null }, take: limit,
    select: { id: true, direction: true, subject: true, fromEmail: true, bodyHtml: true, contactId: true },
  });
  if (!msgs.length) return { classified: 0, remaining: 0 };
  const ids = [...new Set(msgs.map(m => m.contactId).filter(Boolean))] as string[];
  const [contacts, sent] = await Promise.all([
    db.contact.findMany({ where: { id: { in: ids } }, select: { id: true, mailRule: true } }),
    db.message.groupBy({ by: ["contactId"], where: { contactId: { in: ids }, direction: "out" } }),
  ]);
  const rule = new Map(contacts.map(c => [c.id, c.mailRule]));
  const corresponded = new Set(sent.map(s => s.contactId));
  const groups: Record<Category, string[]> = { inbox: [], newsletter: [], auto: [] };
  for (const m of msgs) {
    const cat = classify(m, { rule: m.contactId ? rule.get(m.contactId) : null, corresponded: corresponded.has(m.contactId) });
    groups[cat].push(m.id);
  }
  for (const cat of Object.keys(groups) as Category[])
    if (groups[cat].length) await db.message.updateMany({ where: { id: { in: groups[cat] } }, data: { category: cat } });
  // People the owner has emailed are real contacts: pull their mail out of Newsletters
  const wrote = [...new Set(msgs.filter(m => m.direction === "out" && m.contactId).map(m => m.contactId!))];
  if (wrote.length) await db.message.updateMany({
    where: { contactId: { in: wrote }, direction: "in", category: "newsletter", contact: { mailRule: null } },
    data: { category: "inbox" },
  });
  const remaining = await db.message.count({ where: { category: null } });
  return { classified: msgs.length, remaining };
}
