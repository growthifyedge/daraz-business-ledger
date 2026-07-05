# Daraz Business Ledger & Inventory System

A professional web app to manage multiple Daraz shops — inventory, purchases, expenses,
sales income, Daraz deductions, cash flow, restocking, profit/loss, and the 50/50
profit split between the Owner and Yahya.

Built with **Next.js 15 (App Router)**, **TypeScript**, **Tailwind CSS**, **Prisma**,
and **PostgreSQL**. Deploys to **Vercel**. Fully responsive (mobile + desktop).

---

## Features

- **Dashboard** — investment, stock value, sales, expenses, gross/net profit, Yahya &
  Owner 50% shares, cash in hand, low-stock / best-selling / slow-moving products, and
  recent activity, with sales/profit trend and profit-split charts.
- **Stores** — unlimited Daraz stores; products can belong to one or many stores.
- **Products & Inventory** — full stock control: add / reduce / adjust / transfer stock,
  record damaged / lost / returned units, stock valuation, and a complete movement history
  per product. Low-stock alerts.
- **Purchases** — Yahya's market purchases with invoice upload, paid/unpaid status,
  reimbursement date and bank reference. Recording a purchase auto-adds stock.
- **Sales Income** — manually entered from the Daraz Seller App. Auto-calculates the net
  settlement and auto-reduces stock.
- **Expenses** — 13 categories (packaging, flyers, tape, bank charges, transport, etc.)
  with receipt upload.
- **Accessories & Stationery** — packing-material inventory; consumption cost feeds P&L.
- **Weekly Daraz Settlements** — gross, deductions and net received per settlement.
- **Profit & Loss** — full statement with date-range + store filters and PDF/CSV export.
- **Cash Flow** — owner investment, reimbursements, settlements, expenses, payouts, net
  cash balance, and profit-share payable vs paid.
- **Reports** — Profit, Sales, Purchase, Expense, Cash Flow, Inventory, Restocking; each
  with date + store filters and **PDF + CSV/Excel export**.
- **Owner Audit Log** — every create/edit/delete with old & new values, user and timestamp.
  **Owner-only** route, and logs can never be deleted from the UI.
- **Auth** — email/password login, two roles (OWNER, ADMIN). Middleware-protected.
- **Data safety** — confirm-before-delete, soft deletes, required-field validation, error
  handling, empty states, and loading states.

---

## Tech stack

| Concern        | Choice                                   |
| -------------- | ---------------------------------------- |
| Framework      | Next.js 15 (App Router, Server Actions)  |
| Language       | TypeScript                               |
| Styling        | Tailwind CSS                             |
| Database       | PostgreSQL (Supabase / Neon / any)       |
| ORM            | Prisma                                   |
| Auth           | Email/password (bcrypt + signed JWT cookie via `jose`) |
| File uploads   | Supabase Storage (invoices / receipts)   |
| Charts         | Recharts                                 |
| Export         | jsPDF + autotable (PDF), native CSV      |

---

## Getting started (local)

### 1. Prerequisites
- Node.js 18.18+ (or 20+)
- A PostgreSQL database. The easiest free options are **Supabase** or **Neon**.

### 2. Install
```bash
npm install
```

### 3. Environment
Copy `.env.example` to `.env` and fill it in:
```bash
cp .env.example .env
```
- `DATABASE_URL` / `DIRECT_URL` — your Postgres connection strings.
  For **Supabase**: use the *Connection Pooling* string for `DATABASE_URL` and the
  *Direct connection* string for `DIRECT_URL`.
- `AUTH_SECRET` — a long random string. Generate one with:
  ```bash
  openssl rand -base64 48
  ```
- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` — (optional) to enable invoice/receipt
  uploads via Supabase Storage (create a public `uploads` bucket). Everything else
  works without them.
- `OWNER_EMAIL` / `OWNER_PASSWORD` / `ADMIN_EMAIL` / `ADMIN_PASSWORD` — seed accounts.

### 4. Create the database schema
```bash
npm run db:push
```

### 5. Seed users + demo data
```bash
npm run db:seed
```
This creates the Owner and Admin (Yahya) accounts and some sample stores, products,
purchases, sales and expenses so the dashboard isn't empty.

### 6. Run
```bash
npm run dev
```
Open http://localhost:3000 and sign in with your `OWNER_EMAIL` / `OWNER_PASSWORD`.

---

## Deploy to Vercel

> 📘 **Full production deployment on a free stack** (GitHub private + Vercel Hobby +
> Supabase Free) is documented in [`docs/PRODUCTION_DEPLOYMENT.md`](docs/PRODUCTION_DEPLOYMENT.md),
> with per-service guides and a [`docs/PRODUCTION_CHECKLIST.md`](docs/PRODUCTION_CHECKLIST.md).

1. Push this project to a Git repository (GitHub/GitLab/Bitbucket).
2. In Vercel, **Import Project**.
3. Add the environment variables from your `.env` in **Settings → Environment Variables**
   (`DATABASE_URL`, `DIRECT_URL`, `AUTH_SECRET`, and optionally `SUPABASE_URL` +
   `SUPABASE_SERVICE_ROLE_KEY`).
4. (Recommended) In **Supabase → Storage**, create a public `uploads` bucket and add
   `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` to enable invoice/receipt uploads.
5. Deploy. The build runs `prisma generate` automatically.
6. After the first deploy, run the schema push and seed against your production DB from
   your machine (with production `DATABASE_URL` in your local `.env`):
   ```bash
   npm run db:push
   npm run db:seed
   ```

> **Tip:** change the seeded passwords immediately, or set strong `OWNER_PASSWORD` /
> `ADMIN_PASSWORD` before seeding.

---

## Roles & the Audit Log

- **OWNER** — full access **plus** the Audit Log (`/audit-log`).
- **ADMIN** (Yahya) — full operational access; the Audit Log is hidden and blocked by
  middleware.

The Audit Log records who did what, when, and the before/after values for every change.
It is append-only — there is no UI to delete entries.

---

## How profit is calculated

```
Gross Sales
  − Product Cost (COGS = units sold × purchase cost)
  − Daraz Commission
  − VAT
  − Other Daraz Charges
  − Returns / Refunds
  − Operating Expenses (packaging, flyers, transport, bank charges, misc…)
  − Accessories Consumed (quantity used × unit cost)
  = Net Profit

Yahya Share = 50% of Net Profit
Owner Share = 50% of Net Profit
```

To avoid double-counting, Daraz commission/VAT/other charges and product cost are taken
from **Sales** entries; the Expense categories `Product Cost`, `VAT`, `Daraz Commission`
and `Other Daraz Charges` are therefore **excluded** from the P&L expense side. Log
physical/operational costs under the other expense categories, and packing material under
**Accessories**.

---

## Configuration

- **Currency** — edit `lib/config.ts` (`CURRENCY.symbol` / `code` / `locale`).
  Default is `Rs` (PKR). Change to `৳` / `BDT` etc. for other Daraz markets.
- **Profit split** — `PROFIT_SPLIT` in `lib/config.ts` (default 50/50).
- **Product category** — fixed as `Lifestyle Gadgets` (`PRODUCT_CATEGORY`).

---

## Project structure

```
app/
  (auth)/login/        — sign-in page + auth server actions
  (dashboard)/         — protected app (layout with sidebar)
    dashboard/         — overview + charts
    stores/            — store CRUD
    products/          — products, inventory, stock movements, per-product history
    purchases/         — purchases + reimbursement
    sales/             — sales income
    expenses/          — expenses
    accessories/       — packing material inventory
    settlements/       — weekly Daraz settlements
    profit-loss/       — P&L statement
    cash-flow/         — investments, payouts, cash summary
    reports/           — 7 reports with filters + export
    audit-log/         — owner-only activity log
  api/upload/          — Supabase Storage upload endpoint
components/            — UI primitives, forms, charts, export
lib/                   — auth, prisma, calculations, audit, config, utils
prisma/                — schema + seed
middleware.ts          — route protection
```

---

## Scripts

| Script            | Purpose                            |
| ----------------- | ---------------------------------- |
| `npm run dev`     | Start the dev server               |
| `npm run build`   | Production build (runs `prisma generate`) |
| `npm run start`   | Start the production server        |
| `npm run db:push` | Push the Prisma schema to the DB   |
| `npm run db:seed` | Seed users + demo data             |
| `npm run db:studio` | Open Prisma Studio               |

---

Built for a private multi-store Daraz operation. Not affiliated with Daraz.
