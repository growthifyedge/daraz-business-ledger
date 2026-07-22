// Pure balance / status / validation logic for Yahya payments. No Prisma, no
// I/O — unit-testable directly. The server actions supply plain data built from
// the DB; this module decides balances, derived status, and whether an
// allocation set is valid.
//
// Rules (MVP):
//  - Purchase.totalCost is the payable.
//  - paidToDate = Σ non-voided allocation amounts (legacy PAID with no
//    allocations falls back to totalCost, so historical rows are untouched).
//  - A payment MUST be fully allocated: Σ allocations == payment.amount exactly.
//  - Allocations may only target UNPAID / PARTIALLY_PAID purchases, never PAID
//    or RECONCILIATION_PENDING, and never exceed a purchase's remaining balance.

import type { PaymentStatus } from '@prisma/client';

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export interface PurchasePaidInput {
  paymentStatus: PaymentStatus;
  totalCost: number;
  /** Σ of this purchase's non-voided allocation amounts. */
  allocatedAmount: number;
}

/**
 * Amount settled so far. Legacy fallback: a PAID purchase with no allocations
 * is treated as fully paid, so existing history needs no data migration.
 */
export function paidToDate(p: PurchasePaidInput): number {
  if (p.allocatedAmount > 0) return round2(p.allocatedAmount);
  if (p.paymentStatus === 'PAID') return round2(p.totalCost);
  return 0;
}

/** Outstanding balance (never negative). */
export function remainingBalance(p: PurchasePaidInput): number {
  return round2(Math.max(0, p.totalCost - paidToDate(p)));
}

/**
 * Derived status. RECONCILIATION_PENDING is historical and never recomputed —
 * it stays separate and is never driven by allocations.
 */
export function deriveStatus(p: PurchasePaidInput): PaymentStatus {
  if (p.paymentStatus === 'RECONCILIATION_PENDING') return 'RECONCILIATION_PENDING';
  const paid = paidToDate(p);
  if (paid <= 0) return 'UNPAID';
  if (paid < round2(p.totalCost)) return 'PARTIALLY_PAID';
  return 'PAID';
}

/** A purchase may receive a Yahya payment allocation. */
export function isPayable(status: PaymentStatus): boolean {
  return status === 'UNPAID' || status === 'PARTIALLY_PAID';
}

/** Total still owed to Yahya across all payable purchases. */
export function totalPayable(purchases: PurchasePaidInput[]): number {
  return round2(
    purchases
      .filter((p) => isPayable(p.paymentStatus))
      .reduce((s, p) => s + remainingBalance(p), 0)
  );
}

// ---------------------------------------------------------------------------
// Shared cash summary — the single source every screen uses so they agree.
// ---------------------------------------------------------------------------

export interface YahyaCashSummary {
  /** Actual money paid to Yahya: each non-voided bank transfer once, plus
   *  legacy PAID purchases that have no payment allocations. No double count. */
  actualPaidToYahya: number;
  /** Outstanding balance of UNPAID + PARTIALLY_PAID purchases. */
  payableToYahya: number;
  /** RECONCILIATION_PENDING — separate; never owed, paid, or in net cash. */
  reconciliationPending: number;
}

export interface YahyaCashAggregates {
  /** Σ totalCost of UNPAID + PARTIALLY_PAID purchases. */
  payableTotalCost: number;
  /** Σ non-voided allocation amounts against those payable purchases. */
  payableAllocated: number;
  /** Σ totalCost of PAID purchases. */
  paidTotalCost: number;
  /** Σ non-voided allocation amounts against PAID purchases (== their totalCost
   *  when paid via allocations; 0 for legacy PAID). */
  paidAllocated: number;
  /** Σ totalCost of RECONCILIATION_PENDING purchases. */
  reconciliationPendingTotalCost: number;
  /** Σ non-voided YahyaPayment.amount (each transfer counted once). */
  nonVoidedTransferTotal: number;
}

/**
 * Combine DB aggregates into the shared summary. Pure & unit-testable.
 *  - payable  = payable totalCost − allocations to payable purchases.
 *  - legacy PAID (no allocations) = paid totalCost − allocations to paid.
 *  - actual paid = transfers (counted once) + legacy PAID-no-allocation.
 * A PAID purchase settled by allocations contributes 0 to the legacy term (its
 * totalCost equals its allocations), so its money is counted only via the
 * transfer — never twice.
 */
/**
 * The "Paid to Yahya" transfer figure for a store scope. For All Stores
 * (storeId null) each transfer is counted once. For a specific store it is the
 * sum of that store's non-voided allocations — a payment's share landing in the
 * store it settled. Mirrors the SQL aggregate in getYahyaCashSummary. Pure.
 */
export function transferPaidForScope(
  storeId: string | null | undefined,
  allStoresTransferTotal: number,
  allocations: { storeId: string | null; amount: number; voided?: boolean }[]
): number {
  if (!storeId) return round2(allStoresTransferTotal);
  return round2(
    allocations
      .filter((a) => !a.voided && a.storeId === storeId)
      .reduce((s, a) => s + a.amount, 0)
  );
}

export function combineYahyaCash(a: YahyaCashAggregates): YahyaCashSummary {
  const payableToYahya = round2(a.payableTotalCost - a.payableAllocated);
  const legacyPaidNoAllocation = round2(a.paidTotalCost - a.paidAllocated);
  const actualPaidToYahya = round2(a.nonVoidedTransferTotal + legacyPaidNoAllocation);
  return {
    actualPaidToYahya,
    payableToYahya,
    reconciliationPending: round2(a.reconciliationPendingTotalCost),
  };
}

// ---------------------------------------------------------------------------
// Allocation validation
// ---------------------------------------------------------------------------

export interface AllocationInput {
  purchaseId: string;
  amount: number;
}

// ---------------------------------------------------------------------------
// FIFO automatic allocation
// ---------------------------------------------------------------------------

export interface FifoPurchase {
  purchaseId: string;
  /** Current outstanding balance (excluding this payment). */
  remaining: number;
}

export interface FifoResult {
  ok: boolean;
  error?: string;
  allocations: AllocationInput[];
}

/**
 * Automatically allocate a payment amount FIFO across the oldest eligible
 * purchases (caller supplies them oldest-first; RECONCILIATION_PENDING and PAID
 * are already excluded). Fills each purchase's remaining balance before moving
 * to the next. A payment greater than the total payable is rejected. Because a
 * valid payment is ≤ total payable, the returned allocations always sum to the
 * amount exactly (the exact-allocation invariant), with no unallocated remainder.
 */
export function allocateFifo(amount: number, purchasesOldestFirst: FifoPurchase[]): FifoResult {
  const amt = round2(amount);
  if (!(amt > 0)) {
    return { ok: false, error: 'Payment amount must be greater than zero.', allocations: [] };
  }
  const totalPayable = round2(
    purchasesOldestFirst.reduce((s, p) => s + Math.max(0, round2(p.remaining)), 0)
  );
  if (totalPayable <= 0) {
    return { ok: false, error: 'Nothing is payable to Yahya.', allocations: [] };
  }
  if (amt > totalPayable) {
    return {
      ok: false,
      error: `Payment (${amt}) exceeds the total payable to Yahya (${totalPayable}).`,
      allocations: [],
    };
  }

  const allocations: AllocationInput[] = [];
  let left = amt;
  for (const p of purchasesOldestFirst) {
    if (left <= 0) break;
    const rem = round2(Math.max(0, p.remaining));
    if (rem <= 0) continue;
    const a = round2(Math.min(rem, left));
    if (a > 0) {
      allocations.push({ purchaseId: p.purchaseId, amount: a });
      left = round2(left - a);
    }
  }
  return { ok: true, allocations };
}

export interface AllocationTarget {
  purchaseId: string;
  status: PaymentStatus;
  remaining: number; // current remaining balance (excluding this payment)
}

export interface AllocationValidation {
  ok: boolean;
  error?: string;
}

/**
 * Validate a payment's allocations against the exact-full-allocation MVP rule
 * and per-purchase caps. `targets` is the current state of each referenced
 * purchase (remaining balance excluding the payment being saved).
 */
export function validateAllocations(
  paymentAmount: number,
  allocations: AllocationInput[],
  targets: AllocationTarget[]
): AllocationValidation {
  if (!(paymentAmount > 0)) return { ok: false, error: 'Payment amount must be greater than zero.' };
  if (allocations.length === 0) return { ok: false, error: 'Allocate the payment to at least one purchase.' };

  const byId = new Map(targets.map((t) => [t.purchaseId, t]));
  const seen = new Set<string>();
  let sum = 0;

  for (const a of allocations) {
    if (seen.has(a.purchaseId)) {
      return { ok: false, error: 'A purchase appears more than once in the allocation.' };
    }
    seen.add(a.purchaseId);

    if (!(a.amount > 0)) return { ok: false, error: 'Each allocation must be greater than zero.' };

    const t = byId.get(a.purchaseId);
    if (!t) return { ok: false, error: 'Allocation references an unknown purchase.' };
    if (!isPayable(t.status)) {
      return {
        ok: false,
        error: 'Only UNPAID or PARTIALLY_PAID purchases can be paid (RECONCILIATION_PENDING and PAID are excluded).',
      };
    }
    if (round2(a.amount) > round2(t.remaining)) {
      return { ok: false, error: 'An allocation exceeds that purchase’s remaining balance.' };
    }
    sum = round2(sum + a.amount);
  }

  if (round2(sum) !== round2(paymentAmount)) {
    return {
      ok: false,
      error: `Allocations (${round2(sum)}) must equal the payment amount (${round2(paymentAmount)}) exactly — advances are not allowed.`,
    };
  }
  return { ok: true };
}
