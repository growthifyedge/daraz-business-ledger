// ---------------------------------------------------------------------------
// Pure return-domain rules.
//
// Everything here is a pure function of its inputs: no Prisma, no I/O, no
// dates-from-now. `app/(dashboard)/returns/actions.ts` is the only caller that
// turns these decisions into database writes, so testing this module tests the
// real production rules rather than a re-implementation of them.
// ---------------------------------------------------------------------------

import type {
  ReturnChargedTo,
  ReturnInventoryStatus,
  ReturnRefundStatus,
} from '@prisma/client';

// ---------------------------------------------------------------------------
// Stock buckets
// ---------------------------------------------------------------------------

/** The four independent stock counters on Product. */
export interface BucketDelta {
  currentStock: number; // sellable
  returnedStock: number; // back in hand, awaiting QC
  damagedStock: number; // failed QC
  lostStock: number; // never arrived
}

export const NO_DELTA: Readonly<BucketDelta> = Object.freeze({
  currentStock: 0,
  returnedStock: 0,
  damagedStock: 0,
  lostStock: 0,
});

export const zeroDelta = (): BucketDelta => ({
  currentStock: 0,
  returnedStock: 0,
  damagedStock: 0,
  lostStock: 0,
});

export const isZeroDelta = (d: BucketDelta): boolean =>
  d.currentStock === 0 &&
  d.returnedStock === 0 &&
  d.damagedStock === 0 &&
  d.lostStock === 0;

export const addDelta = (a: BucketDelta, b: BucketDelta): BucketDelta => ({
  currentStock: a.currentStock + b.currentStock,
  returnedStock: a.returnedStock + b.returnedStock,
  damagedStock: a.damagedStock + b.damagedStock,
  lostStock: a.lostStock + b.lostStock,
});

/** Inventory statuses that mean the unit is physically back with us. */
export const RECEIPT_REQUIRED_STATUSES: readonly ReturnInventoryStatus[] = [
  'RECEIVED_PENDING_QC',
  'RESTOCKED',
  'DAMAGED',
];

/**
 * The single bucket a disposition owns. `null` means the unit is not ours yet
 * and touches nothing. This mapping is what guarantees a returned unit is never
 * counted in two buckets at once.
 */
export function dispositionBucket(
  status: ReturnInventoryStatus
): keyof BucketDelta | null {
  switch (status) {
    case 'NOT_RECEIVED':
      return null;
    case 'RECEIVED_PENDING_QC':
      return 'returnedStock';
    case 'RESTOCKED':
      return 'currentStock';
    case 'DAMAGED':
      return 'damagedStock';
    case 'LOST':
      return 'lostStock';
    default:
      return null;
  }
}

/**
 * The stock effect of a disposition. `sign` is 1 to apply, -1 to reverse.
 * A non-positive or non-integer quantity yields no effect.
 */
export function dispositionDelta(
  status: ReturnInventoryStatus,
  quantity: number,
  sign: 1 | -1 = 1
): BucketDelta {
  const delta = zeroDelta();
  const bucket = dispositionBucket(status);
  if (!bucket) return delta;
  if (!Number.isInteger(quantity) || quantity <= 0) return delta;
  delta[bucket] = sign * quantity;
  return delta;
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

export interface Disposition {
  productId: string | null;
  storeId: string | null;
  inventoryStatus: ReturnInventoryStatus;
  quantity: number;
}

export interface PlanEntry {
  productId: string;
  storeId: string | null;
  delta: BucketDelta;
}

/**
 * Reverse `before`, apply `after`, per product.
 *
 *   create  → transitionPlan(null, next)
 *   edit    → transitionPlan(prev, next)
 *   delete  → transitionPlan(prev, null)
 *   restore → transitionPlan(null, prev)
 *
 * When the product is unchanged the two effects net into ONE entry (so an edit
 * from RESTOCKED×5 to RESTOCKED×3 is a single −2, not −5 then +3). When the
 * product changes, each product gets its own entry. Entries with no net effect
 * are dropped.
 */
export function transitionPlan(
  before: Disposition | null,
  after: Disposition | null
): PlanEntry[] {
  const map = new Map<string, PlanEntry>();

  const push = (productId: string, storeId: string | null, delta: BucketDelta) => {
    const existing = map.get(productId);
    if (existing) {
      existing.delta = addDelta(existing.delta, delta);
      if (storeId) existing.storeId = storeId;
    } else {
      map.set(productId, { productId, storeId, delta });
    }
  };

  if (before?.productId) {
    push(
      before.productId,
      before.storeId,
      dispositionDelta(before.inventoryStatus, before.quantity, -1)
    );
  }
  if (after?.productId) {
    push(
      after.productId,
      after.storeId,
      dispositionDelta(after.inventoryStatus, after.quantity, 1)
    );
  }

  return [...map.values()].filter((e) => !isZeroDelta(e.delta));
}

/**
 * True when applying `delta` would push sellable stock below zero — i.e. the
 * restocked unit has since been sold and cannot be taken back out.
 */
export function wouldDriveSellableNegative(
  delta: BucketDelta,
  availableStock: number
): boolean {
  return delta.currentStock < 0 && availableStock + delta.currentStock < 0;
}

// ---------------------------------------------------------------------------
// Financial eligibility
// ---------------------------------------------------------------------------

export interface RefundEligibilityInput {
  refundStatus: ReturnRefundStatus;
  chargedTo: ReturnChargedTo;
  deletedAt: Date | null;
}

/**
 * The one definition of "this refund cost us money".
 *
 * Must mirror `eligibleReturnWhere()` in lib/calculations.ts — that builds the
 * SQL filter, this decides in memory. Any change belongs in both.
 */
export function isEligibleForPnl(r: RefundEligibilityInput): boolean {
  return (
    r.refundStatus === 'COMPLETED' &&
    r.chargedTo === 'SELLER' &&
    r.deletedAt === null
  );
}

/** Seller loss for a single return: its refund, or 0 when not eligible. */
export function sellerLossOf(
  r: RefundEligibilityInput & { refundAmount: number }
): number {
  return isEligibleForPnl(r) ? r.refundAmount : 0;
}

// ---------------------------------------------------------------------------
// Cost snapshots & COGS
// ---------------------------------------------------------------------------

/**
 * Effective per-unit cost of a sale.
 *
 * The snapshot (`Sale.unitCost`) is authoritative — it froze the cost at sale
 * time, so historical COGS never shifts when Product.purchaseCost later moves.
 * A null snapshot is a legacy row; only then do we fall back to the product's
 * current purchaseCost, purely for backward compatibility.
 */
export function effectiveSaleUnitCost(
  saleUnitCost: number | null,
  productPurchaseCost: number | null | undefined
): number {
  return saleUnitCost ?? productPurchaseCost ?? 0;
}

/** COGS for one sale line. */
export function saleCogs(sale: {
  quantitySold: number;
  unitCost: number | null;
  productPurchaseCost?: number | null;
}): number {
  return (
    sale.quantitySold *
    effectiveSaleUnitCost(sale.unitCost, sale.productPurchaseCost)
  );
}

export interface RecoveryInput {
  inventoryStatus: ReturnInventoryStatus;
  deletedAt: Date | null;
  quantity: number;
  unitCost: number | null;
  productPurchaseCost?: number | null;
}

/**
 * A return recovers COGS only when the physical unit is genuinely back on the
 * sellable shelf: inventoryStatus = RESTOCKED and the record is live.
 *
 * This is deliberately INDEPENDENT of the refund's financial state — a unit can
 * be restocked whether or not the seller was charged, and whether or not the
 * refund has completed. Refund eligibility (isEligibleForPnl) and COGS recovery
 * answer two different questions.
 */
export function recoversCogs(r: {
  inventoryStatus: ReturnInventoryStatus;
  deletedAt: Date | null;
}): boolean {
  return r.inventoryStatus === 'RESTOCKED' && r.deletedAt === null;
}

/** Recovered COGS for one return: qty × snapshot cost when RESTOCKED+live, else 0. */
export function returnRecoveredCogs(r: RecoveryInput): number {
  if (!recoversCogs(r)) return 0;
  return r.quantity * effectiveSaleUnitCost(r.unitCost, r.productPurchaseCost);
}

/**
 * Cumulative-quantity guard for returns linked to a sale.
 *
 * The total quantity of all LIVE returns pointing at a sale must not exceed the
 * quantity that sale actually sold. When editing, the current return is excluded
 * from `otherLinkedQuantities` so it isn't counted against itself.
 *
 * Returns an error message, or null when the save is within bounds.
 */
export function cumulativeReturnQtyError(input: {
  quantitySold: number;
  otherLinkedLiveQuantities: number[];
  thisQuantity: number;
}): string | null {
  const others = input.otherLinkedLiveQuantities.reduce((a, b) => a + b, 0);
  const total = others + input.thisQuantity;
  if (total > input.quantitySold) {
    return `This would bring the total returned quantity for the linked sale to ${total}, but only ${input.quantitySold} unit(s) were sold. Reduce the quantity (already returned on this sale: ${others}).`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ReturnValidationInput {
  returnItemId: string | null;
  returnOrderId: string | null;
  orderItemId: string | null;
  returnDate: Date | null;
  orderDate: Date | null;
  receivedAt: Date | null;
  quantity: number;
  paidAmount: number;
  refundAmount: number;
  unitCost: number | null;
  inventoryStatus: ReturnInventoryStatus;
  productId: string | null;
}

const validDate = (d: Date | null): boolean => d !== null && !isNaN(d.getTime());

/** Returns an error message, or null when the input is valid. */
export function validateReturnInput(i: ReturnValidationInput): string | null {
  // Identity — needed to recognise this return again on re-import.
  if (!i.returnItemId && !(i.returnOrderId && i.orderItemId)) {
    return 'Provide either a Return Item ID, or both a Return Order ID and an Order Item ID, so this return can be identified uniquely.';
  }

  // Dates
  if (i.returnDate === null) return 'Return date is required.';
  if (!validDate(i.returnDate)) return 'Return date is not a valid date.';
  if (i.orderDate !== null && !validDate(i.orderDate))
    return 'Order date is not a valid date.';
  if (i.receivedAt !== null && !validDate(i.receivedAt))
    return 'Received date is not a valid date.';

  // Receipt rules
  if (RECEIPT_REQUIRED_STATUSES.includes(i.inventoryStatus) && !i.receivedAt) {
    return 'A received date is required once the item is marked as received, restocked or damaged.';
  }
  if (i.inventoryStatus === 'NOT_RECEIVED' && i.receivedAt) {
    return 'Clear the received date, or change the inventory status — an item cannot be “not received” and have a received date.';
  }

  // Numbers
  if (!Number.isInteger(i.quantity) || i.quantity <= 0)
    return 'Quantity must be a whole number greater than zero.';
  if (i.paidAmount < 0) return 'Paid amount cannot be negative.';
  if (i.refundAmount < 0) return 'Refund amount cannot be negative.';
  if (i.unitCost !== null && i.unitCost < 0)
    return 'Cost per unit cannot be negative.';

  // A stock effect needs a product to apply it to.
  if (i.inventoryStatus !== 'NOT_RECEIVED' && !i.productId) {
    return 'Select the product before recording a physical inventory status — stock cannot be adjusted for an unknown product.';
  }

  return null;
}

/**
 * Defence-in-depth against double-counting a refund.
 *
 * As of the legacy-field lockdown, the Sales form can no longer put a value in
 * `Sale.returnsRefunds` — new sales always store 0 — so a new refund can only
 * be recorded in the Returns module. This check still matters for HISTORICAL
 * sales that already carry a legacy refund: linking a completed seller-charged
 * return to one of those would count the same money twice.
 *
 * Note this only fires for LINKED returns. An unlinked return against a
 * historical sale that carries a legacy refund cannot be detected here — the
 * protection for that case is that the legacy field is no longer writable, so
 * the overlap set is closed and finite.
 */
export function legacyRefundConflict(i: {
  refundStatus: ReturnRefundStatus;
  chargedTo: ReturnChargedTo;
  linkedSaleLegacyRefund: number | null;
}): string | null {
  if (i.linkedSaleLegacyRefund === null) return null;
  if (i.linkedSaleLegacyRefund <= 0) return null;
  if (!(i.refundStatus === 'COMPLETED' && i.chargedTo === 'SELLER')) return null;
  return (
    'This sale already records a refund of Rs ' +
    i.linkedSaleLegacyRefund.toFixed(2) +
    ' in its legacy “Returns / refunds” field. Clear that legacy value on the sale first, otherwise the refund would be counted twice in Profit & Loss.'
  );
}
