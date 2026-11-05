# MailHub — Phase 1

Web inbox for a Microsoft 365 mailbox: per-person folders, business categories, sending, and Do-Not-Contact.

## 1. Azure setup (once, needs the client's M365 admin)
1. entra.microsoft.com → App registrations → New registration ("MailHub").
2. API permissions → Microsoft Graph → **Application**: `Mail.ReadWrite`, `Mail.Send` → **Grant admin consent**.
3. Certificates & secrets → New client secret.
4. Copy Tenant ID, Client ID, secret into `.env`.
5. Recommended: restrict the app to only the client's mailbox with an Exchange
   Application Access Policy (`New-ApplicationAccessPolicy`).

## 2. Run
```bash
cp .env.example .env   # fill in
npm install
npm run db:push
npm run db:seed        # creates the admin login
npm run dev
```
Sign in, add businesses (＋ in sidebar), press ⟳ to sync.

## 3. Auto-sync
Hit `POST /api/sync?key=CRON_SECRET` every few minutes (Vercel Cron, or system cron with curl).

## How it works
- **People folders**: every external address becomes a Contact; click one to see only their mail.
- **Business category**: set per email, or "Apply to all mail from this person" so their future mail auto-tags.
- **Do Not Contact**: flagged people show a red DNC tag; the send API refuses any email to them.
- Categories/DNC live only in this app's database — Outlook itself is untouched.
- Adding staff: insert users (role STAFF) — a user admin screen is a good Phase 2 item.
