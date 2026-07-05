import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { parseFilter, rangeLabel, type SearchParams } from '@/lib/filters';
import { FilterBar } from '@/components/FilterBar';
import { ExportButtons } from '@/components/ExportButtons';
import {
  Card,
  CardBody,
  PageHeader,
  StatCard,
  EmptyState,
  Table,
  THead,
  TH,
  TD,
  TRow,
} from '@/components/ui';
import { formatMoney, formatNumber, formatDate, humanize } from '@/lib/utils';

export const metadata = { title: 'Expense Report' };
export const dynamic = 'force-dynamic';

export default async function ExpensesReportPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const filter = parseFilter(sp);

  const where: Prisma.ExpenseWhereInput = { deletedAt: null };
  if (filter.from || filter.to) {
    const range: { gte?: Date; lte?: Date } = {};
    if (filter.from) range.gte = filter.from;
    if (filter.to) {
      const end = new Date(filter.to);
      end.setHours(23, 59, 59, 999);
      range.lte = end;
    }
    where.date = range;
  }
  if (filter.storeId) where.storeId = filter.storeId;

  const [stores, expenses] = await Promise.all([
    prisma.store.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.expense.findMany({
      where,
      orderBy: { date: 'desc' },
      select: {
        id: true,
        date: true,
        category: true,
        amount: true,
        paidBy: true,
        paymentMethod: true,
        store: { select: { name: true } },
      },
    }),
  ]);

  const rows = expenses.map((e) => ({
    date: formatDate(e.date),
    category: humanize(e.category),
    store: e.store?.name ?? '—',
    amount: e.amount,
    paidBy: e.paidBy ?? '',
    method: e.paymentMethod ?? '',
  }));

  const total = expenses.reduce((a, e) => a + e.amount, 0);
  const count = expenses.length;

  // Top category by total spend.
  const byCategory = new Map<string, number>();
  for (const e of expenses) {
    byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + e.amount);
  }
  let topCategory = '—';
  let topAmount = -1;
  for (const [cat, amt] of byCategory) {
    if (amt > topAmount) {
      topAmount = amt;
      topCategory = humanize(cat);
    }
  }

  const columns = [
    { key: 'date', label: 'Date' },
    { key: 'category', label: 'Category' },
    { key: 'store', label: 'Store' },
    { key: 'amount', label: 'Amount', money: true },
    { key: 'paidBy', label: 'Paid By' },
    { key: 'method', label: 'Method' },
  ];

  return (
    <>
      <Link
        href="/reports"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 transition hover:text-brand-600"
      >
        <ArrowLeft className="h-4 w-4" /> Back to reports
      </Link>

      <PageHeader title="Expenses" description={rangeLabel(filter)} />

      <FilterBar stores={stores} />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Total Expenses" value={formatMoney(total)} tone="negative" />
        <StatCard label="Records" value={formatNumber(count)} />
        <StatCard
          label="Top Category"
          value={topCategory}
          hint={topAmount >= 0 ? formatMoney(topAmount) : undefined}
        />
      </div>

      {expenses.length === 0 ? (
        <EmptyState title="No expenses in this range" message="Adjust the filters to see expenses." />
      ) : (
        <Card>
          <CardBody className="p-0">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
              <h3 className="text-sm font-semibold text-slate-800">Expenses</h3>
              <ExportButtons
                title="Expense Report"
                filename="expense-report"
                subtitle={rangeLabel(filter)}
                columns={columns}
                rows={rows}
              />
            </div>
            <Table>
              <THead>
                <TRow>
                  <TH>Date</TH>
                  <TH>Category</TH>
                  <TH>Store</TH>
                  <TH align="right">Amount</TH>
                  <TH>Paid By</TH>
                  <TH>Method</TH>
                </TRow>
              </THead>
              <tbody>
                {expenses.map((e) => (
                  <TRow key={e.id}>
                    <TD>{formatDate(e.date)}</TD>
                    <TD className="font-medium text-slate-800">{humanize(e.category)}</TD>
                    <TD className="text-slate-500">{e.store?.name ?? '—'}</TD>
                    <TD align="right" className="font-medium">
                      {formatMoney(e.amount)}
                    </TD>
                    <TD className="text-slate-500">{e.paidBy ?? '—'}</TD>
                    <TD className="text-slate-500">{e.paymentMethod ?? '—'}</TD>
                  </TRow>
                ))}
              </tbody>
            </Table>
          </CardBody>
        </Card>
      )}
    </>
  );
}
