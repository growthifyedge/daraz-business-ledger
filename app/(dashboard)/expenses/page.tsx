import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import type { SearchParams } from '@/lib/filters';
import { parsePagination, buildPageMeta, searchFilter } from '@/lib/pagination';
import { ExpensesManager } from './ExpensesManager';
import { getPresentationContext } from '@/lib/presentation/context';
import {
  toExpensesPresentationRows,
  toExpensesPresentationTotals,
} from '@/lib/presentation/viewmodels/expenses';
import { ExpensesPresentationView } from './ExpensesPresentationView';

export const metadata = { title: 'Expenses' };
export const dynamic = 'force-dynamic';

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const { page, pageSize, skip, take, q } = parsePagination(sp);

  const where: Prisma.ExpenseWhereInput = {
    deletedAt: null,
    ...searchFilter(q, ['notes', 'paidBy', 'paymentMethod']),
  };

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  // ── Presentation Safe View: read-only, fully-redacted branch. ──────────────
  // The normal path below is unchanged. This never fetches the payer name,
  // payment method, receipt URL or notes; the amount is shown only as a
  // band/status; and no mutation controls or file links are rendered.
  const presentation = await getPresentationContext();
  if (presentation.active) {
    const [pExpenses, pCount, pTotalAgg, pMonthAgg] = await Promise.all([
      prisma.expense.findMany({
        where,
        orderBy: { date: 'desc' },
        skip,
        take,
        select: {
          id: true,
          date: true,
          category: true,
          amount: true,
          store: { select: { name: true } },
        },
      }),
      prisma.expense.count({ where }),
      prisma.expense.aggregate({ where, _sum: { amount: true } }),
      prisma.expense.aggregate({
        where: { ...where, date: { gte: startOfMonth } },
        _sum: { amount: true },
      }),
    ]);

    const rows = toExpensesPresentationRows(
      pExpenses.map((e) => ({
        id: e.id,
        date: e.date.toISOString(),
        category: e.category,
        storeName: e.store?.name ?? null,
        amount: e.amount,
      })),
      presentation
    );
    const totals = toExpensesPresentationTotals(
      { total: pTotalAgg._sum.amount ?? 0, month: pMonthAgg._sum.amount ?? 0, count: pCount },
      presentation
    );

    return (
      <ExpensesPresentationView
        rows={rows}
        totals={totals}
        page={page}
        pageSize={pageSize}
        total={pCount}
      />
    );
  }

  const [expenses, count, totalAgg, monthAgg, stores] = await Promise.all([
    prisma.expense.findMany({
      where,
      orderBy: { date: 'desc' },
      skip,
      take,
      include: {
        store: { select: { name: true } },
      },
    }),
    prisma.expense.count({ where }),
    prisma.expense.aggregate({ where, _sum: { amount: true } }),
    prisma.expense.aggregate({
      where: { ...where, date: { gte: startOfMonth } },
      _sum: { amount: true },
    }),
    prisma.store.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
  ]);

  const rows = expenses.map((e) => ({
    id: e.id,
    date: e.date.toISOString(),
    category: e.category,
    storeId: e.storeId,
    storeName: e.store?.name ?? null,
    amount: e.amount,
    paidBy: e.paidBy,
    paymentMethod: e.paymentMethod,
    receiptUrl: e.receiptUrl,
    notes: e.notes,
  }));

  return (
    <ExpensesManager
      expenses={rows}
      stores={stores}
      totals={{
        total: totalAgg._sum.amount ?? 0,
        month: monthAgg._sum.amount ?? 0,
        count,
      }}
      meta={buildPageMeta({ page, pageSize, skip, take, q }, count)}
    />
  );
}
