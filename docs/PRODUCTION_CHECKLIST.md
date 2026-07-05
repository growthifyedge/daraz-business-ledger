# Production Checklist

Work top to bottom. Detailed steps are in the guides in this `docs/` folder.

## Accounts & repository
- [ ] GitHub **private** repository created
- [ ] `.env` confirmed **not** committed (only `.env.example` is)
- [ ] Project pushed to `main`

## Supabase (database)
- [ ] Supabase **Free** project created
- [ ] Database password saved securely
- [ ] `DATABASE_URL` (pooled `:6543` + `?pgbouncer=true&connection_limit=1`) copied
- [ ] `DIRECT_URL` (direct `:5432`) copied

## Local preparation
- [ ] `.env` created from `.env.example` and filled in
- [ ] `AUTH_SECRET` generated (`openssl rand -base64 48`)
- [ ] `npm install` completed
- [ ] `npm run db:push` succeeded (tables + indexes created)
- [ ] `npm run db:seed` succeeded (Owner + Yahya accounts created)
- [ ] Seed passwords set to strong values
- [ ] Local `npm run dev` login works

## Vercel (hosting)
- [ ] Repo imported to Vercel (Next.js auto-detected)
- [ ] `DATABASE_URL` added (Production)
- [ ] `DIRECT_URL` added (Production)
- [ ] `AUTH_SECRET` added (Production)
- [ ] (Optional) Supabase Storage `uploads` bucket created + `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` added
- [ ] Build successful
- [ ] Deployed to `*.vercel.app`

## Production smoke test
- [ ] Login working (Owner)
- [ ] Login working (Yahya / ADMIN)
- [ ] Create store / product works
- [ ] Record a sale reduces stock (and blocks overselling)
- [ ] Reports open and export (CSV/PDF)
- [ ] Backup download working (owner)
- [ ] Per-report Export working
- [ ] Audit Log visible to Owner, hidden from Yahya
- [ ] (If enabled) invoice/receipt upload works
- [ ] Mobile layout verified (phone)
- [ ] Desktop layout verified

## Ongoing
- [ ] First manual Backup downloaded and stored off-site
- [ ] Backup schedule agreed (e.g. weekly)
- [ ] Team knows Supabase free pauses after ~7 days idle
