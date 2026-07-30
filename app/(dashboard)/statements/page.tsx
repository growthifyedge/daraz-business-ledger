import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { summariseStatements } from '@/lib/daraz/statements';
import { formatNumber, cn } from '@/lib/utils';
import { getPresentationContext } from '@/lib/presentation/context';
import { redactMoney, redactStatementNumber } from '@/lib/presentation/redact';
import { Card, CardBody, CardHeader, Table, THead, TH, TD, TRow, EmptyState } from '@/components/ui';
import { FileText } from 'lucide-react';

export const metadata = { title: 'Daraz Statements' };
export const dynamic = 'force-dynamic';

export default async function StatementsPage({
  searchParams,
}: {
  searchParams: Promise<{ store?: string }>;
}) {
  await requireUser(); // OWNER or ADMIN only

  // Presentation Safe View: money redacted server-side (identity when inactive);
  // statement numbers masked and their drill-down suppressed.
  const presentation = await getPresentationContext();
  const money = (n: number) => redactMoney(n, presentation);

  const sp = await searchParams;
  const requestedStore = typeof sp.store === 'string' ? sp.store : '';

  const stores = await prisma.store.findMany({
    where: { deletedAt: null },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });
  // Ignore an unknown store id — falls back to All stores.
  const activeStore = stores.find((s) => s.id === requestedStore) ?? null;

  const rows = await prisma.darazIncomeLine.findMany({
    where: activeStore ? { storeId: activeStore.id } : {},
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
  });

  const statements = summariseStatements(rows.map((l) => ({ ...l, storeName: l.store?.name ?? null })));
  const grand = statements.reduce(
    (a, s) => ({
      lines: a.lines + s.lineCount,
      orders: a.orders + s.orderItemCount,
      credits: a.credits + s.totalCredits,
      deductions: a.deductions + s.totalDeductions,
      net: a.net + s.netPayout,
    }),
    { lines: 0, orders: 0, credits: 0, deductions: 0, net: 0 }
  );

  const chip = (active: boolean) =>
    cn(
      'rounded-full border px-3 py-1 text-xs font-medium transition',
      active
        ? 'border-brand-500 bg-brand-50 text-brand-700'
        : 'border-slate-200 text-slate-600 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700'
    );

  return (
    <>
      <div className="mb-4">
        <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">Daraz Statements</h1>
        <p className="mt-1 text-sm text-slate-500">
          Weekly settlement statements imported from Daraz Income, per store. Every fee category is
          preserved. No customer, shipping, billing or tracking data is stored or shown.
        </p>
      </div>

      {/* Store filter — All stores / each store. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Store</span>
        <Link href="/statements" className={chip(!activeStore)}>
          All stores
        </Link>
        {stores.map((s) => (
          <Link key={s.id} href={`/statements?store=${encodeURIComponent(s.id)}`} className={chip(activeStore?.id === s.id)}>
            {s.name}
          </Link>
        ))}
      </div>

      {statements.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-10 w-10" />}
          title={activeStore ? `No statements for ${activeStore.name}` : 'No statements imported yet'}
          message={
            activeStore
              ? 'Try a different store, or import Daraz Orders + Income for this store from the Daraz Import page.'
              : 'Import Daraz Orders + Income from the Daraz Import page to populate statements.'
          }
        />
      ) : (
        <Card>
          <CardHeader
            title={`${statements.length} statement(s)${activeStore ? ` · ${activeStore.name}` : ''}`}
            subtitle={`${formatNumber(grand.orders)} order items · ${formatNumber(grand.lines)} statement lines · net ${money(grand.net)}`}
          />
          <CardBody className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <THead>
                  <TRow>
                    <TH>Statement</TH>
                    <TH>Store</TH>
                    <TH>Period</TH>
                    <TH>Release</TH>
                    <TH align="right">Items</TH>
                    <TH align="right">Product rev.</TH>
                    <TH align="right">Buyer ship.</TH>
                    <TH align="right">Credits</TH>
                    <TH align="right">Commission</TH>
                    <TH align="right">Payment</TH>
                    <TH align="right">Shipping</TH>
                    <TH align="right">Handling</TH>
                    <TH align="right">Free-ship max</TH>
                    <TH align="right">Coins</TH>
                    <TH align="right">Voucher</TH>
                    <TH align="right">Inc.Tax WHT</TH>
                    <TH align="right">Sales Tax WHT</TH>
                    <TH align="right">Refunds</TH>
                    <TH align="right">Reversals</TH>
                    <TH align="right">Deductions</TH>
                    <TH align="right">Net payout</TH>
                  </TRow>
                </THead>
                <tbody>
                  {statements.map((s) => (
                    <TRow key={s.statementNumber}>
                      <TD className="font-medium">
                        {presentation.active ? (
                          <span className="text-slate-700">
                            {redactStatementNumber(s.statementNumber, presentation)}
                          </span>
                        ) : (
                          <Link href={`/statements/${encodeURIComponent(s.statementNumber)}`} className="text-brand-700 hover:underline">
                            {s.statementNumber}
                          </Link>
                        )}
                      </TD>
                      <TD className="whitespace-nowrap text-xs text-slate-600">{s.storeName || '—'}</TD>
                      <TD className="whitespace-nowrap text-xs text-slate-500">{s.statementPeriod || '—'}</TD>
                      <TD className="text-xs">{s.releaseStatus || '—'}</TD>
                      <TD align="right">{s.orderItemCount}</TD>
                      <TD align="right">{money(s.productRevenue)}</TD>
                      <TD align="right">{money(s.buyerShippingCredit)}</TD>
                      <TD align="right">{money(s.totalCredits)}</TD>
                      <TD align="right" className="text-rose-600">{money(s.commission)}</TD>
                      <TD align="right" className="text-rose-600">{money(s.paymentFee)}</TD>
                      <TD align="right" className="text-rose-600">{money(s.shippingFee)}</TD>
                      <TD align="right" className="text-rose-600">{money(s.handlingFee)}</TD>
                      <TD align="right" className="text-rose-600">{money(s.freeShippingMaxFee)}</TD>
                      <TD align="right" className="text-rose-600">{money(s.coinsFee)}</TD>
                      <TD align="right" className="text-rose-600">{money(s.voucherFee)}</TD>
                      <TD align="right" className="text-rose-600">{money(s.incomeTaxWht)}</TD>
                      <TD align="right" className="text-rose-600">{money(s.salesTaxWht)}</TD>
                      <TD align="right" className={s.refunds < 0 ? 'text-rose-600' : ''}>{money(s.refunds)}</TD>
                      <TD align="right">{money(s.reversals)}</TD>
                      <TD align="right" className="text-rose-600">{money(s.totalDeductions)}</TD>
                      <TD align="right" className="font-semibold">{money(s.netPayout)}</TD>
                    </TRow>
                  ))}
                </tbody>
                <tfoot>
                  <TRow className="border-t-2 border-slate-200 font-semibold">
                    <TD colSpan={4}>{activeStore ? activeStore.name : 'All statements'}</TD>
                    <TD align="right">{formatNumber(grand.orders)}</TD>
                    <TD colSpan={2} />
                    <TD align="right">{money(grand.credits)}</TD>
                    <TD colSpan={10} />
                    <TD align="right" className="text-rose-600">{money(grand.deductions)}</TD>
                    <TD align="right">{money(grand.net)}</TD>
                  </TRow>
                </tfoot>
              </Table>
            </div>
          </CardBody>
        </Card>
      )}
    </>
  );
}
