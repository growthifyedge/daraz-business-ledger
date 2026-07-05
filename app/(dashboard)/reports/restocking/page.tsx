import Link from 'next/link';
import { ArrowLeft, PackageCheck } from 'lucide-react';
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
  Badge,
  EmptyState,
  Table,
  THead,
  TH,
  TD,
  TRow,
} from '@/components/ui';
import { formatNumber } from '@/lib/utils';

export const metadata = { title: 'Restocking Report' };
export const dynamic = 'force-dynamic';

export default async function RestockingReportPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const filter = parseFilter(sp);

  // Inventory snapshot — date range does not apply. Store filter via the
  // ProductStore join.
  const where: Prisma.ProductWhereInput = { deletedAt: null, active: true };
  if (filter.storeId) {
    where.stores = { some: { storeId: filter.storeId } };
  }

  const [stores, all] = await Promise.all([
    prisma.store.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.product.findMany({
      where,
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        sku: true,
        currentStock: true,
        minStockLevel: true,
      },
    }),
  ]);

  // Products at or below their minimum stock level.
  const products = all.filter((p) => p.currentStock <= p.minStockLevel);

  const rows = products.map((p) => {
    const shortfall = Math.max(p.minStockLevel - p.currentStock, 0);
    const suggested =
      p.minStockLevel * 2 - p.currentStock > 0
        ? p.minStockLevel * 2 - p.currentStock
        : p.minStockLevel;
    return {
      product: p.name,
      sku: p.sku,
      current: p.currentStock,
      min: p.minStockLevel,
      shortfall,
      suggested,
    };
  });

  const outOfStock = products.filter((p) => p.currentStock <= 0).length;

  const columns = [
    { key: 'product', label: 'Product' },
    { key: 'sku', label: 'SKU' },
    { key: 'current', label: 'Current' },
    { key: 'min', label: 'Min' },
    { key: 'shortfall', label: 'Shortfall' },
    { key: 'suggested', label: 'Suggested Reorder' },
  ];

  return (
    <>
      <Link
        href="/reports"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 transition hover:text-brand-600"
      >
        <ArrowLeft className="h-4 w-4" /> Back to reports
      </Link>

      <PageHeader title="Restocking" description={rangeLabel(filter)} />

      <FilterBar stores={stores} />

      <div className="mb-4 grid grid-cols-2 gap-3">
        <StatCard
          label="Products Needing Restock"
          value={formatNumber(products.length)}
          tone={products.length > 0 ? 'warning' : 'positive'}
        />
        <StatCard
          label="Out of Stock"
          value={formatNumber(outOfStock)}
          tone={outOfStock > 0 ? 'negative' : 'default'}
        />
      </div>

      {products.length === 0 ? (
        <EmptyState
          icon={<PackageCheck className="h-10 w-10" />}
          title="All products above minimum."
          message="No products are at or below their minimum stock level."
        />
      ) : (
        <Card>
          <CardBody className="p-0">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
              <h3 className="text-sm font-semibold text-slate-800">Restock List</h3>
              <ExportButtons
                title="Restocking Report"
                filename="restocking-report"
                columns={columns}
                rows={rows}
              />
            </div>
            <Table>
              <THead>
                <TRow>
                  <TH>Product</TH>
                  <TH>SKU</TH>
                  <TH align="right">Current</TH>
                  <TH align="right">Min</TH>
                  <TH align="right">Shortfall</TH>
                  <TH align="right">Suggested Reorder</TH>
                </TRow>
              </THead>
              <tbody>
                {products.map((p) => {
                  const shortfall = Math.max(p.minStockLevel - p.currentStock, 0);
                  const suggested =
                    p.minStockLevel * 2 - p.currentStock > 0
                      ? p.minStockLevel * 2 - p.currentStock
                      : p.minStockLevel;
                  return (
                    <TRow key={p.id}>
                      <TD className="max-w-[180px] truncate font-medium text-slate-800">
                        {p.name}
                      </TD>
                      <TD className="text-slate-500">{p.sku}</TD>
                      <TD align="right">
                        {p.currentStock <= 0 ? (
                          <Badge tone="red">{formatNumber(p.currentStock)}</Badge>
                        ) : (
                          formatNumber(p.currentStock)
                        )}
                      </TD>
                      <TD align="right">{formatNumber(p.minStockLevel)}</TD>
                      <TD align="right">{formatNumber(shortfall)}</TD>
                      <TD align="right" className="font-medium">
                        {formatNumber(suggested)}
                      </TD>
                    </TRow>
                  );
                })}
              </tbody>
            </Table>
          </CardBody>
        </Card>
      )}
    </>
  );
}
