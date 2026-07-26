import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { parseFilter, rangeLabel } from '@/lib/filters';
import type { SearchParams } from '@/lib/filters';
import {
  filterPayoutLines,
  summariseDarazPayouts,
  type PayoutLineInput,
  type PayoutRow,
} from '@/lib/daraz/payouts';
import { formatMoney, formatNumber } from '@/lib/utils';
import {
  Card,
  CardBody,
  CardHeader,
  PageHeader,
  StatCard,
  Badge,
  EmptyState,
  Table,
  THead,
  TH,
  TD,
  TRow,
} from '@/components/ui';
import { FilterBar } from '@/components/FilterBar';
import { Banknote, Info, ArrowUpRight } from 'lucide-react';

export const metadata = { title: 'Daraz Payouts' };
export const dynamic = 'force-dynamic';

// Read-only. Payouts are derived purely from imported Daraz income — this route
// has NO create/edit/delete and never touches the legacy Settlement table.
export default async function PayoutsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireUser();

  const sp = await searchParams;
  const filter = parseFilter(sp);
  const label = rangeLabel(filter);

  const [stores, incomeRows] = await Promise.all([
    prisma.store.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.darazIncomeLine.findMany({
      select: {
        statementNumber: true,
        statementPeriod: true,
        releaseStatus: true,
        transactionDate: true,
        storeId: true,
        store: { select: { name: true } },
        orderItemId: true,
        productPriceRevenue: true,
        buyerShippingCredit: true,
        totalCredits: true,
        totalDeductions: true,
        netAmount: true,
        fees: { select: { category: true, amount: true } },
      },
    }),
  ]);

  const lines: PayoutLineInput[] = incomeRows.map((l) => ({
    ...l,
    storeName: l.store?.name ?? null,
  }));
  // Store + date scoping through the same pure helper the tests cover.
  const scoped = filterPayoutLines(lines, filter);
  const { rows, totals } = summariseDarazPayouts(scoped);

  return (
    <div>
      <PageHeader
        title="Daraz Payouts"
        description={`Automatic from imported Daraz income · ${label}`}
      />

      {/* Explanation — imported only, no manual fee entry. */}
      <Card className="mb-4 border-slate-200 bg-slate-50/60">
        <CardBody className="flex gap-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
          <p className="text-xs leading-relaxed text-slate-600">
            Payouts are created automatically from official Daraz Income CSV imports.{' '}
            <span className="font-medium text-amber-700">Ready to Release</span> is expected income;{' '}
            <span className="font-medium text-emerald-700">Released</span> is counted in Cash Flow.
            Do not enter Daraz commission, tax or charges manually.
          </p>
        </CardBody>
      </Card>

      <FilterBar stores={stores} />

      {/* Summary cards */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Ready to Release"
          value={formatMoney(totals.readyToReleaseTotal)}
          hint="Expected income (not yet in Cash Flow)"
          tone="warning"
        />
        <StatCard
          label="Released"
          value={formatMoney(totals.releasedTotal)}
          hint="Counted in Cash Flow"
          tone="positive"
        />
        <StatCard
          label="Total imported payouts"
          value={formatMoney(totals.totalPayouts)}
          hint="Net across all statuses"
        />
        <StatCard
          label="Statements"
          value={formatNumber(totals.statementCount)}
          hint="Store × statement number"
          icon={<Banknote size={18} />}
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<Banknote className="h-10 w-10" />}
          title="No Daraz payouts yet"
          message="Import an official Daraz Income CSV from the Daraz Import page to populate payouts. Nothing is entered manually here."
        />
      ) : (
        <Card>
          <CardHeader
            title={`${formatNumber(rows.length)} payout${rows.length === 1 ? '' : 's'}`}
            subtitle={`Net ${formatMoney(totals.totalPayouts)} · ${label}`}
          />
          <CardBody className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <THead>
                  <TRow>
                    <TH>Store</TH>
                    <TH>Statement</TH>
                    <TH>Period</TH>
                    <TH>Status</TH>
                    <TH align="right">Gross product rev.</TH>
                    <TH align="right">Buyer shipping</TH>
                    <TH align="right">Total deductions</TH>
                    <TH align="right">Net payout</TH>
                    <TH align="right">Detail</TH>
                  </TRow>
                </THead>
                <tbody>
                  {rows.map((r) => (
                    <TRow key={`${r.storeName}::${r.statementNumber}`}>
                      <TD className="whitespace-nowrap text-slate-600">{r.storeName || '—'}</TD>
                      <TD className="font-medium text-slate-800">{r.statementNumber}</TD>
                      <TD className="whitespace-nowrap text-xs text-slate-500">
                        {r.statementPeriod || '—'}
                      </TD>
                      <TD>
                        <StatusBadge row={r} />
                      </TD>
                      <TD align="right">{formatMoney(r.productRevenue)}</TD>
                      <TD align="right">{formatMoney(r.buyerShippingCredit)}</TD>
                      <TD align="right" className="text-rose-600">
                        {formatMoney(r.totalDeductions)}
                      </TD>
                      <TD align="right" className="font-semibold">
                        {formatMoney(r.netPayout)}
                      </TD>
                      <TD align="right">
                        <Link
                          href={`/statements/${encodeURIComponent(r.statementNumber)}`}
                          className="inline-flex items-center gap-1 text-brand-600 hover:text-brand-700 hover:underline"
                        >
                          View <ArrowUpRight className="h-3.5 w-3.5" />
                        </Link>
                      </TD>
                    </TRow>
                  ))}
                </tbody>
                <tfoot>
                  <TRow className="border-t-2 border-slate-200 font-semibold">
                    <TD colSpan={6}>All payouts</TD>
                    <TD align="right" className="text-rose-600">
                      {formatMoney(rows.reduce((a, r) => a + r.totalDeductions, 0))}
                    </TD>
                    <TD align="right">{formatMoney(totals.totalPayouts)}</TD>
                    <TD />
                  </TRow>
                </tfoot>
              </Table>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

// Show the raw Daraz status safely, coloured by its classification.
function StatusBadge({ row }: { row: PayoutRow }) {
  const raw = row.releaseStatus?.trim() || 'Unknown';
  if (row.statusKind === 'released') return <Badge tone="green">{raw}</Badge>;
  if (row.statusKind === 'ready') return <Badge tone="amber">{raw}</Badge>;
  return <Badge tone="slate">{raw}</Badge>;
}
