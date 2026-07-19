import { prisma } from '@/lib/prisma';
import { getCashFlow, getFinancials } from '@/lib/calculations';
import { parseFilter, type SearchParams } from '@/lib/filters';
import { FilterBar } from '@/components/FilterBar';
import { StatCard } from '@/components/ui';
import { formatMoney } from '@/lib/utils';
import { CashFlowManager } from './CashFlowManager';

export const metadata = { title: 'Cash Flow' };
export const dynamic = 'force-dynamic';

export default async function CashFlowPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const filter = parseFilter(sp);

  const [cash, fin, stores, investments, payouts] = await Promise.all([
    getCashFlow(filter),
    getFinancials(filter),
    prisma.store.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.investment.findMany({
      where: { deletedAt: null },
      orderBy: { date: 'desc' },
    }),
    prisma.payout.findMany({
      where: { deletedAt: null },
      orderBy: { date: 'desc' },
    }),
  ]);

  const paidYahya = payouts
    .filter((p) => p.party === 'YAHYA')
    .reduce((sum, p) => sum + p.amount, 0);
  const paidOwner = payouts
    .filter((p) => p.party === 'OWNER')
    .reduce((sum, p) => sum + p.amount, 0);

  const payableYahya = fin.yahyaShare - paidYahya;
  const payableOwner = fin.ownerShare - paidOwner;

  const investmentRows = investments.map((i) => ({
    id: i.id,
    date: i.date.toISOString(),
    amount: i.amount,
    note: i.note,
  }));

  const payoutRows = payouts.map((p) => ({
    id: p.id,
    date: p.date.toISOString(),
    party: p.party,
    amount: p.amount,
    note: p.note,
  }));

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
          Cash Flow
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Owner investments, profit-share payouts and the money-in / money-out summary.
        </p>
      </div>

      <FilterBar stores={stores} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        <StatCard label="Owner Investment" value={formatMoney(cash.investment)} tone="brand" />
        <StatCard
          label="Daraz Settlements Received"
          value={formatMoney(cash.settlementsReceived)}
          tone="positive"
        />
        <StatCard
          label="Reimbursements Paid (to Yahya)"
          value={formatMoney(cash.reimbursementsPaid)}
        />
        <StatCard label="Expenses Paid" value={formatMoney(cash.expensesPaid)} />
        <StatCard label="Payouts Paid" value={formatMoney(cash.payoutsPaid)} />
        <StatCard
          label="Net Cash Balance"
          value={formatMoney(cash.netCashBalance)}
          tone={cash.netCashBalance >= 0 ? 'positive' : 'brand'}
        />
        <StatCard
          label="Unpaid Purchases (owed to Yahya)"
          value={formatMoney(cash.stockPurchaseUnpaid)}
          tone={cash.stockPurchaseUnpaid > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="Payment reconciliation pending"
          value={formatMoney(cash.reconciliationPending)}
          hint="Not owed or paid — no cash impact"
          tone={cash.reconciliationPending > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="Yahya Share Payable"
          value={formatMoney(payableYahya)}
          hint="Earned share − paid out"
          tone={payableYahya > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="Owner Share Payable"
          value={formatMoney(payableOwner)}
          hint="Earned share − paid out"
          tone={payableOwner > 0 ? 'warning' : 'default'}
        />
      </div>

      <div className="mt-4">
        <CashFlowManager investments={investmentRows} payouts={payoutRows} />
      </div>
    </div>
  );
}
