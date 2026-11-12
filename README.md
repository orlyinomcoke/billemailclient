# MailHub

Web inbox for a Microsoft 365 mailbox: business tags, Do-Not-Contact, Contacts table,
and automatic sorting of newsletters and auto-replies. Next.js 15 + Prisma + MySQL.

## Deploying on Hostinger (web / cloud hosting)

### 1. Create the database
hPanel → **Databases → MySQL Databases** → create a database and user. Note the database name,
user, password and host (usually `localhost`).

### 2. Create the Node.js app
hPanel → **Websites → Add website → Node.js app** → **Import from GitHub** → pick this repo, branch `main`.

| Setting | Value |
|---|---|
| Node version | 20 or 22 |
| Build command | `npm run build` |
| Start command | `npm start` |

### 3. Environment variables
Add these in the app's **Environment variables** section:

| Name | Value |
|---|---|
| `DATABASE_URL` | `mysql://USER:PASSWORD@HOST:3306/DATABASE` (URL-encode special characters in the password) |
| `AUTH_SECRET` | long random string (`openssl rand -hex 32`) |
| `CRON_SECRET` | another long random string |
| `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET` | from the Azure app registration |
| `MS_MAILBOX` | the mailbox address, e.g. `owner@clientdomain.com` |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | first admin login (created automatically on first start) |
| `PAUSE_IMPORT` | `0` to import the whole mailbox, `1` to only sync new mail |

During the build, the app creates/updates its database tables and the admin login automatically
(`prisma db push` + `prisma/seed.mjs`), so no manual database steps are needed.

After deploying, open `https://YOUR-SITE/api/health` — it reports whether the database connects,
the tables exist, an admin exists, and which environment variables are set (yes/no only).

### 4. Keep mail syncing when nobody has the app open
hPanel → **Advanced → Cron Jobs** → every minute (or every 5 minutes):
```
curl -s -X POST "https://YOUR-SITE/api/sync?key=YOUR_CRON_SECRET"
```
Each call imports ~20 seconds' worth of mail; while someone has the app open it also syncs every 2 minutes.

### 5. Updates
Push to `main` on GitHub, then redeploy from hPanel (or enable auto-deploy).

## Google Sheet for Contacts from Auto Replies (optional)
MailHub can keep a tab named **Auto Reply Contacts** in a Google Sheet up to date (people whose
auto-replies contained other emails/phone numbers). It updates after new auto-replies are scanned,
a few seconds after any edit in the app, and on **Sync now**. The app is the source of truth:
the tab is rewritten on each update, so edit in MailHub, not in the sheet.

1. console.cloud.google.com → create a project → **APIs & Services → Library → Google Sheets API → Enable**.
2. **IAM & Admin → Service Accounts → Create service account** (no roles needed) →
   open it → **Keys → Add key → Create new key → JSON** (downloads a .json file).
3. Create the Google Sheet → **Share** → add the service account's email (…@….iam.gserviceaccount.com) as **Editor**.
4. Environment variables:
   - `GOOGLE_SERVICE_ACCOUNT_JSON` — the key file contents, base64-encoded on one line (`base64 -i key.json`)
   - `GOOGLE_SHEET_ID` — the sheet's URL or ID

## Azure setup (once, needs the client's M365 admin)
1. entra.microsoft.com → App registrations → New registration ("MailHub").
2. API permissions → Microsoft Graph → **Application**: `Mail.ReadWrite`, `Mail.Send` → **Grant admin consent**.
3. Certificates & secrets → New client secret → copy the **Value**.
4. Recommended: restrict the app to the one mailbox with an Exchange Application Access Policy
   (`New-ApplicationAccessPolicy`).

## Local development
```bash
cp .env.example .env   # fill in; needs a local MySQL
npm install
npm run dev
```

## How it works
- **Sync**: Microsoft Graph delta queries over Inbox + Sent Items; resumable, so nothing is missed.
  Microsoft's message IDs are case-sensitive, so they are stored with a SHA-256 key (MySQL compares text case-insensitively).
- **Folders**: Inbox (real email), Sent, Newsletters, Auto-replies, Assigned / Unassigned, per-business.
  Anyone the owner has emailed always lands in Inbox; "Move to Inbox/Newsletters" sets a rule for that sender.
- **Contacts**: names, phone (from signatures), company (from domain), status, business, Do-Not-Contact.
- **Do Not Contact**: the send API refuses any To/Cc recipient flagged DNC (HTTP 409).
- Tags, folders and DNC live only in this app's database; the Outlook mailbox is never modified (except mail sent).
