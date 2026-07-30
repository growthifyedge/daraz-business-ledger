// Presentation Safe View — export redaction helper (Phase 3B).
//
// Redacts the rows/columns handed to the client <ExportButtons> (and PnlExport)
// so CSV and PDF output carry no exact monetary value. Money columns are turned
// into pre-redacted strings server-side and their `money` flag cleared, so the
// client never receives a raw figure and never re-formats one. Inactive context
// is a pass-through (identity), so normal-mode exports are unchanged.

import { redactMoney } from '../redact';
import type { PresentationContext } from '../core';
import type { ExportColumn } from '@/components/ExportButtons';

export function redactExportRows(
  columns: ExportColumn[],
  rows: Record<string, unknown>[],
  ctx: PresentationContext
): { columns: ExportColumn[]; rows: Record<string, unknown>[] } {
  if (!ctx.active) return { columns, rows };
  const moneyKeys = columns.filter((c) => c.money).map((c) => c.key);
  const redactedColumns = columns.map((c) => (c.money ? { ...c, money: false } : c));
  const redactedRows = rows.map((r) => {
    const copy: Record<string, unknown> = { ...r };
    for (const k of moneyKeys) copy[k] = redactMoney(Number(r[k] ?? 0), ctx);
    return copy;
  });
  return { columns: redactedColumns, rows: redactedRows };
}
