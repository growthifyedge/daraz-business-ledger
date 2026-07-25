import type { ReactNode } from 'react';
import { getFinancials } from '@/lib/calculations';
import { parseFilter, rangeLabel } from '@/lib/filters';
import type { SearchParams } from '@/lib/filters';
import { prisma } from '@/lib/prisma';
import { Card, CardBody, CardHeader, PageHeader, StatCard } from '@/components/ui';
import { FilterBar } from '@/components/FilterBar';
import { DarazIncomeCard } from '@/components/DarazIncomeCard';
import { PnlExport } from './PnlExport';
import { formatMoney, formatNumber } from '@/lib/utils';
import { PROFIT_SPLIT } from '@/lib/config';
import { Info, TrendingUp, Users, Wallet } from 'lucide-react';

export const metadata = { title: 'Profit & Loss' };
export const dynamic = 'force-dynamic';

const yahyaPct = Math.round(PROFIT_SPLIT.yahya * 100);
const ownerPct = Math.round(PROFIT_SPLIT.owner * 100);

export default async function ProfitLossPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const filter = parseFilter(sp);

  const [stores, fin] = await Promise.all([
    prisma.store.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    getFinancials(filter),
  ]);

  const label = rangeLabel(filter);
  const netPositive = fin.netProfit >= 0;

  // Flattened rows for CSV / PDF export (plain numbers only).
  const exportRows = [
    { item: 'Gross Sales', amount: fin.grossSales },
    { item: 'Sales COGS', amount: -fin.salesCOGS },
    { item: 'Recovered COGS (restocked)', amount: fin.recoveredCOGS },
    { item: 'Net Product Cost', amount: -fin.netProductCost },
    { item: 'Gross Profit', amount: fin.grossProfit },
    { item: 'Daraz Commission', amount: -fin.commission },
    { item: 'VAT', amount: -fin.vat },
    { item: 'Other Daraz Charges', amount: -fin.otherDarazCharges },
    { item: 'Returns / Refunds', amount: -fin.returnsRefunds },
    { item: 'Operating Expenses', amount: -fin.operatingExpenses },
    { item: 'Accessories Consumed', amount: -fin.accessoriesConsumed },
    { item: 'NET PROFIT', amount: fin.netProfit },
    { item: `Yahya Share (${yahyaPct}%)`, amount: fin.yahyaShare },
    { item: `Owner Share (${ownerPct}%)`, amount: fin.ownerShare },
  ];

  return (
    <div>
      <PageHeader
        title="Profit & Loss"
        description={`Statement for ${label}`}
      >
        <PnlExport
          rows={exportRows}
          title="Profit & Loss Statement"
          subtitle={label}
        />
      </PageHeader>

      <FilterBar stores={stores} />

      <div className="grid gap-3 lg:grid-cols-3">
        {/* Waterfall statement */}
        <Card className="lg:col-span-2 overflow-hidden">
          <CardHeader
            title={
              <span className="flex items-center gap-1.5">
                <TrendingUp className="h-4 w-4 text-brand-500" />
                Profit &amp; Loss Statement — Manual channel
              </span>
            }
            subtitle={`Source: Manual Sales · ${formatNumber(fin.unitsSold)} units sold · ${label}`}
          />
          <CardBody className="p-0">
            <dl className="divide-y divide-slate-100">
              <PnlLine
                label="Gross Sales"
                amount={fin.grossSales}
                bold
              />
              <PnlLine label="Sales COGS" amount={fin.salesCOGS} deduction />
              {fin.recoveredCOGS > 0 && (
                <PnlLine
                  label="Recovered COGS (restocked returns)"
                  amount={fin.recoveredCOGS}
                />
              )}
              <PnlLine
                label="Net Product Cost"
                amount={fin.netProductCost}
                deduction
              />
              <PnlLine
                label="Gross Profit"
                amount={fin.grossProfit}
                subtotal
              />
              <PnlLine
                label="Daraz Commission"
                amount={fin.commission}
                deduction
              />
              <PnlLine label="VAT" amount={fin.vat} deduction />
              <PnlLine
                label="Other Daraz Charges"
                amount={fin.otherDarazCharges}
                deduction
              />
              <PnlLine
                label="Returns / Refunds (seller-borne)"
                amount={fin.returnsRefunds}
                deduction
              />
              <PnlLine
                label="Operating Expenses"
                amount={fin.operatingExpenses}
                deduction
              />
              <PnlLine
                label="Accessories Consumed"
                amount={fin.accessoriesConsumed}
                deduction
              />
              <PnlLine
                label="Net Profit"
                amount={fin.netProfit}
                total
                positive={netPositive}
              />
            </dl>
          </CardBody>
        </Card>

        {/* Net profit highlight + profit split */}
        <div className="flex flex-col gap-3">
          <Card
            className={
              netPositive
                ? 'border-emerald-100 bg-gradient-to-br from-emerald-500 to-emerald-600 text-white'
                : 'border-rose-100 bg-gradient-to-br from-rose-500 to-rose-600 text-white'
            }
          >
            <CardBody>
              <p className="text-xs font-medium uppercase tracking-wide text-white/80">
                Net Profit
              </p>
              <p className="mt-1 text-3xl font-bold tabular-nums">
                {formatMoney(fin.netProfit)}
              </p>
              <p className="mt-1 text-xs text-white/80">
                After all deductions · {label}
              </p>
            </CardBody>
          </Card>

          <StatCard
            label={`Yahya Share (${yahyaPct}%)`}
            value={formatMoney(fin.yahyaShare)}
            hint={`${yahyaPct}% of net profit`}
            icon={<Users size={18} />}
            tone="brand"
          />
          <StatCard
            label={`Owner Share (${ownerPct}%)`}
            value={formatMoney(fin.ownerShare)}
            hint={`${ownerPct}% of net profit`}
            icon={<Wallet size={18} />}
            tone="brand"
          />
          <p className="px-1 text-xs text-slate-400">
            Net profit is split {yahyaPct}/{ownerPct} between Yahya and the
            Owner.
          </p>
        </div>
      </div>

      {/* Daraz Import channel (separate from manual Sales above) */}
      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <DarazIncomeCard rollup={fin.daraz} subtitle={`Imported Daraz income · ${label}`} />
        </div>
        <StatCard
          label="Combined net (Manual + Daraz)"
          value={formatMoney(fin.netProfit + fin.daraz.net)}
          hint="Manual net profit + Daraz net income"
          tone="brand"
        />
      </div>

      {/* Methodology note */}
      <Card className="mt-3 border-slate-200 bg-slate-50/60">
        <CardBody className="flex gap-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
          <div className="space-y-1 text-xs leading-relaxed text-slate-500">
            <p>
              <span className="font-semibold text-slate-600">
                How this is calculated.
              </span>{' '}
              To avoid double counting, Daraz commission, VAT, other Daraz
              charges and product cost (COGS) are taken from the Sales entries.
            </p>
            <p>
              Operating expenses exclude those Daraz-side categories (they are
              already captured in Sales), and accessories consumed = quantity
              used × unit cost.
            </p>
            <p>
              <span className="font-semibold text-slate-600">Manual vs Daraz Import.</span>{' '}
              The statement above is the manual Sales channel. Imported Daraz
              income is shown separately as its own channel — its commission,
              fees and refunds are already inside the Daraz net, and a Return
              linked to imported income never deducts that refund again.
            </p>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Waterfall statement row
// ---------------------------------------------------------------------------

function PnlLine({
  label,
  amount,
  bold,
  deduction,
  subtotal,
  total,
  positive,
}: {
  label: string;
  amount: number;
  bold?: boolean;
  deduction?: boolean;
  subtotal?: boolean;
  total?: boolean;
  positive?: boolean;
}) {
  let rowClass = 'flex items-center justify-between gap-3 px-4 py-3 sm:px-5';
  let labelClass = 'text-sm text-slate-600';
  let amountClass = 'text-sm tabular-nums text-slate-800';
  let prefix: ReactNode = null;

  if (bold) {
    labelClass = 'text-sm font-semibold text-slate-800';
    amountClass = 'text-sm font-bold tabular-nums text-slate-900';
    prefix = <span className="mr-1 font-semibold text-emerald-500">+</span>;
  }

  if (deduction) {
    labelClass = 'text-sm text-slate-600';
    amountClass = 'text-sm tabular-nums text-rose-600';
  }

  if (subtotal) {
    rowClass =
      'flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/60 px-4 py-3 sm:px-5';
    labelClass = 'text-sm font-semibold text-slate-800';
    amountClass = `text-sm font-bold tabular-nums ${
      amount >= 0 ? 'text-slate-900' : 'text-rose-600'
    }`;
    prefix = <span className="mr-1 font-semibold text-slate-400">=</span>;
  }

  if (total) {
    rowClass =
      'flex items-center justify-between gap-3 border-t-2 border-slate-300 px-4 py-4 sm:px-5';
    labelClass =
      'text-sm font-bold uppercase tracking-wide text-slate-800 sm:text-base';
    amountClass = `text-2xl font-bold tabular-nums ${
      positive ? 'text-emerald-600' : 'text-rose-600'
    }`;
    prefix = <span className="mr-1 font-semibold text-slate-400">=</span>;
  }

  return (
    <div className={rowClass}>
      <dt className={labelClass}>
        {prefix}
        {label}
      </dt>
      <dd className={amountClass}>
        {deduction ? '− ' : ''}
        {formatMoney(amount)}
      </dd>
    </div>
  );
}
