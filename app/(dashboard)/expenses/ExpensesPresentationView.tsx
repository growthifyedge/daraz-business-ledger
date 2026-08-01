// Read-only Expenses view rendered only in active Presentation Safe View.
// Date, category and store are preserved (safe to demonstrate); the payer is
// anonymised, the amount is banded/status-only, and payment method, receipt
// URLs and notes are never fetched. No mutation controls, no file links.

import { Receipt } from 'lucide-react';
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
import { ExportButtons } from '@/components/ExportButtons';
import { formatNumber } from '@/lib/utils';
import type {
  ExpensesPresentationRow,
  ExpensesPresentationTotals,
} from '@/lib/presentation/viewmodels/expenses';

const EXPORT_COLUMNS = [
  { key: 'date', label: 'Date' },
  { key: 'category', label: 'Category' },
  { key: 'storeName', label: 'Store' },
  { key: 'payer', label: 'Paid By' },
  { key: 'amount', label: 'Amount' },
];

export function ExpensesPresentationView({
  rows,
  totals,
  page,
  pageSize,
  total,
}: {
  rows: ExpensesPresentationRow[];
  totals: ExpensesPresentationTotals;
  page: number;
  pageSize: number;
  total: number;
}) {
  return (
    <div>
      <PageHeader
        title="Expenses"
        description="Confidential values are hidden in Presentation Safe View."
      />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Total Expenses" value={totals.total} tone="negative" />
        <StatCard label="This Month" value={totals.month} tone="warning" />
        <StatCard label="Records" value={formatNumber(totals.count)} />
      </div>

      <Card>
        <CardBody>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <SearchBar placeholder="Search expenses…" />
            <ExportButtons
              columns={EXPORT_COLUMNS}
              rows={rows as unknown as Record<string, unknown>[]}
              filename="expenses-presentation"
              title="Expenses"
              subtitle="Presentation Safe View — confidential values hidden"
            />
          </div>

          {rows.length === 0 ? (
            <EmptyState
              title="No expenses"
              message="Nothing to show for the current filter."
              icon={<Receipt className="h-8 w-8" />}
            />
          ) : (
            <Table>
              <THead>
                <TRow>
                  <TH>Date</TH>
                  <TH>Category</TH>
                  <TH>Store</TH>
                  <TH>Paid By</TH>
                  <TH align="right">Amount</TH>
                </TRow>
              </THead>
              <tbody>
                {rows.map((e) => (
                  <TRow key={e.id}>
                    <TD>{e.date}</TD>
                    <TD>
                      <Badge tone="slate">{e.category}</Badge>
                    </TD>
                    <TD className="text-slate-500">{e.storeName}</TD>
                    <TD className="text-slate-500">{e.payer}</TD>
                    <TD align="right" className="font-medium">
                      {e.amount}
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
