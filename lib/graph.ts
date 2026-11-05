// Microsoft Graph client using app-only (client credentials) auth.
// Azure app needs Application permissions: Mail.ReadWrite, Mail.Send (admin consent).
const TENANT = process.env.MS_TENANT_ID!;
const CLIENT_ID = process.env.MS_CLIENT_ID!;
const CLIENT_SECRET = process.env.MS_CLIENT_SECRET!;
export const MAILBOX = process.env.MS_MAILBOX!; // e.g. owner@clientdomain.com

let cached: { token: string; exp: number } | null = null;

async function getToken(): Promise<string> {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const res = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) throw new Error(`Token error: ${await res.text()}`);
  const j = await res.json();
  cached = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return cached.token;
}

export async function graph(path: string, init: RequestInit = {}) {
  const url = path.startsWith("http") ? path : `https://graph.microsoft.com/v1.0${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${await getToken()}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Graph ${res.status}: ${await res.text()}`);
  return res.status === 202 || res.status === 204 ? null : res.json();
}

export async function sendMail(opts: {
  to: string[]; cc?: string[]; subject: string; html: string;
}) {
  const rcpt = (a: string) => ({ emailAddress: { address: a } });
  await graph(`/users/${MAILBOX}/sendMail`, {
    method: "POST",
    body: JSON.stringify({
      message: {
        subject: opts.subject,
        body: { contentType: "HTML", content: opts.html },
        toRecipients: opts.to.map(rcpt),
        ccRecipients: (opts.cc || []).map(rcpt),
      },
      saveToSentItems: true,
    }),
  });
}
