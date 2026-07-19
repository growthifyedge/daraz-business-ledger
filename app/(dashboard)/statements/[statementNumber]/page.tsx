import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { summariseStatements } from '@/lib/daraz/statements';
import { ALL_FEE_CATEGORIES, FEE_CATEGORY_LABEL } from '@/lib/daraz/fees';
import { formatMoney } from '@/lib/utils';
import { Card, CardBody, CardHeader, Table, THead, TH, TD, TRow, Badge } from '@/components/ui';
import { ArrowLeft } from 'lucide-react';
import { CustomerReveal } from '../CustomerReveal';

export const dynamic = 'force-dynamic';

export default async function StatementDetail({
  params,
}: {
  params: Promise<{ statementNumber: string }>;
}) {
  await requireUser(); // OWNER or ADMIN
  const { statementNumber: raw } = await params;
  const statementNumber = decodeURIComponent(raw);

  const lines = await prisma.darazIncomeLine.findMany({
    where: { statementNumber },
    select: {
      id: true,
      orderItemId: true,
      orderNumber: true,
      sellerSku: true,
      productName: true,
      statementNumber: true,
      statementPeriod: true,
      releaseStatus: true,
      transactionDate: true,
      orderStatus: true,
      productPriceRevenue: true,
      buyerShippingCredit: true,
      totalCredits: true,
      totalDeductions: true,
      netAmount: true,
      fees: { select: { label: true, category: true, amount: true, vatAmount: true } },
      orderItem: { select: { itemName: true, status: true, productId: true } },
    },
    orderBy: { orderItemId: 'asc' },
  });

  if (lines.length === 0) notFound();

  const [summary] = summariseStatements(
    lines.map((l) => ({
      statementNumber: l.statementNumber,
      statementPeriod: l.statementPeriod,
      releaseStatus: l.releaseStatus,
      transactionDate: l.transactionDate,
      orderItemId: l.orderItemId,
      productPriceRevenue: l.productPriceRevenue,
      buyerShippingCredit: l.buyerShippingCredit,
      totalCredits: l.totalCredits,
      totalDeductions: l.totalDeductions,
      netAmount: l.netAmount,
      fees: l.fees,
    }))
  );

  return (
    <>
      <Link href="/statements" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft className="h-4 w-4" /> All statements
      </Link>
      <div className="mb-5">
        <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
          Statement {summary.statementNumber}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {summary.statementPeriod || '—'} · {summary.releaseStatus || '—'} ·{' '}
          {summary.orderItemCount} order items · {summary.lineCount} lines · net{' '}
          <strong>{formatMoney(summary.netPayout)}</strong>
        </p>
      </div>

      {/* --- fee breakdown --- */}
      <Card className="mb-4">
        <CardHeader title="Fee breakdown" subtitle="Every category preserved for this statement." />
        <CardBody className="p-0">
          <Table>
            <THead>
              <TRow>
                <TH>Category</TH>
                <TH align="right">Amount (Rs)</TH>
              </TRow>
            </THead>
            <tbody>
              {ALL_FEE_CATEGORIES.filter((c) => summary.byCategory[c] !== 0).map((c) => (
                <TRow key={c}>
                  <TD>{FEE_CATEGORY_LABEL[c]}</TD>
                  <TD align="right" className={summary.byCategory[c] < 0 ? 'text-rose-600' : ''}>
                    {formatMoney(summary.byCategory[c])}
                  </TD>
                </TRow>
              ))}
            </tbody>
            <tfoot>
              <TRow className="border-t-2 border-slate-200 font-semibold">
                <TD>Net payout</TD>
                <TD align="right">{formatMoney(summary.netPayout)}</TD>
              </TRow>
            </tfoot>
          </Table>
        </CardBody>
      </Card>

      {/* --- order items + fees --- */}
      <Card>
        <CardHeader
          title="Order items"
          subtitle="Customer and shipping details are masked. Reveal is Owner/Admin-only and audited."
        />
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <TRow>
                  <TH>Order Item ID</TH>
                  <TH>Order #</TH>
                  <TH>Item</TH>
                  <TH>Seller SKU</TH>
                  <TH align="center">Mapped</TH>
                  <TH align="right">Credits</TH>
                  <TH align="right">Deductions</TH>
                  <TH align="right">Net</TH>
                  <TH>Customer</TH>
                </TRow>
              </THead>
              <tbody>
                {lines.map((l) => {
                  return (
                    <TRow key={l.id}>
                      <TD className="font-mono text-xs">{l.orderItemId}</TD>
                      <TD className="text-xs text-slate-500">{l.orderNumber || '—'}</TD>
                      <TD className="max-w-[220px] truncate">{l.orderItem?.itemName || l.productName || '—'}</TD>
                      <TD className="font-mono text-xs">{l.sellerSku || '—'}</TD>
                      <TD align="center">
                        {l.orderItem?.productId ? <Badge tone="green">Yes</Badge> : <Badge tone="amber">No</Badge>}
                      </TD>
                      <TD align="right">{formatMoney(l.totalCredits)}</TD>
                      <TD align="right" className="text-rose-600">{formatMoney(l.totalDeductions)}</TD>
                      <TD align="right" className="font-medium">{formatMoney(l.netAmount)}</TD>
                      <TD>
                        <CustomerReveal orderItemId={l.orderItemId} />
                      </TD>
                    </TRow>
                  );
                })}
              </tbody>
            </Table>
          </div>
        </CardBody>
      </Card>
    </>
  );
}
