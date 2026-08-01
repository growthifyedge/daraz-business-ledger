// Read-only Purchases view rendered only in active Presentation Safe View.
// Supplier is anonymised; costs are banded/status-only; bank references, notes
// and invoice URLs are never fetched. No create/edit/delete controls, and no
// payment-history detail, so nothing sensitive is exposed or mutable.

import { ShoppingCart } from 'lucide-react';
import { Card, CardBody, PageHeader, StatCard, Table, THead, TH, TD, TRow, EmptyState } from '@/components/ui';
import { SearchBar } from '@/components/SearchBar';
import { Pagination } from '@/components/Pagination';
import { ExportButtons } from '@/components/ExportButtons';
import { DemoRecordPurchase } from './DemoRecordPurchase';
import type {
  PurchasesPresentationRow,
  PurchasesPresentationTotals,
} from '@/lib/presentation/viewmodels/purchases';

const EXPORT_COLUMNS = [
  { key: 'date', label: 'Date' },
  { key: 'productName', label: 'Product' },
  { key: 'storeName', label: 'Store' },
  { key: 'supplier', label: 'Supplier' },
  { key: 'quantity', label: 'Qty' },
  { key: 'unitCost', label: 'Unit Cost' },
  { key: 'totalCost', label: 'Total Cost' },
  { key: 'paymentStatus', label: 'Payment' },
];

export function PurchasesPresentationView({
  rows,
  totals,
  page,
  pageSize,
  total,
}: {
  rows: PurchasesPresentationRow[];
  totals: PurchasesPresentationTotals;
  page: number;
  pageSize: number;
  total: number;
}) {
  return (
    <div>
      <PageHeader
        title="Purchases"
        description="Confidential values are hidden in Presentation Safe View."
      />

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Total Purchased" value={totals.total} />
        <StatCard label="Supplier Debt" value={totals.payable} tone="warning" />
        <StatCard label="Paid" value={totals.paid} tone="positive" />
      </div>

      <Card>
        <CardBody>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <SearchBar placeholder="Search purchases…" />
            <div className="flex flex-wrap items-center gap-2">
              <DemoRecordPurchase />
              <ExportButtons
                columns={EXPORT_COLUMNS}
                rows={rows as unknown as Record<string, unknown>[]}
                filename="purchases-demo"
                title="Purchases"
                subtitle="Demo simulation — no live records changed. Confidential values hidden."
              />
            </div>
          </div>

          {rows.length === 0 ? (
            <EmptyState
              title="No purchases"
              message="Nothing to show for the current filter."
              icon={<ShoppingCart className="h-8 w-8" />}
            />
          ) : (
            <Table>
              <THead>
                <TRow>
                  <TH>Date</TH>
                  <TH>Product</TH>
                  <TH>Store</TH>
                  <TH>Supplier</TH>
                  <TH align="right">Qty</TH>
                  <TH align="right">Unit Cost</TH>
                  <TH align="right">Total Cost</TH>
                  <TH>Payment</TH>
                </TRow>
              </THead>
              <tbody>
                {rows.map((p) => (
                  <TRow key={p.id}>
                    <TD>{p.date}</TD>
                    <TD>{p.productName}</TD>
                    <TD>{p.storeName}</TD>
                    <TD>{p.supplier}</TD>
                    <TD align="right">{p.quantity}</TD>
                    <TD align="right">{p.unitCost}</TD>
                    <TD align="right">{p.totalCost}</TD>
                    <TD>{p.paymentStatus}</TD>
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
