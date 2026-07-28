import Link from 'next/link';
import { getFinancials, getStockValue } from '@/lib/calculations';
import { summariseDarazIncome, type DashboardIncomeLine } from '@/lib/dashboard';
import { prisma } from '@/lib/prisma';
import type { SearchParams } from '@/lib/filters';
import { Card, CardBody, StatCard } from '@/components/ui';
import { formatMoney, formatNumber } from '@/lib/utils';
import { Wallet, Banknote, Clock, PieChart, Receipt, Package, Boxes, AlertTriangle } from 'lucide-react';

export const metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** A card that links to a related page — reuses StatCard, keeps it clickable. */
function LinkStat({ href, ...stat }: { href: string } & Parameters<typeof StatCard>[0]) {
  return (
    <Link href={href} className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded-xl">
      <StatCard {...stat} />
    </Link>
  );
}

function SectionNote({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 mb-3 text-sm text-slate-500">{children}</p>;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const requestedStore = one(sp.store) ?? null;

  const stores = await prisma.store.findMany({
    where: { deletedAt: null },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });

  // Only honour a store id that actually exists; otherwise fall back to All Stores.
  const storeId = requestedStore && stores.some((s) => s.id === requestedStore) ? requestedStore : null;
  const activeStore = stores.find((s) => s.id === storeId) ?? null;

  const [fin, stock, incomeRows, products] = await Promise.all([
    getFinancials({ storeId }),
    getStockValue(),
    prisma.darazIncomeLine.findMany({
      select: { storeId: true, releaseStatus: true, netAmount: true },
    }),
    prisma.product.findMany({
      where: { deletedAt: null, active: true },
      select: { currentStock: true, minStockLevel: true },
    }),
  ]);

  // Daraz income scoped by the store filter through the pure, tested helper.
  const income = summariseDarazIncome(incomeRows as DashboardIncomeLine[], storeId);

  const lowStockCount = products.filter((p) => p.currentStock <= p.minStockLevel).length;
  const negativeStockCount = products.filter((p) => p.currentStock < 0).length;

  const coverage = fin.darazCogs;
  const coverageComplete = coverage.deliveredUnits === 0 || coverage.coveragePct >= 100;

  const scopeLabel = activeStore ? activeStore.name : 'All Stores';

  const filters: { id: string | null; label: string }[] = [
    { id: null, label: 'All Stores' },
    ...stores.map((s) => ({ id: s.id, label: s.name })),
  ];

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">
          Business overview for <span className="font-medium text-slate-700">{scopeLabel}</span> (all-time).
        </p>
      </div>

      {/* Store filter — scopes every figure below. Default: All Stores. */}
      <div className="mb-6 flex flex-wrap gap-2">
        {filters.map((f) => {
          const active = (f.id ?? null) === storeId;
          const href = f.id ? `/dashboard?store=${f.id}` : '/dashboard';
          return (
            <Link
              key={f.id ?? 'all'}
              href={href}
              className={
                active
                  ? 'rounded-full bg-brand-600 px-4 py-1.5 text-sm font-medium text-white shadow-sm'
                  : 'rounded-full border border-slate-200 bg-white px-4 py-1.5 text-sm font-medium text-slate-600 hover:border-brand-300 hover:text-brand-700'
              }
            >
              {f.label}
            </Link>
          );
        })}
      </div>

      {/* 1. Daraz income */}
      <section className="mb-8">
        <h2 className="text-base font-semibold text-slate-900">Daraz income</h2>
        <SectionNote>
          Money from your imported Daraz statements. <strong>Released</strong> has already been paid out;{' '}
          <strong>Ready to Release</strong> is confirmed but not yet paid. Together they equal your Daraz Net Income.
        </SectionNote>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <LinkStat
            href="/payouts"
            label="Daraz Net Income"
            value={formatMoney(income.net)}
            hint="Imported Daraz statements"
            icon={<Wallet size={18} />}
            tone="brand"
          />
          <LinkStat
            href="/payouts"
            label="Released Payouts"
            value={formatMoney(income.released)}
            hint="Already paid out"
            icon={<Banknote size={18} />}
            tone="positive"
          />
          <LinkStat
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
      <section className="mb-8">
        <h2 className="text-base font-semibold text-slate-900">Profitability</h2>
        <SectionNote>
          What you actually keep after product cost and running costs. COGS is the estimated cost of the goods you sold
          on Daraz; the business net profit is your Daraz income minus those costs.
        </SectionNote>
        {!coverageComplete && (
          <Card className="mb-3 border-amber-200 bg-amber-50/70">
            <CardBody className="flex items-start gap-2 py-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <p className="text-xs leading-relaxed text-amber-800">
                Some delivered units have no cost yet; profit is incomplete.
              </p>
            </CardBody>
          </Card>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <LinkStat
            href="/profit-loss"
            label="Estimated Daraz COGS"
            value={`− ${formatMoney(fin.estimatedDarazCogs)}`}
            hint="Cost of goods sold (estimated)"
            icon={<Receipt size={18} />}
            tone="negative"
          />
          <LinkStat
            href="/profit-loss"
            label="COGS Coverage"
            value={`${formatNumber(coverage.costedUnits)}/${formatNumber(coverage.deliveredUnits)}`}
            hint="delivered units costed"
            icon={<PieChart size={18} />}
            tone={coverageComplete ? 'positive' : 'warning'}
          />
          <LinkStat
            href="/profit-loss"
            label="Operating Expenses"
            value={`− ${formatMoney(fin.operatingExpenses)}`}
            hint="Packaging, transport, misc."
            icon={<Receipt size={18} />}
            tone="negative"
          />
          <LinkStat
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
      <section className="mb-4">
        <h2 className="text-base font-semibold text-slate-900">Inventory</h2>
        <SectionNote>
          What you are holding in stock right now, valued at cost. Stock is tracked across all stores. Open{' '}
          <Link href="/products" className="font-medium text-brand-600 hover:underline">
            Products &amp; Inventory
          </Link>{' '}
          to manage it.
        </SectionNote>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <LinkStat
            href="/products"
            label="Current Stock Value"
            value={formatMoney(stock.stockValueAtCost)}
            hint="At purchase cost"
            icon={<Wallet size={18} />}
            tone="brand"
          />
          <LinkStat
            href="/products"
            label="Units in Stock"
            value={formatNumber(stock.totalUnits)}
            hint={`${formatNumber(stock.productCount)} active product(s)`}
            icon={<Package size={18} />}
          />
          <LinkStat
            href="/products"
            label="Low / Negative Stock"
            value={`${formatNumber(lowStockCount)}${negativeStockCount > 0 ? ` / ${formatNumber(negativeStockCount)}` : ''}`}
            hint={negativeStockCount > 0 ? 'products low / negative' : 'products at or below minimum'}
            icon={<Boxes size={18} />}
            tone={negativeStockCount > 0 ? 'negative' : lowStockCount > 0 ? 'warning' : 'default'}
          />
        </div>
      </section>
    </div>
  );
}
