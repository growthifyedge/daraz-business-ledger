import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { summariseStatements } from '@/lib/daraz/statements';
import { formatMoney, formatNumber } from '@/lib/utils';
import { Card, CardBody, CardHeader, Table, THead, TH, TD, TRow, EmptyState } from '@/components/ui';
import { FileText } from 'lucide-react';

export const metadata = { title: 'Daraz Statements' };
export const dynamic = 'force-dynamic';

export default async function StatementsPage() {
  await requireUser(); // OWNER or ADMIN only

  const lines = await prisma.darazIncomeLine.findMany({
    select: {
      statementNumber: true,
      statementPeriod: true,
      releaseStatus: true,
      transactionDate: true,
      orderItemId: true,
      productPriceRevenue: true,
      buyerShippingCredit: true,
      totalCredits: true,
      totalDeductions: true,
      netAmount: true,
      fees: { select: { category: true, amount: true } },
    },
  });

  const statements = summariseStatements(lines);
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

  return (
    <>
      <div className="mb-5">
        <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">Daraz Statements</h1>
        <p className="mt-1 text-sm text-slate-500">
          Weekly settlement statements imported from Daraz Income. Every fee category is preserved.
          Customer details are masked and require authorised reveal.
        </p>
      </div>

      {statements.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-10 w-10" />}
          title="No statements imported yet"
          message="Import Daraz Orders + Income from the Daraz Import page to populate statements."
        />
      ) : (
        <Card>
          <CardHeader
            title={`${statements.length} statement(s)`}
            subtitle={`${formatNumber(grand.orders)} order items · ${formatNumber(grand.lines)} statement lines · net ${formatMoney(grand.net)}`}
          />
          <CardBody className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <THead>
                  <TRow>
                    <TH>Statement</TH>
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
                        <Link href={`/statements/${encodeURIComponent(s.statementNumber)}`} className="text-brand-700 hover:underline">
                          {s.statementNumber}
                        </Link>
                      </TD>
                      <TD className="whitespace-nowrap text-xs text-slate-500">{s.statementPeriod || '—'}</TD>
                      <TD className="text-xs">{s.releaseStatus || '—'}</TD>
                      <TD align="right">{s.orderItemCount}</TD>
                      <TD align="right">{formatMoney(s.productRevenue)}</TD>
                      <TD align="right">{formatMoney(s.buyerShippingCredit)}</TD>
                      <TD align="right">{formatMoney(s.totalCredits)}</TD>
                      <TD align="right" className="text-rose-600">{formatMoney(s.commission)}</TD>
                      <TD align="right" className="text-rose-600">{formatMoney(s.paymentFee)}</TD>
                      <TD align="right" className="text-rose-600">{formatMoney(s.shippingFee)}</TD>
                      <TD align="right" className="text-rose-600">{formatMoney(s.handlingFee)}</TD>
                      <TD align="right" className="text-rose-600">{formatMoney(s.freeShippingMaxFee)}</TD>
                      <TD align="right" className="text-rose-600">{formatMoney(s.coinsFee)}</TD>
                      <TD align="right" className="text-rose-600">{formatMoney(s.voucherFee)}</TD>
                      <TD align="right" className="text-rose-600">{formatMoney(s.incomeTaxWht)}</TD>
                      <TD align="right" className="text-rose-600">{formatMoney(s.salesTaxWht)}</TD>
                      <TD align="right" className={s.refunds < 0 ? 'text-rose-600' : ''}>{formatMoney(s.refunds)}</TD>
                      <TD align="right">{formatMoney(s.reversals)}</TD>
                      <TD align="right" className="text-rose-600">{formatMoney(s.totalDeductions)}</TD>
                      <TD align="right" className="font-semibold">{formatMoney(s.netPayout)}</TD>
                    </TRow>
                  ))}
                </tbody>
                <tfoot>
                  <TRow className="border-t-2 border-slate-200 font-semibold">
                    <TD colSpan={3}>All statements</TD>
                    <TD align="right">{formatNumber(grand.orders)}</TD>
                    <TD colSpan={2} />
                    <TD align="right">{formatMoney(grand.credits)}</TD>
                    <TD colSpan={10} />
                    <TD align="right" className="text-rose-600">{formatMoney(grand.deductions)}</TD>
                    <TD align="right">{formatMoney(grand.net)}</TD>
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
