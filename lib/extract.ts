// Fills in contact details (first/last name, phone, company) from data we already have:
// display names, email addresses, and the signatures of emails they sent.
// Only fills blank fields, so anything edited by hand is never overwritten.
import { db } from "./db";

// Addresses that are almost always automated senders (used by the "hide automated" filter)
export const AUTOMATED = ["noreply", "no-reply", "donotreply", "do-not-reply", "notification", "mailer-daemon", "postmaster", "bounce"];

// Personal email providers: the domain says nothing about the company
const FREE_MAIL = /^(gmail|googlemail|yahoo|ymail|rocketmail|hotmail|outlook|live|msn|icloud|me|mac|aol|proton|protonmail|pm|gmx|mail|zoho|yandex|qq|163|bigpond|optusnet|iinet|tpg|internode|comcast|verizon|att|sbcglobal|btinternet)\./i;

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s);

export function splitName(name: string | null | undefined, email: string) {
  let n = (name || "").replace(/["'“”]/g, "").replace(/\(.*?\)|\[.*?\]|<.*?>/g, "").trim();
  if (n.includes("@")) n = "";
  // "Bondoc, Orly" → first Orly, last Bondoc
  if (n.includes(",")) {
    const [last, first] = n.split(",", 2).map(s => s.trim());
    if (first && last) return { firstName: first, lastName: last };
  }
  const words = n.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return { firstName: words[0], lastName: words.slice(1).join(" ") };
  if (words.length === 1) return { firstName: words[0], lastName: null };
  // No display name: try "orly.bondoc@…"
  const parts = email.split("@")[0].split(/[._-]+/).filter(p => /^[a-z]{2,}$/i.test(p));
  if (parts.length >= 2) return { firstName: cap(parts[0]), lastName: cap(parts[parts.length - 1]) };
  return { firstName: null, lastName: null };
}

// "jane@acme-builders.com.au" → "Acme Builders"; personal providers → null
export function companyFromEmail(email: string) {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain || FREE_MAIL.test(domain)) return null;
  const labels = domain.split(".");
  labels.pop(); // TLD
  if (labels.length > 1 && ["co", "com", "net", "org", "gov", "edu", "ac", "or", "ne"].includes(labels[labels.length - 1])) labels.pop();
  const core = labels[labels.length - 1];
  return core ? core.split("-").filter(Boolean).map(cap).join(" ") : null;
}

export function htmlToText(html: string) {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d|table|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/[ \t ]+/g, " ")
    .split("\n").map(l => l.trim()).filter(Boolean).join("\n");
}

// Drop quoted replies/forwards so we only read the sender's own text and signature
export function cutQuoted(text: string) {
  const markers = [
    /^\*?From:\*?\s.+/im, /^On [\s\S]{0,300}?wrote:/im, /-{2,}\s*Original Message\s*-{2,}/i,
    /^_{8,}\s*$/m, /^>/m, /^Sent from my /im, /^Get Outlook for /im,
  ];
  let end = text.length;
  for (const re of markers) {
    const m = re.exec(text);
    if (m && m.index > 0 && m.index < end) end = m.index;
  }
  return text.slice(0, end);
}

const PHONE_LABEL = /(tel|telephone|phone|ph|mob|mobile|cell|direct|office|work|landline|whatsapp|viber|\b[mtpw])\s*[:.#]?\s*$/i;
const CANDIDATE = /\+?\(?\d[\d\s().-]{6,20}\d/g;

// Phone-shaped values on one line that look like real phone numbers, with a confidence score
function phonesOnLine(line: string, exclude: Set<string>) {
  const out: { v: string; digits: string; score: number }[] = [];
  for (const m of line.matchAll(CANDIDATE)) {
    const raw = m[0].trim();
    const digits = raw.replace(/\D/g, "");
    if (digits.length < 8 || digits.length > 15) continue;
    if (/^\d{4}[-.]\d{2}[-.]\d{2}$|^\d{1,2}[-.]\d{1,2}[-.]\d{2,4}$/.test(raw)) continue; // dates
    const before = line.slice(Math.max(0, (m.index ?? 0) - 20), m.index);
    if (/fax/i.test(before)) continue;
    if (exclude.has(digits)) continue; // the mailbox owner's own number
    const labeled = PHONE_LABEL.test(before);
    const formatted = raw.startsWith("+") || /[\s().-]/.test(raw);
    if (!labeled && !formatted) continue; // bare digit runs are usually order/reference numbers
    out.push({ v: raw.replace(/\s+/g, " "), digits, score: (labeled ? 3 : 0) + (raw.startsWith("+") ? 1 : 0) });
  }
  return out;
}

// Looks at the last lines (the signature area) for something phone-shaped
export function findPhone(text: string, exclude: Set<string> = new Set()) {
  let best: { v: string; score: number } | null = null;
  for (const line of text.split("\n").slice(-25))
    for (const p of phonesOnLine(line, exclude)) if (!best || p.score > best.score) best = p;
  return best?.v ?? null;
}

// Every distinct phone number anywhere in the text, most confident first
export function findAllPhones(text: string, exclude: Set<string> = new Set(), max = 4) {
  const found = new Map<string, { v: string; score: number }>();
  for (const line of text.split("\n"))
    for (const p of phonesOnLine(line, exclude)) if (!found.has(p.digits)) found.set(p.digits, p);
  return [...found.values()].sort((a, b) => b.score - a.score).slice(0, max).map(p => p.v);
}

const lock = globalThis as unknown as { contactExtractRunning?: boolean };

// Processes up to `limit` contacts that haven't been scanned yet.
export async function extractBatch(limit = 300) {
  if (lock.contactExtractRunning) return { busy: true };
  lock.contactExtractRunning = true;
  try {
    const contacts = await db.contact.findMany({ where: { extractedAt: null }, take: limit });
    const own = contacts.length ? await ownPhones() : new Set<string>();
    for (const c of contacts) {
      const { firstName, lastName } = splitName(c.name, c.email);
      let phone: string | null = null;
      if (!c.phone) {
        const msgs = await db.message.findMany({
          where: { contactId: c.id, direction: "in" }, orderBy: { receivedAt: "desc" }, take: 5, select: { bodyHtml: true },
        });
        for (const m of msgs) {
          phone = findPhone(cutQuoted(htmlToText(m.bodyHtml)), own);
          if (phone) break;
        }
      }
      await db.contact.update({
        where: { id: c.id },
        data: {
          firstName: c.firstName ?? firstName,
          lastName: c.lastName ?? lastName,
          phone: c.phone ?? phone,
          company: c.company ?? companyFromEmail(c.email),
          extractedAt: new Date(),
        },
      });
    }
    const remaining = await db.contact.count({ where: { extractedAt: null } });
    return { processed: contacts.length, remaining };
  } finally {
    lock.contactExtractRunning = false;
  }
}

// Numbers in the mailbox owner's own signature (from their sent mail). These show up inside
// quoted replies from other people, so they must never be assigned to a contact.
export async function ownPhones() {
  const sent = await db.message.findMany({
    where: { direction: "out" }, orderBy: { receivedAt: "desc" }, take: 100, select: { bodyHtml: true },
  });
  const seen = new Map<string, number>();
  for (const m of sent) {
    const text = cutQuoted(htmlToText(m.bodyHtml));
    for (const match of text.matchAll(CANDIDATE)) {
      const d = match[0].replace(/\D/g, "");
      if (d.length >= 8 && d.length <= 15) seen.set(d, (seen.get(d) ?? 0) + 1);
    }
  }
  // Anything that repeats across several sent emails is a signature number
  return new Set([...seen].filter(([, n]) => n >= 3).map(([d]) => d));
}
