import { getCashFlow } from '@/lib/calculations';
import { prisma } from '@/lib/prisma';
import { parseFilter, rangeLabel, type SearchParams } from '@/lib/filters';
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
  const storeFiltered = !!filter.storeId;

  const [cash, stores, investments, payouts] = await Promise.all([
    getCashFlow(filter),
    prisma.store.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.investment.findMany({ where: { deletedAt: null }, orderBy: { date: 'desc' } }),
    prisma.payout.findMany({ where: { deletedAt: null }, orderBy: { date: 'desc' } }),
  ]);

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
        <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">Cash Flow</h1>
        <p className="mt-1 text-sm text-slate-500">
          Actual cash in and out, expected Daraz money, and outstanding obligations — {rangeLabel(filter)}.
        </p>
      </div>

      <FilterBar stores={stores} />

      {/* A. Actual cash movement ------------------------------------------- */}
      <SectionTitle
        title="A · Actual cash movement"
        subtitle="Real money received minus real money paid in the selected period."
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        {storeFiltered ? (
          <StatCard
            label="Owner Investment"
            value="—"
            hint="Not store-specific — shown in All Stores"
          />
        ) : (
          <StatCard label="Owner Investment" value={formatMoney(cash.investment)} tone="brand" />
        )}
        <StatCard
          label="Daraz Released payouts"
          value={formatMoney(cash.darazReleasedNet)}
          hint="Imported income marked Released"
          tone="positive"
        />
        <StatCard
          label="Reimbursed to Yahya for stock purchases"
          value={formatMoney(cash.reimbursedToYahya)}
          hint="Bank transfers repaying stock Yahya fronted"
        />
        <StatCard label="Expenses paid" value={formatMoney(cash.expensesPaid)} />
        {storeFiltered ? (
          <StatCard
            label="Profit payouts paid"
            value="—"
            hint="Not store-specific — shown in All Stores"
          />
        ) : (
          <StatCard label="Profit payouts paid" value={formatMoney(cash.profitPayoutsPaid)} />
        )}
        <StatCard
          label="Net Cash Movement"
          value={formatMoney(cash.netCashMovement)}
          hint="Cash received − cash paid (not a bank balance)"
          tone={cash.netCashMovement >= 0 ? 'positive' : 'negative'}
        />
      </div>
      <p className="mt-2 text-xs text-slate-500">
        <span className="font-medium text-slate-600">Net Cash Movement</span> is actual cash received
        minus actual cash paid within the selected period. This is not a bank balance because no
        opening bank balance is recorded.
        {storeFiltered && (
          <>
            {' '}
            Owner investment and profit payouts are not store-specific, so they are excluded from a
            single store&rsquo;s movement — view <span className="font-medium">All stores</span> to see
            them.
          </>
        )}
      </p>

      {/* B. Expected Daraz cash -------------------------------------------- */}
      <SectionTitle
        title="B · Expected Daraz cash — not included in cash movement"
        subtitle="Imported income that Daraz has not released yet."
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        <StatCard
          label="Expected Daraz payout — Ready to Release"
          value={formatMoney(cash.darazReadyToReleaseNet)}
          hint="Becomes cash only once Daraz marks it Released"
          tone="warning"
        />
      </div>

      {/* C. Outstanding obligations ---------------------------------------- */}
      <SectionTitle
        title="C · Outstanding obligations — not included in cash movement"
        subtitle="What is still owed. None of these are cash movements."
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        <StatCard
          label="Owed to Yahya for stock purchases"
          value={formatMoney(cash.owedToYahya)}
          hint="Stock debt at cost — repaid by bank transfer, NOT a profit share"
          tone={cash.owedToYahya > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="Yahya profit share — earned, unpaid"
          value={formatMoney(cash.yahyaShareUnpaid)}
          hint="Yahya's 50% of net profit — paid only when a Profit Payout is recorded"
          tone={cash.yahyaShareUnpaid > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="Owner profit share — earned, unpaid"
          value={formatMoney(cash.ownerShareUnpaid)}
          hint="Owner's 50% of net profit — paid only when a Profit Payout is recorded"
          tone={cash.ownerShareUnpaid > 0 ? 'warning' : 'default'}
        />
        {cash.reconciliationPending > 0 && (
          <StatCard
            label="Payment reconciliation pending"
            value={formatMoney(cash.reconciliationPending)}
            hint="Paid in reality, amount/date not yet reconciled — no cash impact"
          />
        )}
      </div>

      <div className="mt-4">
        <CashFlowManager investments={investmentRows} payouts={payoutRows} />
      </div>
    </div>
  );
}

function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-2 mt-6">
      <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
      <p className="text-xs text-slate-500">{subtitle}</p>
    </div>
  );
}
