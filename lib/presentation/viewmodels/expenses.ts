// Presentation Safe View — Expenses view-model (Phase 3C).
//
// Pure mapping from a (reduced) Expense row to a redacted, display-ready DTO for
// the read-only presentation view. The payer identity is anonymised; the exact
// amount becomes a safe band/status; the payment method, receipt/file URL and
// notes are omitted from the query entirely. Date, category and store are safe
// operational context and are preserved. No DB, schema, calculation or business
// logic is touched.
//
// Contract (inherited from the Phase 2 transforms):
//   - inactive context → identity (original values), so normal mode is unchanged
//   - active context    → never returns an original confidential value

import { formatDate, humanize } from '@/lib/utils';
import { redactMoney, stableLabel } from '../redact';
import type { PresentationContext } from '../core';

/**
 * Input shape. The active query omits `paidBy`, `paymentMethod`, `receiptUrl`
 * and `notes`; `paidBy` is optional here so the mapper is also testable for the
 * inactive identity contract.
 */
export interface ExpensesSourceRow {
  id: string;
  date: Date | string;
  category: string;
  storeName: string | null;
  amount: number;
  /** Only present in inactive identity tests; never fetched in the active query. */
  paidBy?: string | null;
}

export interface ExpensesPresentationRow {
  id: string;
  date: string;
  category: string;
  storeName: string;
  payer: string;
  amount: string;
}

export function toExpensesPresentationRows(
  rows: ExpensesSourceRow[],
  ctx: PresentationContext
): ExpensesPresentationRow[] {
  return rows.map((e) => ({
    id: e.id,
    date: formatDate(e.date),
    category: humanize(e.category),
    storeName: e.storeName ?? '—',
    // Anonymous payer label; the real payer name is never fetched when active.
    payer: ctx.active ? stableLabel('Payer', e.id) : e.paidBy ?? '—',
    // Never exact — status (Operations) or band (Finance).
    amount: redactMoney(e.amount, ctx),
  }));
}

export interface ExpensesPresentationTotalsInput {
  total: number;
  month: number;
  count: number;
}

export interface ExpensesPresentationTotals {
  total: string;
  month: string;
  count: number;
}

export function toExpensesPresentationTotals(
  t: ExpensesPresentationTotalsInput,
  ctx: PresentationContext
): ExpensesPresentationTotals {
  return {
    total: redactMoney(t.total, ctx),
    month: redactMoney(t.month, ctx),
    count: t.count,
  };
}
