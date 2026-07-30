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
import { formatNumber, formatDate } from '@/lib/utils';
import { getPresentationContext } from '@/lib/presentation/context';
import { redactMoney } from '@/lib/presentation/redact';
import { redactExportRows } from '@/lib/presentation/viewmodels/exports';

export const metadata = { title: 'Sales Report' };
export const dynamic = 'force-dynamic';

export default async function SalesReportPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const filter = parseFilter(sp);

  // Presentation Safe View: money redacted server-side (identity when inactive).
  const presentation = await getPresentationContext();
  const money = (n: number) => redactMoney(n, presentation);

  const where: Prisma.SaleWhereInput = { deletedAt: null };
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

  const [stores, sales] = await Promise.all([
    prisma.store.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.sale.findMany({
      where,
      orderBy: { date: 'desc' },
      select: {
        id: true,
        date: true,
        quantitySold: true,
        grossAmount: true,
        commission: true,
        vat: true,
        otherCharges: true,
        returnsRefunds: true,
        netAmount: true,
        product: { select: { name: true } },
        store: { select: { name: true } },
      },
    }),
  ]);

  const rows = sales.map((s) => ({
    date: formatDate(s.date),
    product: s.product?.name ?? '—',
    store: s.store?.name ?? '—',
    qty: s.quantitySold,
    gross: s.grossAmount,
    commission: s.commission,
    vat: s.vat,
    other: s.otherCharges,
    returns: s.returnsRefunds,
    net: s.netAmount,
  }));

  const grossTotal = sales.reduce((a, s) => a + s.grossAmount, 0);
  const netTotal = sales.reduce((a, s) => a + s.netAmount, 0);
  const units = sales.reduce((a, s) => a + s.quantitySold, 0);

  const columns = [
    { key: 'date', label: 'Date' },
    { key: 'product', label: 'Product' },
    { key: 'store', label: 'Store' },
    { key: 'qty', label: 'Qty' },
    { key: 'gross', label: 'Gross', money: true },
    { key: 'commission', label: 'Commission', money: true },
    { key: 'vat', label: 'VAT', money: true },
    { key: 'other', label: 'Other', money: true },
    { key: 'returns', label: 'Returns', money: true },
    { key: 'net', label: 'Net', money: true },
  ];

  // Exports use redacted data only.
  const exp = redactExportRows(columns, rows, presentation);

  return (
    <>
      <Link
        href="/reports"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 transition hover:text-brand-600"
      >
        <ArrowLeft className="h-4 w-4" /> Back to reports
      </Link>

      <PageHeader title="Sales" description={rangeLabel(filter)} />

      <FilterBar stores={stores} />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Gross Sales" value={money(grossTotal)} tone="brand" />
        <StatCard label="Net Received" value={money(netTotal)} tone="positive" />
        <StatCard label="Units Sold" value={formatNumber(units)} />
      </div>

      {sales.length === 0 ? (
        <EmptyState title="No sales in this range" message="Adjust the filters to see sales." />
      ) : (
        <Card>
          <CardBody className="p-0">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
              <h3 className="text-sm font-semibold text-slate-800">Sales</h3>
              <ExportButtons
                title="Sales Report"
                filename="sales-report"
                subtitle={rangeLabel(filter)}
                columns={exp.columns}
                rows={exp.rows}
              />
            </div>
            <Table>
              <THead>
                <TRow>
                  <TH>Date</TH>
                  <TH>Product</TH>
                  <TH>Store</TH>
                  <TH align="right">Qty</TH>
                  <TH align="right">Gross</TH>
                  <TH align="right">Commission</TH>
                  <TH align="right">VAT</TH>
                  <TH align="right">Other</TH>
                  <TH align="right">Returns</TH>
                  <TH align="right">Net</TH>
                </TRow>
              </THead>
              <tbody>
                {sales.map((s) => (
                  <TRow key={s.id}>
                    <TD>{formatDate(s.date)}</TD>
                    <TD className="max-w-[160px] truncate font-medium text-slate-800">
                      {s.product?.name ?? '—'}
                    </TD>
                    <TD className="text-slate-500">{s.store?.name ?? '—'}</TD>
                    <TD align="right">{formatNumber(s.quantitySold)}</TD>
                    <TD align="right">{money(s.grossAmount)}</TD>
                    <TD align="right">{money(s.commission)}</TD>
                    <TD align="right">{money(s.vat)}</TD>
                    <TD align="right">{money(s.otherCharges)}</TD>
                    <TD align="right">{money(s.returnsRefunds)}</TD>
                    <TD align="right" className="font-medium">
                      {money(s.netAmount)}
                    </TD>
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
