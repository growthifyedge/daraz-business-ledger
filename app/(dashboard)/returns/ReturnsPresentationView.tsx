// Read-only Returns view rendered only in active Presentation Safe View. It
// shows realistic operational data with every confidential value redacted
// server-side. No create/edit/delete controls exist here, so nothing can be
// mutated during a demo. Rendered as a server component; the only client
// children (SearchBar, Pagination, ExportButtons) receive already-redacted
// strings, so no original value ever crosses into client code.

import { Undo2 } from 'lucide-react';
import { Card, CardBody, PageHeader, StatCard, Table, THead, TH, TD, TRow, EmptyState } from '@/components/ui';
import { SearchBar } from '@/components/SearchBar';
import { Pagination } from '@/components/Pagination';
import { ExportButtons } from '@/components/ExportButtons';
import { DemoReturnDetail } from './DemoReturnDetail';
import { DemoRecordReturn } from './DemoRecordReturn';
import { DemoBadge } from '@/components/demo/DemoBadge';
import type {
  ReturnsPresentationRow,
  ReturnsPresentationTotals,
} from '@/lib/presentation/viewmodels/returns';
import type { PresentationProfile } from '@/lib/presentation/core';

const EXPORT_COLUMNS = [
  { key: 'returnDate', label: 'Date' },
  { key: 'productName', label: 'Product' },
  { key: 'storeName', label: 'Store' },
  { key: 'customer', label: 'Customer' },
  { key: 'orderNumber', label: 'Order No.' },
  { key: 'returnId', label: 'Return ID' },
  { key: 'quantity', label: 'Qty' },
  { key: 'refund', label: 'Refund' },
  { key: 'chargedTo', label: 'Charged To' },
  { key: 'refundStatus', label: 'Refund Status' },
  { key: 'inventoryStatus', label: 'Inventory' },
];

export function ReturnsPresentationView({
  rows,
  totals,
  page,
  pageSize,
  total,
  illustrative = false,
  profile = null,
}: {
  rows: ReturnsPresentationRow[];
  totals: ReturnsPresentationTotals;
  page: number;
  pageSize: number;
  total: number;
  /** True when `rows` are illustrative samples (real protected dataset empty). */
  illustrative?: boolean;
  /** Active redaction profile, so demo-recorded money follows it. */
  profile?: PresentationProfile | null;
}) {
  return (
    <div>
      <PageHeader
        title="Returns & Refunds"
        description="Confidential values are hidden in Presentation Safe View."
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Seller Loss" value={totals.sellerLoss} tone="negative" />
        <StatCard label="Platform Covered" value={totals.platformCovered} />
        <StatCard label="Pending" value={totals.pending} tone="warning" />
        <StatCard label="Total Refunds" value={totals.refund} />
      </div>

      <DemoRecordReturn profile={profile} />

      <Card>
        <CardBody>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <SearchBar placeholder="Search returns…" />
            <ExportButtons
              columns={EXPORT_COLUMNS}
              rows={rows as unknown as Record<string, unknown>[]}
              filename="returns-demo"
              title="Returns & Refunds"
              subtitle="Demo simulation — no live records changed. Confidential values hidden."
            />
          </div>

          {illustrative && rows.length > 0 && (
            <div className="mb-4 flex items-center gap-2">
              <span className="text-sm text-slate-500">Illustrative sample returns for demonstration.</span>
              <DemoBadge />
            </div>
          )}

          {rows.length === 0 ? (
            <EmptyState
              title="No returns"
              message="Nothing to show for the current filter."
              icon={<Undo2 className="h-8 w-8" />}
            />
          ) : (
            <Table>
              <THead>
                <TRow>
                  <TH>Date</TH>
                  <TH>Product</TH>
                  <TH>Store</TH>
                  <TH>Customer</TH>
                  <TH>Order No.</TH>
                  <TH>Return ID</TH>
                  <TH>Tracking</TH>
                  <TH align="right">Qty</TH>
                  <TH align="right">Refund</TH>
                  <TH>Charged To</TH>
                  <TH>Refund Status</TH>
                  <TH>Inventory</TH>
                  <TH align="right">Detail</TH>
                </TRow>
              </THead>
              <tbody>
                {rows.map((r) => (
                  <TRow key={r.id}>
                    <TD>{r.returnDate}</TD>
                    <TD>{r.productName}</TD>
                    <TD>{r.storeName}</TD>
                    <TD>{r.customer}</TD>
                    <TD className="font-mono text-xs text-slate-500">{r.orderNumber}</TD>
                    <TD className="font-mono text-xs text-slate-500">{r.returnId}</TD>
                    <TD className="font-mono text-xs text-slate-500">{r.tracking}</TD>
                    <TD align="right">{r.quantity}</TD>
                    <TD align="right">{r.refund}</TD>
                    <TD>{r.chargedTo}</TD>
                    <TD>{r.refundStatus}</TD>
                    <TD>{r.inventoryStatus}</TD>
                    <TD align="right">
                      <DemoReturnDetail row={r} />
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
