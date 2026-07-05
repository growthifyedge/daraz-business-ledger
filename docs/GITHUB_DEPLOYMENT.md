# GitHub Deployment Guide (Private Repository)

Vercel deploys from a Git repository. Use a **private** repo so your business
code stays private.

## 1. Confirm secrets are ignored
This repo's `.gitignore` already excludes `.env`, `.env*.local`, `node_modules`,
`.next`, and `.vercel`. **Never commit a real `.env`.** Only `.env.example`
(placeholders) is committed.

Quick check before your first commit:
```bash
git status            # .env must NOT appear in the list
```

## 2. Create the repository
1. On [github.com](https://github.com) → **New repository**.
2. Name it (e.g. `daraz-business-ledger`), set **Private**, do **not** add a
   README/.gitignore (this project already has them).

## 3. Push the project
From the project root:
```bash
git init
git add .
git commit -m "Daraz Business Ledger — production ready"
git branch -M main
git remote add origin https://github.com/<your-username>/daraz-business-ledger.git
git push -u origin main
```

## 4. What gets committed (and what doesn't)
- ✅ Committed: source code, `prisma/schema.prisma`, `.env.example`, docs.
- 🚫 Ignored: `.env` (secrets), `node_modules`, `.next` build output, Prisma's
  generated client (regenerated on every build via `prisma generate`).

## 5. Future updates
Every `git push` to `main` triggers an automatic redeploy on Vercel once the repo
is connected (see the Vercel guide). Use branches + pull requests if you want
preview deployments before going live.
