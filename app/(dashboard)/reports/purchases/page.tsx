import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { parseFilter, rangeLabel, type SearchParams } from '@/lib/filters';
import { getYahyaCashSummary } from '@/lib/calculations';
import { FilterBar } from '@/components/FilterBar';
import { ExportButtons } from '@/components/ExportButtons';
import {
  Card,
  CardBody,
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
import { formatMoney, formatNumber, formatDate, humanize } from '@/lib/utils';

export const metadata = { title: 'Purchase Report' };
export const dynamic = 'force-dynamic';

export default async function PurchasesReportPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const filter = parseFilter(sp);

  const where: Prisma.PurchaseWhereInput = { deletedAt: null };
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

  const [stores, purchases, yahya] = await Promise.all([
    prisma.store.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.purchase.findMany({
      where,
      orderBy: { date: 'desc' },
      select: {
        id: true,
        date: true,
        quantity: true,
        unitCost: true,
        totalCost: true,
        paymentStatus: true,
        bankReference: true,
        product: { select: { name: true } },
        store: { select: { name: true } },
      },
    }),
    getYahyaCashSummary(filter),
  ]);

  const rows = purchases.map((p) => ({
    date: formatDate(p.date),
    product: p.product?.name ?? '—',
    store: p.store?.name ?? '—',
    qty: p.quantity,
    unitCost: p.unitCost,
    total: p.totalCost,
    status:
      p.paymentStatus === 'RECONCILIATION_PENDING'
        ? 'Payment reconciliation pending'
        : humanize(p.paymentStatus),
    bankRef: p.bankReference ?? '',
  }));

  const total = purchases.reduce((a, p) => a + p.totalCost, 0);
  const payable = yahya.payableToYahya;
  const reconciliationPending = yahya.reconciliationPending;
  const count = purchases.length;

  const columns = [
    { key: 'date', label: 'Date' },
    { key: 'product', label: 'Product' },
    { key: 'store', label: 'Store' },
    { key: 'qty', label: 'Qty' },
    { key: 'unitCost', label: 'Unit Cost', money: true },
    { key: 'total', label: 'Total', money: true },
    { key: 'status', label: 'Status' },
    { key: 'bankRef', label: 'Bank Ref' },
  ];

  return (
    <>
      <Link
        href="/reports"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 transition hover:text-brand-600"
      >
        <ArrowLeft className="h-4 w-4" /> Back to reports
      </Link>

      <PageHeader title="Purchases" description={rangeLabel(filter)} />

      <FilterBar stores={stores} />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total Purchased" value={formatMoney(total)} tone="brand" />
        <StatCard
          label="Payable to Yahya"
          value={formatMoney(payable)}
          hint="Outstanding balance (unpaid + partially paid)"
          tone={payable > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="Payment reconciliation pending"
          value={formatMoney(reconciliationPending)}
          tone={reconciliationPending > 0 ? 'warning' : 'default'}
        />
        <StatCard label="Purchase Records" value={formatNumber(count)} />
      </div>

      {purchases.length === 0 ? (
        <EmptyState title="No purchases in this range" message="Adjust the filters to see purchases." />
      ) : (
        <Card>
          <CardBody className="p-0">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
              <h3 className="text-sm font-semibold text-slate-800">Purchases</h3>
              <ExportButtons
                title="Purchase Report"
                filename="purchase-report"
                subtitle={rangeLabel(filter)}
                columns={columns}
                rows={rows}
              />
            </div>
            <Table>
              <THead>
                <TRow>
                  <TH>Date</TH>
                  <TH>Product</TH>
                  <TH>Store</TH>
                  <TH align="right">Qty</TH>
                  <TH align="right">Unit Cost</TH>
                  <TH align="right">Total</TH>
                  <TH align="center">Status</TH>
                  <TH>Bank Ref</TH>
                </TRow>
              </THead>
              <tbody>
                {purchases.map((p) => (
                  <TRow key={p.id}>
                    <TD>{formatDate(p.date)}</TD>
                    <TD className="max-w-[160px] truncate font-medium text-slate-800">
                      {p.product?.name ?? '—'}
                    </TD>
                    <TD className="text-slate-500">{p.store?.name ?? '—'}</TD>
                    <TD align="right">{formatNumber(p.quantity)}</TD>
                    <TD align="right">{formatMoney(p.unitCost)}</TD>
                    <TD align="right" className="font-medium">
                      {formatMoney(p.totalCost)}
                    </TD>
                    <TD align="center">
                      <Badge tone={p.paymentStatus === 'PAID' ? 'green' : 'amber'}>
                        {humanize(p.paymentStatus)}
                      </Badge>
                    </TD>
                    <TD className="text-slate-500">{p.bankReference ?? '—'}</TD>
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
