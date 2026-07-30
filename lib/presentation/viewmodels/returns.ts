// Presentation Safe View — Returns view-model (Phase 3A).
//
// Pure mapping from a (reduced) Returns row to a redacted, display-ready DTO for
// the read-only presentation view. Sensitive fields are anonymised, masked, or
// hidden here on the SERVER, before anything reaches a client component, the RSC
// payload, an export, or a print view. No DB, schema, calculation or business
// logic is touched — this only transforms already-fetched values for display.
//
// Contract (inherited from the Phase 2 transforms):
//   - inactive context  → identity (original values), so normal mode is unchanged
//   - active context     → never returns an original confidential value

import { formatDate, humanize } from '@/lib/utils';
import { redactMoney, redactId, stableLabel } from '../redact';
import type { PresentationContext } from '../core';

/**
 * Input shape. In the active branch the page runs a reduced `select` that omits
 * `buyerName` and `notes` entirely; those fields are optional here so the mapper
 * is also testable for the inactive identity contract.
 */
export interface ReturnsSourceRow {
  id: string;
  returnDate: Date | string;
  productName: string | null;
  storeName: string | null;
  orderNumber: string | null;
  returnOrderId: string | null;
  trackingNumber: string | null;
  quantity: number;
  refundAmount: number;
  chargedTo: string;
  refundStatus: string;
  inventoryStatus: string;
  reason: string | null;
  /** Only present in inactive identity tests; never fetched in the active query. */
  buyerName?: string | null;
}

export interface ReturnsPresentationRow {
  id: string;
  returnDate: string;
  productName: string;
  storeName: string;
  customer: string;
  orderNumber: string;
  returnId: string;
  tracking: string;
  quantity: number;
  refund: string;
  chargedTo: string;
  refundStatus: string;
  inventoryStatus: string;
  reason: string;
}

export function toReturnsPresentationRows(
  rows: ReturnsSourceRow[],
  ctx: PresentationContext
): ReturnsPresentationRow[] {
  return rows.map((r) => {
    // Customer is anonymised per-order (buyerName is never fetched when active),
    // giving a stable pseudonym without the real name ever leaving the database.
    const seed = r.orderNumber ?? r.returnOrderId ?? r.id;
    const customer = ctx.active
      ? stableLabel('Customer', String(seed))
      : r.buyerName ?? '—';
    return {
      id: r.id,
      returnDate: formatDate(r.returnDate),
      productName: r.productName ?? '—',
      storeName: r.storeName ?? '—',
      customer,
      orderNumber: redactId(r.orderNumber, ctx, 'ORD') ?? '—',
      returnId: redactId(r.returnOrderId, ctx, 'RET') ?? '—',
      tracking: redactId(r.trackingNumber, ctx, 'TRK') ?? '—',
      quantity: r.quantity,
      refund: redactMoney(r.refundAmount, ctx),
      chargedTo: humanize(r.chargedTo),
      refundStatus: humanize(r.refundStatus),
      inventoryStatus: humanize(r.inventoryStatus),
      reason: r.reason ?? '—',
    };
  });
}

export interface ReturnsPresentationTotalsInput {
  refund: number;
  sellerLoss: number;
  platformCovered: number;
  pending: number;
  count: number;
}

export interface ReturnsPresentationTotals {
  refund: string;
  sellerLoss: string;
  platformCovered: string;
  pending: string;
  count: number;
}

export function toReturnsPresentationTotals(
  t: ReturnsPresentationTotalsInput,
  ctx: PresentationContext
): ReturnsPresentationTotals {
  return {
    refund: redactMoney(t.refund, ctx),
    sellerLoss: redactMoney(t.sellerLoss, ctx),
    platformCovered: redactMoney(t.platformCovered, ctx),
    pending: redactMoney(t.pending, ctx),
    count: t.count,
  };
}
