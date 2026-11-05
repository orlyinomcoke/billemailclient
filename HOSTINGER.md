# Deploy MailHub to Hostinger (Node.js app + MySQL)

## 1. Create the MySQL database
hPanel → **Websites → Manage → Databases → MySQL Databases**
- Create a database + user + password. Note the full names (Hostinger prefixes them, e.g. `u123456789_mailhub`).
- Your connection string:
  `mysql://u123456789_mailuser:PASSWORD@localhost:3306/u123456789_mailhub`
  (If the password has special characters like `@ # / :`, URL-encode them, e.g. `@` → `%40`.)

## 2. Create the Node.js app
hPanel → **Websites → Add website → Node.js Apps** (or *Deploy Node.js app*)
- Choose **Upload files** (upload `mailhub.zip`) or **Import from GitHub**.
- Framework: **Next.js** (auto-detected)
- Node version: **20** or **22**
- Build command: `npm run build`
- Start command: `npm start`
- Domain: use the free temporary domain Hostinger gives you.

## 3. Environment variables
Add these in the app's **Environment variables** section (not in a file):

| Name | Value |
|---|---|
| DATABASE_URL | the mysql:// string from step 1 |
| AUTH_SECRET | long random string (e.g. from `openssl rand -hex 32`) |
| CRON_SECRET | another random string |
| MS_TENANT_ID | your-directory-tenant-id |
| MS_CLIENT_ID | your-application-client-id |
| MS_CLIENT_SECRET | the secret **Value** from Azure |
| MS_MAILBOX | owner@clientdomain.com |
| ADMIN_EMAIL | your admin login email |
| ADMIN_PASSWORD | your admin password |

## 4. Deploy
Click **Deploy**. The build creates the database tables automatically (`prisma db push`).

## 5. First login
Open the temp domain → sign in with ADMIN_EMAIL / ADMIN_PASSWORD.
The first login creates the admin account. Then add businesses (＋) and press ⟳.

## 6. Auto-sync every 5 minutes
hPanel → **Advanced → Cron Jobs** → Custom command, every 5 minutes:
```
curl -s -X POST "https://YOUR-TEMP-DOMAIN/api/sync?key=YOUR_CRON_SECRET" > /dev/null
```

## Troubleshooting
- **Build fails at `prisma db push`**: DATABASE_URL is wrong (check prefixed names / encoded password).
- **"Invalid email or password" on first login**: ADMIN_EMAIL/ADMIN_PASSWORD env vars don't match what you typed, or you need to redeploy after adding them.
- **Sync error 403**: Azure admin consent not granted. **401 invalid_client**: wrong secret (use Value, not Secret ID).
- Make sure the site is served over **https** (Hostinger enables SSL on temp domains).
