// Read-only Accessories view rendered only in active Presentation Safe View.
// Item name, quantities and purchase date are preserved (safe to demonstrate);
// unit/total costs are banded/status-only, and receipt URLs and notes are never
// fetched. No mutation controls, no file links.

import { Boxes } from 'lucide-react';
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
  AccessoriesPresentationRow,
  AccessoriesPresentationTotals,
} from '@/lib/presentation/viewmodels/accessories';

const EXPORT_COLUMNS = [
  { key: 'name', label: 'Item' },
  { key: 'quantityPurchased', label: 'Purchased' },
  { key: 'quantityUsed', label: 'Used' },
  { key: 'unitCost', label: 'Unit Cost' },
  { key: 'totalCost', label: 'Total Cost' },
  { key: 'purchaseDate', label: 'Purchased On' },
];

export function AccessoriesPresentationView({
  rows,
  totals,
  page,
  pageSize,
  total,
}: {
  rows: AccessoriesPresentationRow[];
  totals: AccessoriesPresentationTotals;
  page: number;
  pageSize: number;
  total: number;
}) {
  return (
    <div>
      <PageHeader
        title="Accessories & Stationery"
        description="Confidential values are hidden in Presentation Safe View."
      />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Total Cost" value={totals.totalCost} tone="negative" />
        <StatCard label="Consumed Cost" value={totals.consumedCost} tone="warning" />
        <StatCard label="Records" value={formatNumber(totals.count)} />
      </div>

      <Card>
        <CardBody>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <SearchBar placeholder="Search accessories…" />
            <ExportButtons
              columns={EXPORT_COLUMNS}
              rows={rows as unknown as Record<string, unknown>[]}
              filename="accessories-presentation"
              title="Accessories & Stationery"
              subtitle="Presentation Safe View — confidential values hidden"
            />
          </div>

          {rows.length === 0 ? (
            <EmptyState
              title="No accessories"
              message="Nothing to show for the current filter."
              icon={<Boxes className="h-8 w-8" />}
            />
          ) : (
            <Table>
              <THead>
                <TRow>
                  <TH>Item</TH>
                  <TH align="right">Purchased</TH>
                  <TH align="right">Used</TH>
                  <TH align="right">Unit Cost</TH>
                  <TH align="right">Total Cost</TH>
                  <TH>Purchased On</TH>
                </TRow>
              </THead>
              <tbody>
                {rows.map((a) => (
                  <TRow key={a.id}>
                    <TD className="font-medium">{a.name}</TD>
                    <TD align="right">{formatNumber(a.quantityPurchased)}</TD>
                    <TD align="right">{formatNumber(a.quantityUsed)}</TD>
                    <TD align="right">{a.unitCost}</TD>
                    <TD align="right">{a.totalCost}</TD>
                    <TD className="text-slate-500">{a.purchaseDate}</TD>
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
