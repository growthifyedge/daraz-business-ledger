import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { prisma } from '@/lib/prisma';
import { getCashFlow } from '@/lib/calculations';
import { parseFilter, rangeLabel, type SearchParams } from '@/lib/filters';
import { FilterBar } from '@/components/FilterBar';
import { ExportButtons } from '@/components/ExportButtons';
import {
  Card,
  CardBody,
  PageHeader,
  StatCard,
  Table,
  THead,
  TH,
  TD,
  TRow,
} from '@/components/ui';
import { formatMoney } from '@/lib/utils';

export const metadata = { title: 'Cash Flow Report' };
export const dynamic = 'force-dynamic';

export default async function CashFlowReportPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const filter = parseFilter(sp);

  const [stores, cf] = await Promise.all([
    prisma.store.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    getCashFlow(filter),
  ]);

  const rows = [
    { item: 'Investment in', amount: cf.investment },
    { item: 'Settlements received', amount: cf.settlementsReceived },
    { item: 'Reimbursements paid', amount: -cf.reimbursementsPaid },
    { item: 'Expenses paid', amount: -cf.expensesPaid },
    { item: 'Payouts paid', amount: -cf.payoutsPaid },
    { item: 'Net Cash Balance', amount: cf.netCashBalance },
  ];

  const columns = [
    { key: 'item', label: 'Item' },
    { key: 'amount', label: 'Amount', money: true },
  ];

  return (
    <>
      <Link
        href="/reports"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 transition hover:text-brand-600"
      >
        <ArrowLeft className="h-4 w-4" /> Back to reports
      </Link>

      <PageHeader title="Cash Flow" description={rangeLabel(filter)} />

      <FilterBar stores={stores} />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Money In" value={formatMoney(cf.investment + cf.settlementsReceived)} tone="positive" />
        <StatCard
          label="Money Out"
          value={formatMoney(cf.reimbursementsPaid + cf.expensesPaid + cf.payoutsPaid)}
          tone="negative"
        />
        <StatCard label="Unpaid Purchases" value={formatMoney(cf.stockPurchaseUnpaid)} tone="warning" />
        <StatCard
          label="Payment reconciliation pending"
          value={formatMoney(cf.reconciliationPending)}
          tone={cf.reconciliationPending > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="Net Cash Balance"
          value={formatMoney(cf.netCashBalance)}
          tone={cf.netCashBalance >= 0 ? 'brand' : 'negative'}
        />
      </div>

      <Card>
        <CardBody className="p-0">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
            <h3 className="text-sm font-semibold text-slate-800">Cash Movement</h3>
            <ExportButtons
              title="Cash Flow Report"
              filename="cash-flow-report"
              subtitle={rangeLabel(filter)}
              columns={columns}
              rows={rows}
            />
          </div>
          <Table>
            <THead>
              <TRow>
                <TH>Item</TH>
                <TH align="right">Amount</TH>
              </TRow>
            </THead>
            <tbody>
              {rows.map((r) => (
                <TRow key={r.item}>
                  <TD className="font-medium text-slate-800">{r.item}</TD>
                  <TD align="right" className={r.amount < 0 ? 'text-rose-600' : undefined}>
                    {formatMoney(r.amount)}
                  </TD>
                </TRow>
              ))}
            </tbody>
          </Table>
        </CardBody>
      </Card>
    </>
  );
}
