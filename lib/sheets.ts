// Keeps a Google Sheet tab ("Auto Reply Contacts") in sync with Contacts from Auto Replies.
// Auth: a Google Cloud service account (JSON key) that has been given Editor access to the sheet.
//   GOOGLE_SERVICE_ACCOUNT_JSON = the key file contents (raw JSON or base64 of it)
//   GOOGLE_SHEET_ID             = the sheet's ID or its full URL
// The tab is rewritten in full on each push, so the sheet always mirrors the app (the app is the source of truth).
import { SignJWT, importPKCS8 } from "jose";
import { db } from "./db";
import { autoContactWhere } from "./autoContacts";

const TAB = "Auto Reply Contacts";
const HEADERS = [
  "Auto-reply email", "First name", "Last name", "Full name", "Extracted email", "Extracted phone number",
  "Company", "Business", "Do not contact", "Do not contact reason",
];

type ServiceAccount = { client_email: string; private_key: string };
const state = globalThis as unknown as {
  sheet?: { token?: string; exp?: number; timer?: ReturnType<typeof setTimeout>; pushing?: boolean; again?: boolean;
            lastPushedAt?: string; lastError?: string; rows?: number };
};
const s = (state.sheet ??= {});

function serviceAccount(): ServiceAccount | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;
  try {
    const j = JSON.parse(raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8"));
    return j.client_email && j.private_key ? { client_email: j.client_email, private_key: String(j.private_key).replace(/\\n/g, "\n") } : null;
  } catch { return null; }
}
function sheetId() {
  const raw = process.env.GOOGLE_SHEET_ID?.trim();
  return raw ? (raw.match(/\/d\/([a-zA-Z0-9_-]+)/)?.[1] ?? raw) : null;
}
export const sheetConfigured = () => !!(serviceAccount() && sheetId());

async function token() {
  if (s.token && (s.exp ?? 0) > Date.now() + 60_000) return s.token;
  const sa = serviceAccount()!;
  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({ scope: "https://www.googleapis.com/auth/spreadsheets" })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(sa.client_email).setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt(now).setExpirationTime(now + 3600)
    .sign(await importPKCS8(sa.private_key, "RS256"));
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`Google sign-in failed: ${j.error_description || j.error || r.status}`);
  s.token = j.access_token; s.exp = Date.now() + j.expires_in * 1000;
  return s.token!;
}

async function gapi(path: string, init: RequestInit = {}) {
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId()}${path}`, {
    ...init, headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = j?.error?.message || `HTTP ${r.status}`;
    if (r.status === 403) throw new Error(`No access to the sheet — share it with ${serviceAccount()?.client_email} as Editor (${msg})`);
    if (r.status === 404) throw new Error(`Sheet not found — check GOOGLE_SHEET_ID (${msg})`);
    throw new Error(`Google Sheets error: ${msg}`);
  }
  return j;
}

const range = (a1: string) => encodeURIComponent(`'${TAB}'!${a1}`);

// Create the tab (with a bold, frozen header row) if it doesn't exist yet
async function ensureTab() {
  const meta = await gapi(`?fields=sheets.properties(sheetId,title)`);
  if (meta.sheets?.some((x: any) => x.properties.title === TAB)) return;
  const add = await gapi(`:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: TAB, gridProperties: { frozenRowCount: 1 } } } }] }),
  });
  const id = add.replies?.[0]?.addSheet?.properties?.sheetId;
  await gapi(`:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({ requests: [{
      repeatCell: {
        range: { sheetId: id, startRowIndex: 0, endRowIndex: 1 },
        cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.93, green: 0.95, blue: 1 } } },
        fields: "userEnteredFormat(textFormat,backgroundColor)",
      },
    }] }),
  });
}

// Rewrite the tab with the current list. Safe to call often; concurrent calls are coalesced.
export async function pushAutoContacts() {
  if (!sheetConfigured()) return { configured: false as const };
  if (s.pushing) { s.again = true; return { queued: true as const }; }
  s.pushing = true;
  try {
    const contacts = await db.contact.findMany({
      where: autoContactWhere(true) as any, orderBy: { email: "asc" },
      select: {
        email: true, firstName: true, lastName: true, name: true, autoEmails: true, autoPhones: true,
        company: true, doNotContact: true, dncReason: true, business: { select: { name: true } },
      },
    });
    const values = [HEADERS, ...contacts.map(c => [
      c.email, c.firstName ?? "", c.lastName ?? "", c.name ?? "", c.autoEmails ?? "", c.autoPhones ?? "",
      c.company ?? "", c.business?.name ?? "", c.doNotContact ? "Yes" : "No", c.doNotContact ? c.dncReason ?? "" : "",
    ])];
    await ensureTab();
    // RAW keeps values exactly as text (phone numbers stay "+1 …", nothing is treated as a formula)
    await gapi(`/values/${range("A1")}?valueInputOption=RAW`, { method: "PUT", body: JSON.stringify({ values }) });
    await gapi(`/values/${range(`A${values.length + 1}:Z`)}:clear`, { method: "POST", body: "{}" }); // drop leftover rows
    s.lastPushedAt = new Date().toISOString(); s.lastError = undefined; s.rows = contacts.length;
    return { ok: true as const, rows: contacts.length };
  } catch (e: any) {
    s.lastError = String(e?.message ?? e);
    console.error("Google Sheet sync failed:", s.lastError);
    return { ok: false as const, error: s.lastError };
  } finally {
    s.pushing = false;
    if (s.again) { s.again = false; scheduleSheetPush(2000); }
  }
}

// Debounced push: many edits in a row become one update a few seconds later
export function scheduleSheetPush(delayMs = 8000) {
  if (!sheetConfigured()) return;
  if (s.timer) clearTimeout(s.timer);
  s.timer = setTimeout(() => { s.timer = undefined; pushAutoContacts(); }, delayMs);
}

export function sheetStatus() {
  const id = sheetId();
  return {
    configured: sheetConfigured(),
    url: id ? `https://docs.google.com/spreadsheets/d/${id}/edit` : null,
    serviceAccount: serviceAccount()?.client_email ?? null,
    lastPushedAt: s.lastPushedAt ?? null, lastError: s.lastError ?? null, rows: s.rows ?? null,
    pending: !!s.timer || !!s.pushing,
  };
}
