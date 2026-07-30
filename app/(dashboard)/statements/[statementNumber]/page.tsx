import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { summariseStatements } from '@/lib/daraz/statements';
import { ALL_FEE_CATEGORIES, FEE_CATEGORY_LABEL } from '@/lib/daraz/fees';
import { getPresentationContext } from '@/lib/presentation/context';
import { redactMoney, redactStatementNumber, redactId } from '@/lib/presentation/redact';
import { Card, CardBody, CardHeader, Table, THead, TH, TD, TRow, Badge } from '@/components/ui';
import { ArrowLeft } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function StatementDetail({
  params,
}: {
  params: Promise<{ statementNumber: string }>;
}) {
  await requireUser(); // OWNER or ADMIN
  const { statementNumber: raw } = await params;
  const statementNumber = decodeURIComponent(raw);

  // Presentation Safe View: money redacted server-side (identity when inactive);
  // statement number and every order identifier masked.
  const presentation = await getPresentationContext();
  const money = (n: number) => redactMoney(n, presentation);

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
          {presentation.active
            ? redactStatementNumber(summary.statementNumber, presentation)
            : `Statement ${summary.statementNumber}`}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {summary.statementPeriod || '—'} · {summary.releaseStatus || '—'} ·{' '}
          {summary.orderItemCount} order items · {summary.lineCount} lines · net{' '}
          <strong>{money(summary.netPayout)}</strong>
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
                    {money(summary.byCategory[c])}
                  </TD>
                </TRow>
              ))}
            </tbody>
            <tfoot>
              <TRow className="border-t-2 border-slate-200 font-semibold">
                <TD>Net payout</TD>
                <TD align="right">{money(summary.netPayout)}</TD>
              </TRow>
            </tfoot>
          </Table>
        </CardBody>
      </Card>

      {/* --- order items + fees --- */}
      <Card>
        <CardHeader
          title="Order items"
          subtitle="Order identifiers and financial figures only. No customer, shipping, billing or tracking data is stored or shown."
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
                </TRow>
              </THead>
              <tbody>
                {lines.map((l) => {
                  return (
                    <TRow key={l.id}>
                      <TD className="font-mono text-xs">{redactId(l.orderItemId, presentation, 'OIT')}</TD>
                      <TD className="text-xs text-slate-500">{redactId(l.orderNumber, presentation, 'ORD') || '—'}</TD>
                      <TD className="max-w-[220px] truncate">{l.orderItem?.itemName || l.productName || '—'}</TD>
                      <TD className="font-mono text-xs">{redactId(l.sellerSku, presentation, 'SKU') || '—'}</TD>
                      <TD align="center">
                        {l.orderItem?.productId ? <Badge tone="green">Yes</Badge> : <Badge tone="amber">No</Badge>}
                      </TD>
                      <TD align="right">{money(l.totalCredits)}</TD>
                      <TD align="right" className="text-rose-600">{money(l.totalDeductions)}</TD>
                      <TD align="right" className="font-medium">{money(l.netAmount)}</TD>
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
