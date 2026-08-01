// Read-only Stores view rendered only in active Presentation Safe View.
// Store display names, active status and linked-product counts are preserved
// (safe to demonstrate); confidential notes are never fetched. The Store row
// carries no monetary figures. No mutation controls.

import { Store as StoreIcon } from 'lucide-react';
import {
  Card,
  CardBody,
  PageHeader,
  StatCard,
  Badge,
  Table,
  THead,
  TH,
  TD,
  TRow,
  EmptyState,
} from '@/components/ui';
import { SearchBar } from '@/components/SearchBar';
import { Pagination } from '@/components/Pagination';
import { formatNumber } from '@/lib/utils';
import type { StoresPresentationRow } from '@/lib/presentation/viewmodels/stores';

export function StoresPresentationView({
  rows,
  page,
  pageSize,
  total,
}: {
  rows: StoresPresentationRow[];
  page: number;
  pageSize: number;
  total: number;
}) {
  const activeCount = rows.filter((r) => r.active).length;
  return (
    <div>
      <PageHeader
        title="Stores"
        description="Confidential notes are hidden in Presentation Safe View."
      />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Stores (page)" value={formatNumber(rows.length)} />
        <StatCard label="Active (page)" value={formatNumber(activeCount)} tone="positive" />
      </div>

      <Card>
        <CardBody>
          <div className="mb-4">
            <SearchBar placeholder="Search stores…" />
          </div>

          {rows.length === 0 ? (
            <EmptyState
              title="No stores"
              message="Nothing to show for the current filter."
              icon={<StoreIcon className="h-8 w-8" />}
            />
          ) : (
            <Table>
              <THead>
                <TRow>
                  <TH>Store</TH>
                  <TH align="right">Products</TH>
                  <TH>Status</TH>
                </TRow>
              </THead>
              <tbody>
                {rows.map((s) => (
                  <TRow key={s.id}>
                    <TD className="font-medium">{s.name}</TD>
                    <TD align="right">{formatNumber(s.productCount)}</TD>
                    <TD>
                      {s.active ? (
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
