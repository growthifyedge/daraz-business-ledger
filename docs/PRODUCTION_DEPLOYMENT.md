# Production Deployment Guide

Deploy the Daraz Business Ledger on a **100% free** stack: GitHub (private) +
Vercel (Hobby) + Supabase (Free). Detailed per-service steps live in:
- [`SUPABASE_SETUP.md`](./SUPABASE_SETUP.md)
- [`GITHUB_DEPLOYMENT.md`](./GITHUB_DEPLOYMENT.md)
- [`VERCEL_DEPLOYMENT.md`](./VERCEL_DEPLOYMENT.md)

Use the [`PRODUCTION_CHECKLIST.md`](./PRODUCTION_CHECKLIST.md) to track progress.

---

## Deployment sequence (do these in order)

1. **Supabase** — create the project, grab the pooled + direct connection strings.
2. **Local env** — copy `.env.example` → `.env`, fill in `DATABASE_URL`,
   `DIRECT_URL`, `AUTH_SECRET`, and the `OWNER_*`/`ADMIN_*` seed values.
3. **Database** — `npm install` → `npm run db:push` → `npm run db:seed`.
4. **Verify locally** — `npm run dev`, sign in as the Owner, click around.
5. **GitHub** — push the private repo (confirm `.env` is not committed).
6. **Vercel** — import the repo, add the env vars (Production), Deploy.
7. **Smoke test production** — log in, create a store/product, record a sale,
   download a backup.

---

## Database migrations (safe process, no data loss)

This project uses Prisma **`db push`** (schema-driven), exposed as `npm run db:push`.

- **Initial deploy (empty Supabase DB):** `db push` creates every table and index
  from `prisma/schema.prisma`. **Zero risk** — there is no existing data.
- **Later schema changes:** `db push` diffs your schema against the live DB and
  applies the difference using `DIRECT_URL`. **Additive** changes (new tables,
  columns, indexes — e.g. the Phase-1 foreign-key indexes) are **safe and cause no
  data loss.** `db push` will **warn and require confirmation** before any
  destructive change (dropping/renaming a column). Never accept a destructive
  prompt in production without a fresh backup.
- **Golden rule:** **download a Backup (owner menu) before every production
  `db push`.**
- **Production migration command** (run from your machine with production URLs in
  `.env`):
  ```bash
  npm run db:push
  ```
  Then confirm the change in Supabase → Table Editor.

> For a fully auditable migration history you could later adopt
> `prisma migrate` (versioned SQL files). It is **not required** for this free
> deployment and is intentionally out of scope here.

---

## Backup & restore

**How backup works**
- Owner opens **Backup & Export** (owner-only nav) → **Download backup (.json)**,
  which calls `GET /api/backup`.
- The file contains every table (stores, products, inventory movements, purchases,
  sales, expenses, accessories, settlements, investments, payouts, audit logs, and
  user records **without password hashes**).
- Each download is recorded in the **Audit Log**.
- Do this on a regular schedule (e.g. weekly) and keep copies off-site.

**How restore works**
- Restore is currently a **manual** operation (there is no one-click import — that
  would be a new feature, out of scope for this phase). To restore:
  1. Recreate the schema on a fresh DB with `npm run db:push`.
  2. Re-import the JSON `data` object table-by-table — e.g. a short Prisma script
     that reads the backup file and calls `createMany` per table in dependency
     order (users/stores/products first, then dependent rows), or import via the
     Supabase table editor / SQL.
  3. User passwords are **not** in the backup, so re-run `npm run db:seed` (or
     reset passwords) to restore login accounts.

**Free-plan limitations**
- Supabase Free has **no automated backups / point-in-time recovery** — the app's
  manual JSON export is your primary backup. Take it regularly.
- Backups are generated in-memory as one JSON file; for this app's data volumes
  that is fine on Hobby/Free. (At very large scale you'd stream/paginate — not a
  concern for a single small business.)

---

## Security review (production posture)

| Area | Status | Notes |
|------|--------|-------|
| **Environment variables** | ✅ | Secrets only in env; `.env` git-ignored; no secrets in code (verified). |
| **Auth secret** | ✅ | `AUTH_SECRET` signs the session JWT (HS256, `jose`); app errors clearly if missing. Use a strong, unique value in prod. |
| **Cookies** | ✅ | `httpOnly`, `sameSite=lax`, `path=/`, and `secure` **on in production** (HTTPS on Vercel). 7-day expiry. |
| **CORS** | ✅ n/a | No cross-origin API is exposed. API routes and Server Actions are same-origin; Next.js enforces Server Action origin checks. |
| **Authorization** | ✅ | Middleware protects all routes; `/audit-log` and `/backup` are owner-only (middleware + page-level `requireOwner`). |
| **File upload security** | ✅ / ⚠️ | Upload route requires a valid session, validates type (image/PDF) and 10 MB size limit. Files go to **Supabase Storage** via the server-only `service_role` key. ⚠️ The `uploads` bucket is **public-read** (URLs are unguessable but unauthenticated) — acceptable for now; a private-bucket + signed-URL upgrade is tracked for a later phase. |
| **Database connection** | ✅ | Pooled (`pgbouncer`) URL at runtime; direct URL for migrations; parameterized queries via Prisma (no raw SQL → no SQL injection). |
| **Production build** | ✅ | `tsc --noEmit` clean; `next build` succeeds; build has no DB dependency. |

Recommended hardening (later phases, not required to deploy): login rate-limiting,
private file access, and the Float→Decimal money migration (already on the roadmap).

---

## Estimated time
- First-time deployment: **~30–45 minutes** end to end (most of it is Supabase +
  Vercel account setup and copying env vars).
- Subsequent deploys: **automatic** on `git push` (~1–2 min build).
