# Supabase Setup Guide (Free Plan)

Supabase provides the PostgreSQL database. The free plan is enough to run this app.

## 1. Create the project
1. Sign up at [supabase.com](https://supabase.com) and click **New project**.
2. Choose an **organization**, a **project name** (e.g. `daraz-ledger`), and set a
   strong **Database Password** — save it, you'll need it.
3. Pick a **Region** close to you (ideally the same region you'll pick on Vercel).
4. Plan: **Free**. Click **Create new project** and wait ~2 minutes.

## 2. Get the two connection strings
Go to **Project → Settings → Database → Connection string**.

You need **two** URLs (this app uses connection pooling for Vercel's serverless
functions and a direct connection for migrations):

| Variable       | Which string | Port | Purpose |
|----------------|--------------|------|---------|
| `DATABASE_URL` | **Transaction / Pooler** | `6543` | Runtime queries (serverless) |
| `DIRECT_URL`   | **Session / Direct**     | `5432` | Migrations (`db push`) |

- Copy the **pooled** URL into `DATABASE_URL` and **append** `?pgbouncer=true&connection_limit=1`.
- Copy the **direct** URL into `DIRECT_URL`.
- Replace `[YOUR-PASSWORD]` in both with the database password from step 1.

Example:
```
DATABASE_URL="postgresql://postgres.abcdefgh:PW@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1"
DIRECT_URL="postgresql://postgres.abcdefgh:PW@aws-0-eu-central-1.pooler.supabase.com:5432/postgres"
```

> **Why two URLs?** Serverless functions open many short-lived connections; the
> pooler (PgBouncer) prevents exhausting Postgres' connection limit. Prisma
> migrations need a direct, non-pooled connection, which is what `DIRECT_URL` is
> for. Both are already wired up in `prisma/schema.prisma`.

## 3. Create the tables
From your machine, with the two URLs in your local `.env`:
```bash
npm install
npm run db:push      # creates all tables + indexes on Supabase
npm run db:seed      # creates the Owner + Yahya accounts (and sample data)
```
Open **Supabase → Table Editor** to confirm the tables appear.

## 4. (Optional) File storage for invoices / receipts
Uploads use **Supabase Storage** (free 1 GB). To enable them:
1. Go to **Storage → New bucket**, name it **`uploads`**, and mark it **Public**.
2. Go to **Settings → API** and copy:
   - **Project URL** → `SUPABASE_URL`
   - **`service_role` key** (secret) → `SUPABASE_SERVICE_ROLE_KEY`
3. Add both to your `.env` locally and to Vercel's env vars for production.

The `service_role` key is used **only** by the server-side upload route
(`app/api/upload`) and is never sent to the browser. If these vars are unset, every
feature still works except file upload (which shows a friendly message).

> Free plan storage: **1 GB** total, which is ample for invoice/receipt images
> and PDFs for a small business.

## Free plan limits to know
- **Database size:** 500 MB (plenty for years of this app's data).
- **Auto-pause:** a free project **pauses after ~7 days of inactivity**. It wakes
  on the next request (first request may be slow) or when you open the Supabase
  dashboard. Keep it awake by using the app.
- **No automated backups / point-in-time recovery** on free (that's a paid
  feature). Use the app's **Backup & Export** (owner menu) as your backup — see
  the Production Deployment guide.
- Shared compute; fine for a low-traffic internal tool.
