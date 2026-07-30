// Presentation Safe View — Purchases view-model (Phase 3A).
//
// Pure mapping from a (reduced) Purchase row to a redacted, display-ready DTO.
// Supplier/purchaser is anonymised; exact costs become a safe band/status; bank
// references, notes and invoice/file URLs are omitted from the query entirely.
// No DB, schema, calculation or business logic is touched.

import { formatDate, humanize } from '@/lib/utils';
import { redactMoney, stableLabel } from '../redact';
import type { PresentationContext } from '../core';

/**
 * Input shape. The active query omits `purchasedBy`, `bankReference`,
 * `invoiceUrl` and `notes`; `purchasedBy` is optional here so the mapper is also
 * testable for the inactive identity contract.
 */
export interface PurchasesSourceRow {
  id: string;
  date: Date | string;
  productName: string | null;
  storeName: string | null;
  quantity: number;
  unitCost: number;
  totalCost: number;
  paymentStatus: string;
  /** Only present in inactive identity tests; never fetched in the active query. */
  purchasedBy?: string | null;
}

export interface PurchasesPresentationRow {
  id: string;
  date: string;
  productName: string;
  storeName: string;
  supplier: string;
  quantity: number;
  unitCost: string;
  totalCost: string;
  paymentStatus: string;
}

export function toPurchasesPresentationRows(
  rows: PurchasesSourceRow[],
  ctx: PresentationContext
): PurchasesPresentationRow[] {
  return rows.map((p) => ({
    id: p.id,
    date: formatDate(p.date),
    productName: p.productName ?? '—',
    storeName: p.storeName ?? '—',
    // Anonymous supplier label; the real purchaser name is never fetched when active.
    supplier: ctx.active ? stableLabel('Supplier', p.id) : p.purchasedBy ?? '—',
    quantity: p.quantity,
    unitCost: redactMoney(p.unitCost, ctx),
    totalCost: redactMoney(p.totalCost, ctx),
    paymentStatus: humanize(p.paymentStatus),
  }));
}

export interface PurchasesPresentationTotalsInput {
  total: number;
  payable: number;
  paid: number;
  count: number;
}

export interface PurchasesPresentationTotals {
  total: string;
  payable: string;
  paid: string;
  count: number;
}

export function toPurchasesPresentationTotals(
  t: PurchasesPresentationTotalsInput,
  ctx: PresentationContext
): PurchasesPresentationTotals {
  return {
    total: redactMoney(t.total, ctx),
    payable: redactMoney(t.payable, ctx),
    paid: redactMoney(t.paid, ctx),
    count: t.count,
  };
}
