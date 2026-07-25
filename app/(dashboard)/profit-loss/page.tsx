import type { ReactNode } from 'react';
import { getFinancials } from '@/lib/calculations';
import { parseFilter, rangeLabel } from '@/lib/filters';
import type { SearchParams } from '@/lib/filters';
import { prisma } from '@/lib/prisma';
import { Card, CardBody, CardHeader, PageHeader, StatCard } from '@/components/ui';
import { FilterBar } from '@/components/FilterBar';
import { DarazIncomeCard } from '@/components/DarazIncomeCard';
import { buildBusinessPnl } from '@/lib/daraz/income';
import { PnlExport } from './PnlExport';
import { formatMoney, formatNumber } from '@/lib/utils';
import { PROFIT_SPLIT } from '@/lib/config';
import { Info, TrendingUp, Users, Wallet, ChevronDown } from 'lucide-react';

export const metadata = { title: 'Business Profit & Loss' };
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

  // Presentation-only: derive the unified statement lines from existing figures.
  const pnl = buildBusinessPnl({
    darazNet: fin.daraz.net,
    estimatedDarazCogs: fin.estimatedDarazCogs,
    grossSales: fin.grossSales,
    productCost: fin.productCost,
    commission: fin.commission,
    vat: fin.vat,
    otherDarazCharges: fin.otherDarazCharges,
    returnsRefunds: fin.returnsRefunds,
    operatingExpenses: fin.operatingExpenses,
    accessoriesConsumed: fin.accessoriesConsumed,
    combinedNetProfit: fin.combinedNetProfit,
  });
  const manualSalesMargin = pnl.manualSalesMargin;
  const hasManual = pnl.hasManualSales;
  const combinedPositive = fin.combinedNetProfit >= 0;

  // Flattened rows for CSV / PDF export — mirrors the unified statement.
  const exportRows = [
    { item: 'Daraz Net income', amount: fin.daraz.net },
    { item: 'Estimated Daraz COGS (Delivered)', amount: -fin.estimatedDarazCogs },
    ...(hasManual ? [{ item: 'Manual Sales margin (optional)', amount: manualSalesMargin }] : []),
    { item: 'Operating Expenses', amount: -fin.operatingExpenses },
    { item: 'Accessories Consumed', amount: -fin.accessoriesConsumed },
    { item: 'ESTIMATED BUSINESS NET PROFIT', amount: fin.combinedNetProfit },
    { item: `Estimated Yahya Share (${yahyaPct}%)`, amount: fin.yahyaShare },
    { item: `Estimated Owner Share (${ownerPct}%)`, amount: fin.ownerShare },
    { item: '— Daraz breakdown —', amount: 0 },
    { item: 'Daraz gross revenue', amount: fin.daraz.grossRevenue },
    { item: 'Daraz fees', amount: fin.daraz.darazFees },
    { item: 'Daraz taxes withheld', amount: fin.daraz.taxesWithheld },
    { item: 'Daraz refunds', amount: fin.daraz.refunds },
    { item: 'Daraz reversals', amount: fin.daraz.reversals },
  ];

  return (
    <div>
      <PageHeader title="Business Profit & Loss" description={`Estimated statement for ${label}`}>
        <PnlExport rows={exportRows} title="Estimated Business Profit & Loss" subtitle={label} />
      </PageHeader>

      <FilterBar stores={stores} />

      <div className="grid gap-3 lg:grid-cols-3">
        {/* Unified statement */}
        <Card className="lg:col-span-2 overflow-hidden">
          <CardHeader
            title={
              <span className="flex items-center gap-1.5">
                <TrendingUp className="h-4 w-4 text-brand-500" />
                Estimated Business Profit &amp; Loss
              </span>
            }
            subtitle={`Daraz income costed at product purchase cost (estimated) · ${label}`}
          />
          <CardBody className="p-0">
            <dl className="divide-y divide-slate-100">
              <PnlLine label="Daraz Net income" amount={fin.daraz.net} bold />
              <PnlLine label="Estimated Daraz COGS (Delivered)" amount={fin.estimatedDarazCogs} deduction />
              {hasManual && (
                <PnlLine label="Manual Sales margin (optional, separate channel)" amount={manualSalesMargin} />
              )}
              <PnlLine label="Operating Expenses" amount={fin.operatingExpenses} deduction />
              <PnlLine label="Accessories Consumed" amount={fin.accessoriesConsumed} deduction />
              <PnlLine
                label="Estimated Business Net Profit"
                amount={fin.combinedNetProfit}
                total
                positive={combinedPositive}
              />
            </dl>

            {/* Expandable Daraz breakdown — gross revenue, fees, taxes, refunds, reversals */}
            <details className="group border-t border-slate-100">
              <summary className="flex cursor-pointer items-center justify-between gap-2 px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-50 sm:px-5">
                <span>Daraz breakdown (gross revenue, fees, taxes, refunds, reversals)</span>
                <ChevronDown className="h-4 w-4 shrink-0 transition group-open:rotate-180" />
              </summary>
              <div className="p-4 sm:p-5">
                <DarazIncomeCard rollup={fin.daraz} subtitle={`Imported Daraz income · ${label}`} />
              </div>
            </details>
          </CardBody>
        </Card>

        {/* Net profit highlight + estimated profit split */}
        <div className="flex flex-col gap-3">
          <Card
            className={
              combinedPositive
                ? 'border-emerald-100 bg-gradient-to-br from-emerald-500 to-emerald-600 text-white'
                : 'border-rose-100 bg-gradient-to-br from-rose-500 to-rose-600 text-white'
            }
          >
            <CardBody>
              <p className="text-xs font-medium uppercase tracking-wide text-white/80">
                Estimated Business Net Profit
              </p>
              <p className="mt-1 text-3xl font-bold tabular-nums">{formatMoney(fin.combinedNetProfit)}</p>
              <p className="mt-1 text-xs text-white/80">
                Daraz net − est. COGS − operating costs · {label}
              </p>
            </CardBody>
          </Card>

          <StatCard
            label="Estimated Daraz COGS"
            value={`− ${formatMoney(fin.estimatedDarazCogs)}`}
            hint={`Delivered only · ${formatNumber(fin.darazCogs.costedUnits)}/${formatNumber(fin.darazCogs.deliveredUnits)} units costed (${fin.darazCogs.coveragePct}%)`}
            tone="negative"
          />
          <StatCard
            label={`Estimated Yahya Share (${yahyaPct}%)`}
            value={formatMoney(fin.yahyaShare)}
            hint={`${yahyaPct}% of estimated business net`}
            icon={<Users size={18} />}
            tone="brand"
          />
          <StatCard
            label={`Estimated Owner Share (${ownerPct}%)`}
            value={formatMoney(fin.ownerShare)}
            hint={`${ownerPct}% of estimated business net`}
            icon={<Wallet size={18} />}
            tone="brand"
          />
          {(fin.darazCogs.unmappedUnits > 0 || fin.darazCogs.missingCostUnits > 0) && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
              {formatNumber(fin.darazCogs.unmappedUnits)} delivered unit(s) unmapped,{' '}
              {formatNumber(fin.darazCogs.missingCostUnits)} mapped without a cost — excluded from COGS.
            </p>
          )}
        </div>
      </div>

      {/* Methodology note */}
      <Card className="mt-3 border-slate-200 bg-slate-50/60">
        <CardBody className="flex gap-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
          <div className="space-y-1 text-xs leading-relaxed text-slate-500">
            <p>
              <span className="font-semibold text-slate-600">Estimated.</span> Daraz income is the
              Daraz-authoritative net (commission, fees, taxes, refunds and reversals already inside
              it). COGS for delivered Daraz orders is estimated at each product&rsquo;s purchase cost —
              historic purchase lots are incomplete, so it is not yet date-aware FIFO. All net-profit
              and share figures are therefore <span className="font-semibold">Estimated</span> until
              FIFO purchase costing is available.
            </p>
            <p>
              <span className="font-semibold text-slate-600">Manual Sales are separate.</span> Any
              manually-entered sales appear only as the optional &ldquo;Manual Sales margin&rdquo; line
              above (and on the Manual Sales page) — they are not a competing P&amp;L. A Return linked
              to imported Daraz income never deducts its refund again.
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
    amountClass = `text-sm font-bold tabular-nums ${amount >= 0 ? 'text-slate-900' : 'text-rose-600'}`;
    prefix = <span className="mr-1 font-semibold text-slate-400">=</span>;
  }

  if (total) {
    rowClass = 'flex items-center justify-between gap-3 border-t-2 border-slate-300 px-4 py-4 sm:px-5';
    labelClass = 'text-sm font-bold uppercase tracking-wide text-slate-800 sm:text-base';
    amountClass = `text-2xl font-bold tabular-nums ${positive ? 'text-emerald-600' : 'text-rose-600'}`;
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
