import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getStockValue } from '@/lib/calculations';
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
import { formatMoney, formatNumber } from '@/lib/utils';

export const metadata = { title: 'Inventory Report' };
export const dynamic = 'force-dynamic';

export default async function InventoryReportPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const filter = parseFilter(sp);

  // Inventory is a snapshot — the date range does not apply. Store filter is
  // applied via the ProductStore join (products available in the store).
  const where: Prisma.ProductWhereInput = { deletedAt: null, active: true };
  if (filter.storeId) {
    where.stores = { some: { storeId: filter.storeId } };
  }

  const [stores, products, stockValue] = await Promise.all([
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
        purchaseCost: true,
        sellingPrice: true,
        damagedStock: true,
        lostStock: true,
        returnedStock: true,
      },
    }),
    getStockValue(),
  ]);

  const rows = products.map((p) => ({
    product: p.name,
    sku: p.sku,
    currentStock: p.currentStock,
    minLevel: p.minStockLevel,
    purchaseCost: p.purchaseCost,
    sellingPrice: p.sellingPrice,
    stockValue: p.currentStock * p.purchaseCost,
    damaged: p.damagedStock,
    lost: p.lostStock,
    returned: p.returnedStock,
  }));

  const columns = [
    { key: 'product', label: 'Product' },
    { key: 'sku', label: 'SKU' },
    { key: 'currentStock', label: 'Current Stock' },
    { key: 'minLevel', label: 'Min Level' },
    { key: 'purchaseCost', label: 'Purchase Cost', money: true },
    { key: 'sellingPrice', label: 'Selling Price', money: true },
    { key: 'stockValue', label: 'Stock Value', money: true },
    { key: 'damaged', label: 'Damaged' },
    { key: 'lost', label: 'Lost' },
    { key: 'returned', label: 'Returned' },
  ];

  return (
    <>
      <Link
        href="/reports"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 transition hover:text-brand-600"
      >
        <ArrowLeft className="h-4 w-4" /> Back to reports
      </Link>

      <PageHeader title="Inventory" description={rangeLabel(filter)} />

      <FilterBar stores={stores} />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard
          label="Total Stock Value (at cost)"
          value={formatMoney(stockValue.stockValueAtCost)}
          tone="brand"
        />
        <StatCard label="Total Units" value={formatNumber(stockValue.totalUnits)} />
        <StatCard label="Products" value={formatNumber(stockValue.productCount)} />
      </div>

      {products.length === 0 ? (
        <EmptyState title="No products" message="No active products match this filter." />
      ) : (
        <Card>
          <CardBody className="p-0">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
              <h3 className="text-sm font-semibold text-slate-800">Stock On Hand</h3>
              <ExportButtons
                title="Inventory Report"
                filename="inventory-report"
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
                  <TH align="right">Purchase Cost</TH>
                  <TH align="right">Selling Price</TH>
                  <TH align="right">Stock Value</TH>
                  <TH align="right">Damaged</TH>
                  <TH align="right">Lost</TH>
                  <TH align="right">Returned</TH>
                </TRow>
              </THead>
              <tbody>
                {products.map((p) => (
                  <TRow key={p.id}>
                    <TD className="max-w-[160px] truncate font-medium text-slate-800">
                      {p.name}
                    </TD>
                    <TD className="text-slate-500">{p.sku}</TD>
                    <TD align="right">{formatNumber(p.currentStock)}</TD>
                    <TD align="right">{formatNumber(p.minStockLevel)}</TD>
                    <TD align="right">{formatMoney(p.purchaseCost)}</TD>
                    <TD align="right">{formatMoney(p.sellingPrice)}</TD>
                    <TD align="right" className="font-medium">
                      {formatMoney(p.currentStock * p.purchaseCost)}
                    </TD>
                    <TD align="right">{formatNumber(p.damagedStock)}</TD>
                    <TD align="right">{formatNumber(p.lostStock)}</TD>
                    <TD align="right">{formatNumber(p.returnedStock)}</TD>
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
