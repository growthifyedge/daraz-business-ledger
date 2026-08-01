// Presentation Safe View — Manual Sales view-model (Phase 3C).
//
// Pure mapping from a (reduced) Sale row to a redacted, display-ready DTO for the
// read-only presentation view. Every monetary figure — unit cost, gross, net and
// the individual charge fields — becomes a safe band/status; internal notes and
// any buyer/customer identifiers are omitted from the query entirely. Date,
// store, product and units sold are safe operational context and are preserved.
// No DB, schema, calculation or business logic is touched.

import { formatDate } from '@/lib/utils';
import { redactMoney } from '../redact';
import type { PresentationContext } from '../core';

/**
 * Input shape. The active query omits `notes` and `createdBy`; only the fields
 * below are fetched, and the money figures are redacted before leaving the
 * server.
 */
export interface SalesSourceRow {
  id: string;
  date: Date | string;
  storeName: string | null;
  productName: string;
  quantitySold: number;
  grossAmount: number;
  netAmount: number;
}

export interface SalesPresentationRow {
  id: string;
  date: string;
  storeName: string;
  productName: string;
  quantitySold: number;
  grossAmount: string;
  netAmount: string;
}

export function toSalesPresentationRows(
  rows: SalesSourceRow[],
  ctx: PresentationContext
): SalesPresentationRow[] {
  return rows.map((s) => ({
    id: s.id,
    date: formatDate(s.date),
    storeName: s.storeName ?? '—',
    productName: s.productName,
    quantitySold: s.quantitySold,
    // Never exact — status (Operations) or band (Finance).
    grossAmount: redactMoney(s.grossAmount, ctx),
    netAmount: redactMoney(s.netAmount, ctx),
  }));
}

export interface SalesPresentationTotalsInput {
  gross: number;
  net: number;
  units: number;
}

export interface SalesPresentationTotals {
  gross: string;
  net: string;
  units: number;
}

export function toSalesPresentationTotals(
  t: SalesPresentationTotalsInput,
  ctx: PresentationContext
): SalesPresentationTotals {
  return {
    gross: redactMoney(t.gross, ctx),
    net: redactMoney(t.net, ctx),
    units: t.units,
  };
}
