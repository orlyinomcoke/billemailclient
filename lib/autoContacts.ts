// "Contacts from Auto Replies": out-of-office replies often name someone else to contact
// ("please email jane@acme.com or call +1 555 …"). This scans auto-replies for those emails and
// phone numbers and stores them on the sender's contact (autoEmails / autoPhones).
// Only blank-or-new values are added; anything typed by hand is kept.
import { db } from "./db";
import { htmlToText, cutQuoted, findAllPhones, ownPhones } from "./extract";

// Bounce / system senders: their "auto-replies" are delivery failures, not people
export const SYSTEM_SENDER_PREFIXES = ["mailer-daemon", "postmaster", "microsoftexchange", "noreply", "no-reply", "donotreply", "do-not-reply"];
const isSystemSender = (email: string) => SYSTEM_SENDER_PREFIXES.some(p => email.toLowerCase().startsWith(p));

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,24}\b/gi;

export function extractFromAutoReply(html: string, sender: string, owner: string, ownNumbers: Set<string>) {
  const text = cutQuoted(htmlToText(html));
  const emails = [...new Set((text.match(EMAIL) ?? []).map(e => e.toLowerCase().replace(/\.+$/, "")))]
    .filter(e => e !== sender && e !== owner && !isSystemSender(e))
    .filter(e => !/\.(png|jpe?g|gif|bmp|webp)@/i.test(e)); // inline image ids look like emails
  const phones = findAllPhones(text, ownNumbers);
  return { emails: emails.slice(0, 5), phones };
}

// Append new values to a comma-separated list, skipping duplicates
function merge(existing: string | null, add: string[], key: (v: string) => string) {
  const list = (existing ?? "").split(/\s*,\s*/).filter(Boolean);
  const seen = new Set(list.map(key));
  for (const v of add) if (!seen.has(key(v))) { seen.add(key(v)); list.push(v); }
  return list.length ? list.join(", ") : null;
}

const lock = globalThis as unknown as { autoScanRunning?: boolean };

// Scan auto-replies that haven't been scanned yet, in batches
export async function scanAutoReplies(limit = 500) {
  if (lock.autoScanRunning) return { busy: true as const };
  lock.autoScanRunning = true;
  try {
    const msgs = await db.message.findMany({
      where: { category: "auto", autoScanned: false }, orderBy: { receivedAt: "asc" }, take: limit,
      select: { id: true, bodyHtml: true, fromEmail: true, contactId: true },
    });
    if (!msgs.length) return { processed: 0, remaining: 0 };
    const own = await ownPhones();
    const owner = (process.env.MS_MAILBOX ?? "").toLowerCase();

    const found = new Map<string, { emails: string[]; phones: string[] }>();
    for (const m of msgs) {
      if (!m.contactId || isSystemSender(m.fromEmail)) continue;
      const r = extractFromAutoReply(m.bodyHtml, m.fromEmail.toLowerCase(), owner, own);
      if (!r.emails.length && !r.phones.length) continue;
      const acc = found.get(m.contactId) ?? { emails: [], phones: [] };
      acc.emails.push(...r.emails); acc.phones.push(...r.phones);
      found.set(m.contactId, acc);
    }
    for (const [id, r] of found) {
      const c = await db.contact.findUnique({ where: { id }, select: { autoEmails: true, autoPhones: true } });
      if (!c) continue;
      await db.contact.update({
        where: { id },
        data: {
          autoEmails: merge(c.autoEmails, r.emails, v => v.toLowerCase()),
          autoPhones: merge(c.autoPhones, r.phones, v => v.replace(/\D/g, "")),
        },
      });
    }
    await db.message.updateMany({ where: { id: { in: msgs.map(m => m.id) } }, data: { autoScanned: true } });
    const remaining = await db.message.count({ where: { category: "auto", autoScanned: false } });
    return { processed: msgs.length, remaining };
  } finally {
    lock.autoScanRunning = false;
  }
}
