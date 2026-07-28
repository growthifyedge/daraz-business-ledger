import Link from 'next/link';
import { getFinancials } from '@/lib/calculations';
import {
  summariseDarazIncome,
  summariseInventory,
  type DashboardIncomeLine,
  type InventoryProductRow,
} from '@/lib/dashboard';
import { prisma } from '@/lib/prisma';
import type { SearchParams } from '@/lib/filters';
import type { Prisma } from '@prisma/client';
import { formatMoney, formatNumber } from '@/lib/utils';
import {
  Wallet,
  Banknote,
  Clock,
  PieChart,
  Receipt,
  Package,
  Boxes,
  AlertTriangle,
  TrendingUp,
} from 'lucide-react';
import { DashboardShell, type StoreOption } from './DashboardShell';
import { KpiCard, SectionHeader } from './DashboardCards';

export const metadata = { title: 'Dashboard' };
// Always render fresh: financial figures must never be stale after an import,
// purchase, expense or SKU-mapping change. (Prefetching the other store scopes
// only warms the route; each navigation still re-runs these queries.)
export const dynamic = 'force-dynamic';

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const requestedStore = one(sp.store) ?? null;

  // Store list drives both the filter buttons and the store-id validation. It is
  // fetched alongside the heavy figures below so the two run in parallel.
  const storesPromise = prisma.store.findMany({
    where: { deletedAt: null },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });

  // Scope the income query at the database when a store is selected (fewer rows),
  // instead of pulling every line and filtering in memory.
  const incomeWhere: Prisma.DarazIncomeLineWhereInput = requestedStore
    ? { storeId: requestedStore }
    : {};

  // All four reads are independent — issued in one batch. getFinancials internally
  // batches its own reads too, so a store switch is a couple of parallel round-
  // trips rather than a long serial chain.
  const [stores, fin, incomeRows, productRows] = await Promise.all([
    storesPromise,
    getFinancials({ storeId: requestedStore }),
    prisma.darazIncomeLine.findMany({
      where: incomeWhere,
      select: { storeId: true, releaseStatus: true, netAmount: true },
    }),
    prisma.product.findMany({
      where: { deletedAt: null, active: true },
      select: { currentStock: true, purchaseCost: true, minStockLevel: true },
    }),
  ]);

  // Only honour a store id that actually exists; otherwise fall back to All Stores.
  const storeId = requestedStore && stores.some((s) => s.id === requestedStore) ? requestedStore : null;
  const activeStore = stores.find((s) => s.id === storeId) ?? null;

  // Daraz income + inventory derived by the pure, tested helpers.
  const income = summariseDarazIncome(incomeRows as DashboardIncomeLine[], storeId);
  const inventory = summariseInventory(productRows as InventoryProductRow[]);

  const coverage = fin.darazCogs;
  const coverageComplete = coverage.deliveredUnits === 0 || coverage.coveragePct >= 100;
  // Delivered units still missing a purchase cost — the ones the estimate leaves out.
  const uncoveredUnits = coverage.deliveredUnits - coverage.costedUnits;

  const scopeLabel = activeStore ? activeStore.name : 'All Stores';

  const storeOptions: StoreOption[] = [
    { id: null, label: 'All Stores' },
    ...stores.map((s) => ({ id: s.id, label: s.name })),
  ];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Dashboard</h1>
        <p className="mt-1.5 text-sm text-slate-500">
          Business overview for <span className="font-semibold text-slate-700">{scopeLabel}</span> · all-time
        </p>
      </div>

      <DashboardShell storeId={storeId} options={storeOptions}>
      {/* 1. Daraz income */}
      <section className="mb-9">
        <SectionHeader
          icon={<Wallet size={18} />}
          tone="brand"
          title="Daraz income"
          note={
            <>
              Money from your imported Daraz statements. <strong className="font-semibold text-slate-600">Released</strong>{' '}
              has already been paid out; <strong className="font-semibold text-slate-600">Ready to Release</strong> is
              confirmed but not yet paid. Together they equal your Daraz Net Income.
            </>
          }
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <KpiCard
            href="/payouts"
            label="Daraz Net Income"
            value={formatMoney(income.net)}
            hint="Imported Daraz statements"
            icon={<Wallet size={18} />}
            tone="brand"
          />
          <KpiCard
            href="/payouts"
            label="Released Payouts"
            value={formatMoney(income.released)}
            hint="Already paid out"
            icon={<Banknote size={18} />}
            tone="positive"
          />
          <KpiCard
            href="/payouts"
            label="Ready to Release"
            value={formatMoney(income.ready)}
            hint="Confirmed, not yet paid"
            icon={<Clock size={18} />}
            tone="warning"
          />
        </div>
      </section>

      {/* 2. Profitability */}
      <section className="mb-9">
        <SectionHeader
          icon={<TrendingUp size={18} />}
          tone="positive"
          title="Profitability"
          note={
            <>
              What you actually keep after product cost and running costs. COGS is the estimated cost of the goods you
              sold on Daraz; the business net profit is your Daraz income minus those costs.
            </>
          }
        />
        {!coverageComplete && (
          <div className="mb-4 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-600">
              <AlertTriangle className="h-4 w-4" />
            </span>
            <div className="flex flex-col gap-1.5 text-sm leading-relaxed text-amber-900">
              <span>
                <strong className="font-semibold">COGS incomplete:</strong> {formatNumber(uncoveredUnits)} of{' '}
                {formatNumber(coverage.deliveredUnits)} delivered units still need a product purchase cost.{' '}
                Estimated profit excludes those units.
              </span>
              <Link
                href={storeId ? `/products/missing-cogs?store=${encodeURIComponent(storeId)}` : '/products/missing-cogs'}
                className="inline-flex w-fit items-center gap-1 font-semibold text-amber-900 underline decoration-amber-400 underline-offset-2 hover:decoration-amber-700"
              >
                Review products
              </Link>
            </div>
          </div>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            href="/profit-loss"
            label="Estimated Daraz COGS"
            value={`− ${formatMoney(fin.estimatedDarazCogs)}`}
            hint="Cost of goods sold (estimated)"
            icon={<Receipt size={18} />}
            tone="negative"
          />
          <KpiCard
            href="/profit-loss"
            label="COGS Coverage"
            value={`${formatNumber(coverage.costedUnits)}/${formatNumber(coverage.deliveredUnits)}`}
            hint="delivered units costed"
            icon={<PieChart size={18} />}
            tone={coverageComplete ? 'positive' : 'warning'}
          />
          <KpiCard
            href="/profit-loss"
            label="Operating Expenses"
            value={`− ${formatMoney(fin.operatingExpenses)}`}
            hint="Packaging, transport, misc."
            icon={<Receipt size={18} />}
            tone="negative"
          />
          <KpiCard
            href="/profit-loss"
            label="Estimated Business Net Profit"
            value={formatMoney(fin.combinedNetProfit)}
            hint="Daraz income − COGS − running costs"
            icon={<PieChart size={18} />}
            tone={fin.combinedNetProfit >= 0 ? 'positive' : 'negative'}
          />
        </div>
      </section>

      {/* 3. Inventory */}
      <section className="mb-2">
        <SectionHeader
          icon={<Boxes size={18} />}
          tone="default"
          title="Inventory"
          note={
            <>
              What you are holding in stock right now, valued at cost. Stock is tracked across all stores. Open{' '}
              <Link href="/products" className="font-semibold text-brand-600 hover:underline">
                Products &amp; Inventory
              </Link>{' '}
              to manage it.
            </>
          }
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <KpiCard
            href="/products"
            label="Current Stock Value"
            value={formatMoney(inventory.stockValueAtCost)}
            hint="At purchase cost"
            icon={<Wallet size={18} />}
            tone="brand"
          />
          <KpiCard
            href="/products"
            label="Units in Stock"
            value={formatNumber(inventory.totalUnits)}
            hint={`${formatNumber(inventory.productCount)} active product(s)`}
            icon={<Package size={18} />}
          />
          <KpiCard
            href="/products"
            label="Low / Negative Stock"
            value={`${formatNumber(inventory.lowStockCount)}${inventory.negativeStockCount > 0 ? ` / ${formatNumber(inventory.negativeStockCount)}` : ''}`}
            hint={inventory.negativeStockCount > 0 ? 'products low / negative' : 'products at or below minimum'}
            icon={<Boxes size={18} />}
            tone={inventory.negativeStockCount > 0 ? 'negative' : inventory.lowStockCount > 0 ? 'warning' : 'default'}
          />
        </div>
      </section>
      </DashboardShell>
    </div>
  );
}
