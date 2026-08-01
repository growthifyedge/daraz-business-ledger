// Presentation Safe View — Accessories view-model (Phase 3C).
//
// Pure mapping from a (reduced) Accessory row to a redacted, display-ready DTO
// for the read-only presentation view. Exact unit/total costs become a safe
// band/status; the receipt/file URL and notes (which may hold confidential
// supplier/payment info) are omitted from the query entirely. Item name,
// quantities and purchase date are safe operational context and are preserved.
// No DB, schema, calculation or business logic is touched.

import { formatDate } from '@/lib/utils';
import { redactMoney } from '../redact';
import type { PresentationContext } from '../core';

/**
 * Input shape. The active query omits `receiptUrl` and `notes`. Unit/total cost
 * are still fetched so they can be redacted into a band/status.
 */
export interface AccessoriesSourceRow {
  id: string;
  name: string;
  quantityPurchased: number;
  quantityUsed: number;
  unitCost: number;
  totalCost: number;
  purchaseDate: Date | string | null;
}

export interface AccessoriesPresentationRow {
  id: string;
  name: string;
  quantityPurchased: number;
  quantityUsed: number;
  unitCost: string;
  totalCost: string;
  purchaseDate: string;
}

export function toAccessoriesPresentationRows(
  rows: AccessoriesSourceRow[],
  ctx: PresentationContext
): AccessoriesPresentationRow[] {
  return rows.map((a) => ({
    id: a.id,
    name: a.name,
    quantityPurchased: a.quantityPurchased,
    quantityUsed: a.quantityUsed,
    // Never exact — status (Operations) or band (Finance).
    unitCost: redactMoney(a.unitCost, ctx),
    totalCost: redactMoney(a.totalCost, ctx),
    purchaseDate: a.purchaseDate ? formatDate(a.purchaseDate) : '—',
  }));
}

export interface AccessoriesPresentationTotalsInput {
  totalCost: number;
  consumedCost: number;
  count: number;
}

export interface AccessoriesPresentationTotals {
  totalCost: string;
  consumedCost: string;
  count: number;
}

export function toAccessoriesPresentationTotals(
  t: AccessoriesPresentationTotalsInput,
  ctx: PresentationContext
): AccessoriesPresentationTotals {
  return {
    totalCost: redactMoney(t.totalCost, ctx),
    consumedCost: redactMoney(t.consumedCost, ctx),
    count: t.count,
  };
}
