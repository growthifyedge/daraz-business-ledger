# Vercel Deployment Guide (Hobby Plan)

Vercel hosts the Next.js app. The **Hobby** plan is free.

> **License note:** Vercel's Hobby plan is intended for **personal / non-commercial**
> use. This is a business tool, so review Vercel's terms — you may eventually need
> the Pro plan for commercial use. This is a policy consideration, not a technical
> blocker.

## 1. Import the repository
1. Sign in to [vercel.com](https://vercel.com) with your GitHub account.
2. **Add New… → Project** → import your private `daraz-business-ledger` repo.
3. Vercel auto-detects **Next.js** — leave Framework Preset, Build Command, and
   Output Directory at their defaults. (Build runs `prisma generate && next build`
   automatically via this project's `build` script.)

## 2. Add environment variables
Before the first deploy, open **Settings → Environment Variables** and add:

| Name | Value | Required |
|------|-------|----------|
| `DATABASE_URL` | Supabase **pooled** URL (`:6543` + `?pgbouncer=true&connection_limit=1`) | ✅ |
| `DIRECT_URL` | Supabase **direct** URL (`:5432`) | ✅ |
| `AUTH_SECRET` | `openssl rand -base64 48` output | ✅ |
| `SUPABASE_URL` | Supabase → Settings → API → Project URL (only if you want uploads) | ⬜ optional |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → `service_role` key (secret) | ⬜ optional |
| `SUPABASE_STORAGE_BUCKET` | Bucket name (defaults to `uploads`) | ⬜ optional |

Apply them to **Production** (and Preview if you use preview deploys).
The `OWNER_*` / `ADMIN_*` seed variables are **not** needed on Vercel — they are
only read by the local `db:seed` command.

## 3. (Optional) Enable file uploads (Supabase Storage)
1. In **Supabase → Storage**, create a **public** bucket named `uploads`.
2. Add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (from Supabase → Settings →
   API) to the Vercel env vars above. The service-role key is used **server-side
   only** by the upload route and is never exposed to the browser.
3. Without these, everything works except invoice/receipt uploads (which show a
   friendly "storage not configured" message).

## 4. Prepare the database (one time, from your machine)
The Vercel **build never touches the database** (all data pages are dynamic), so
the build succeeds even before the DB exists. But the app needs tables at runtime:
```bash
# with production DATABASE_URL + DIRECT_URL in your local .env
npm run db:push     # create tables + indexes on Supabase
npm run db:seed     # create the Owner + Yahya login accounts
```

## 5. Deploy
Click **Deploy**. First build takes ~1–2 minutes. When it finishes, open the
`*.vercel.app` URL and sign in with your Owner credentials.

## 6. Redeploys
Every push to `main` redeploys automatically. Environment variable changes require
a redeploy (Vercel prompts you).

## Free plan limits to know
- Serverless function execution limits and monthly bandwidth caps (generous for a
  low-traffic internal tool).
- Cold starts: the first request after idle may be slightly slower (compounded by
  Supabase auto-pause — see the Supabase guide).
