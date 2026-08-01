// Read-only Manual Sales view rendered only in active Presentation Safe View.
// Date, store, product and units sold are preserved (safe to demonstrate); every
// monetary figure is banded/status-only, and internal notes plus any buyer
// information are never fetched. No mutation controls.

import { ShoppingCart } from 'lucide-react';
import {
  Card,
  CardBody,
  PageHeader,
  StatCard,
  Table,
  THead,
  TH,
  TD,
  TRow,
  EmptyState,
} from '@/components/ui';
import { SearchBar } from '@/components/SearchBar';
import { Pagination } from '@/components/Pagination';
import { ExportButtons } from '@/components/ExportButtons';
import { formatNumber } from '@/lib/utils';
import type {
  SalesPresentationRow,
  SalesPresentationTotals,
} from '@/lib/presentation/viewmodels/sales';

const EXPORT_COLUMNS = [
  { key: 'date', label: 'Date' },
  { key: 'storeName', label: 'Store' },
  { key: 'productName', label: 'Product' },
  { key: 'quantitySold', label: 'Units' },
  { key: 'grossAmount', label: 'Gross' },
  { key: 'netAmount', label: 'Net' },
];

export function SalesPresentationView({
  rows,
  totals,
  page,
  pageSize,
  total,
}: {
  rows: SalesPresentationRow[];
  totals: SalesPresentationTotals;
  page: number;
  pageSize: number;
  total: number;
}) {
  return (
    <div>
      <PageHeader
        title="Manual Sales"
        description="Confidential values are hidden in Presentation Safe View."
      />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Gross Sales" value={totals.gross} />
        <StatCard label="Net Received" value={totals.net} tone="positive" />
        <StatCard label="Units Sold" value={formatNumber(totals.units)} />
      </div>

      <Card>
        <CardBody>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <SearchBar placeholder="Search sales…" />
            <ExportButtons
              columns={EXPORT_COLUMNS}
              rows={rows as unknown as Record<string, unknown>[]}
              filename="manual-sales-presentation"
              title="Manual Sales"
              subtitle="Presentation Safe View — confidential values hidden"
            />
          </div>

          {rows.length === 0 ? (
            <EmptyState
              title="No sales"
              message="Nothing to show for the current filter."
              icon={<ShoppingCart className="h-8 w-8" />}
            />
          ) : (
            <Table>
              <THead>
                <TRow>
                  <TH>Date</TH>
                  <TH>Store</TH>
                  <TH>Product</TH>
                  <TH align="right">Units</TH>
                  <TH align="right">Gross</TH>
                  <TH align="right">Net</TH>
                </TRow>
              </THead>
              <tbody>
                {rows.map((s) => (
                  <TRow key={s.id}>
                    <TD>{s.date}</TD>
                    <TD className="text-slate-500">{s.storeName}</TD>
                    <TD className="font-medium">{s.productName}</TD>
                    <TD align="right">{formatNumber(s.quantitySold)}</TD>
                    <TD align="right">{s.grossAmount}</TD>
                    <TD align="right" className="font-medium">
                      {s.netAmount}
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
