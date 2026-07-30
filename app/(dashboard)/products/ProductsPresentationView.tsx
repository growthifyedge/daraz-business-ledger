// Read-only Products & Inventory view rendered only in active Presentation Safe
// View. Product names, SKUs, categories, stock quantities and operational status
// are preserved (safe to demonstrate); purchase cost, selling price and stock
// value are banded/status-only; notes are never fetched. No mutation controls.

import { Package } from 'lucide-react';
import { Card, CardBody, PageHeader, StatCard, Badge, Table, THead, TH, TD, TRow, EmptyState } from '@/components/ui';
import { SearchBar } from '@/components/SearchBar';
import { Pagination } from '@/components/Pagination';
import { ExportButtons } from '@/components/ExportButtons';
import { formatNumber } from '@/lib/utils';
import type { ProductsPresentationRow } from '@/lib/presentation/viewmodels/products';

const EXPORT_COLUMNS = [
  { key: 'name', label: 'Product' },
  { key: 'sku', label: 'SKU' },
  { key: 'category', label: 'Category' },
  { key: 'currentStock', label: 'Stock' },
  { key: 'minStockLevel', label: 'Min' },
  { key: 'purchaseCost', label: 'Purchase Cost' },
  { key: 'sellingPrice', label: 'Selling Price' },
  { key: 'stockValue', label: 'Stock Value' },
];

export function ProductsPresentationView({
  rows,
  productCount,
  page,
  pageSize,
  total,
}: {
  rows: ProductsPresentationRow[];
  productCount: number;
  page: number;
  pageSize: number;
  total: number;
}) {
  const lowStock = rows.filter((r) => r.lowStock).length;
  return (
    <div>
      <PageHeader
        title="Products & Inventory"
        description="Confidential values are hidden in Presentation Safe View."
      />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Products" value={formatNumber(productCount)} />
        <StatCard label="Low Stock (page)" value={formatNumber(lowStock)} tone="warning" />
        <StatCard label="Stock Value" value="Hidden" hint="Confidential" />
      </div>

      <Card>
        <CardBody>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <SearchBar placeholder="Search products…" />
            <ExportButtons
              columns={EXPORT_COLUMNS}
              rows={rows as unknown as Record<string, unknown>[]}
              filename="products-presentation"
              title="Products & Inventory"
              subtitle="Presentation Safe View — confidential values hidden"
            />
          </div>

          {rows.length === 0 ? (
            <EmptyState
              title="No products"
              message="Nothing to show for the current filter."
              icon={<Package className="h-8 w-8" />}
            />
          ) : (
            <Table>
              <THead>
                <TRow>
                  <TH>Product</TH>
                  <TH>SKU</TH>
                  <TH>Store(s)</TH>
                  <TH align="right">Stock</TH>
                  <TH align="right">Min</TH>
                  <TH align="right">Purchase Cost</TH>
                  <TH align="right">Selling Price</TH>
                  <TH align="right">Stock Value</TH>
                  <TH>Status</TH>
                </TRow>
              </THead>
              <tbody>
                {rows.map((p) => (
                  <TRow key={p.id}>
                    <TD>{p.name}</TD>
                    <TD className="font-mono text-xs text-slate-500">{p.sku}</TD>
                    <TD>{p.storeNames.length ? p.storeNames.join(', ') : '—'}</TD>
                    <TD align="right">{formatNumber(p.currentStock)}</TD>
                    <TD align="right">{formatNumber(p.minStockLevel)}</TD>
                    <TD align="right">{p.purchaseCost}</TD>
                    <TD align="right">{p.sellingPrice}</TD>
                    <TD align="right">{p.stockValue}</TD>
                    <TD>
                      {p.active ? (
                        <Badge tone="green">Active</Badge>
                      ) : (
                        <Badge tone="slate">Inactive</Badge>
                      )}
                    </TD>
                  </TRow>
                ))}
              </tbody>
            </Table>
          )}

          <Pagination page={page} pageSize={pageSize} total={total} />
        </CardBody>
      </Card>
    </div>
  );
}
