// Pure Cash Flow logic — no Prisma, no I/O. getCashFlow() supplies DB figures;
// this module decides what is actual cash, what is only expected, what is an
// obligation, and applies the store-scope rules. Kept pure so every accounting
// rule below is unit-testable.
//
// Non-negotiable rules encoded here:
//  • Net cash movement counts ONLY actual cash: owner investment (in), Daraz
//    RELEASED net (in), reimbursement to Yahya for stock (out), expenses (out),
//    and profit payouts (out). There is NO manual-Settlement term.
//  • Expected Daraz money (Ready to Release) is shown separately and NEVER
//    affects cash movement.
//  • Obligations (stock debt owed to Yahya, accrued Yahya/Owner profit shares)
//    are NOT cash movement and are never summed into it.
//  • A single-store view must not absorb global figures: owner investment and
//    profit payouts carry no store, so they are excluded from a store-filtered
//    net cash movement (shown only in All Stores).

import { round2 } from './daraz/fees';
import { isReleased } from './daraz/income';
import { classifyPayoutStatus } from './daraz/payouts';

export interface DarazCashLine {
  releaseStatus?: string | null;
  netAmount: number;
}

/** Actual cash in from Daraz: net of RELEASED lines only (identical rule to the
 *  Payouts page, so the two never diverge). */
export function sumReleasedNet(lines: DarazCashLine[]): number {
  return round2(
    lines.filter((l) => isReleased(l.releaseStatus)).reduce((s, l) => s + l.netAmount, 0)
  );
}

/** Expected (not-yet-received) Daraz money: net of Ready-to-Release lines. This
 *  is never part of cash movement — it becomes cash only once Daraz marks the
 *  line Released. */
export function sumReadyToReleaseNet(lines: DarazCashLine[]): number {
  return round2(
    lines
      .filter((l) => classifyPayoutStatus(l.releaseStatus) === 'ready')
      .reduce((s, l) => s + l.netAmount, 0)
  );
}

export interface StoreScopedCostRow {
  storeId?: string | null;
  amount: number;
}

/**
 * Sum costs deductible for the active scope. A store filter includes ONLY rows
 * whose storeId equals the filter — it excludes OTHER stores AND unassigned /
 * global (null-store) rows, so a store's profit never silently absorbs another
 * store's or a global cost. All Stores (no storeId) includes every row.
 */
export function sumStoreScopedCosts(
  rows: StoreScopedCostRow[],
  storeId: string | null | undefined
): number {
  const scoped = storeId ? rows.filter((r) => (r.storeId ?? null) === storeId) : rows;
  return round2(scoped.reduce((s, r) => s + r.amount, 0));
}

export interface CashFlowFigures {
  investment: number; // global (no store)
  darazReleasedNet: number; // store/date scoped — actual cash in
  reimbursedToYahya: number; // store/date scoped — actual cash out (stock reimbursement)
  expensesPaid: number; // store/date scoped — actual cash out
  profitPayoutsPaid: number; // global (no store) — actual cash out
  darazReadyToReleaseNet: number; // store/date scoped — EXPECTED, not cash
  owedToYahya: number; // debt balance — obligation, not cash
  reconciliationPending: number; // info only — not owed, not cash
  yahyaShareUnpaid: number; // accrued obligation, not cash
  ownerShareUnpaid: number; // accrued obligation, not cash
  isStoreFiltered: boolean;
}

export interface CashFlowSections {
  // A. Actual cash movement
  investment: number;
  darazReleasedNet: number;
  reimbursedToYahya: number;
  expensesPaid: number;
  profitPayoutsPaid: number;
  netCashMovement: number;
  /** True when a store filter hid non-zero global figures from cash movement. */
  globalsExcluded: boolean;
  // B. Expected Daraz cash — NOT in cash movement
  darazReadyToReleaseNet: number;
  // C. Outstanding obligations — NOT in cash movement
  owedToYahya: number;
  reconciliationPending: number;
  yahyaShareUnpaid: number;
  ownerShareUnpaid: number;
  isStoreFiltered: boolean;
}

/**
 * Assemble the three Cash Flow sections. netCashMovement is the ONLY summed
 * figure and it includes strictly actual cash items — never the manual
 * Settlement channel (which is not an input at all), never expected Daraz money,
 * never obligations. When store-filtered, global investment and profit payouts
 * are zeroed out of the movement.
 */
export function buildCashFlow(f: CashFlowFigures): CashFlowSections {
  const investment = f.isStoreFiltered ? 0 : f.investment;
  const profitPayoutsPaid = f.isStoreFiltered ? 0 : f.profitPayoutsPaid;
  const netCashMovement = round2(
    investment + f.darazReleasedNet - f.reimbursedToYahya - f.expensesPaid - profitPayoutsPaid
  );
  return {
    investment,
    darazReleasedNet: f.darazReleasedNet,
    reimbursedToYahya: f.reimbursedToYahya,
    expensesPaid: f.expensesPaid,
    profitPayoutsPaid,
    netCashMovement,
    globalsExcluded: f.isStoreFiltered && (f.investment !== 0 || f.profitPayoutsPaid !== 0),
    darazReadyToReleaseNet: f.darazReadyToReleaseNet,
    owedToYahya: f.owedToYahya,
    reconciliationPending: f.reconciliationPending,
    yahyaShareUnpaid: f.yahyaShareUnpaid,
    ownerShareUnpaid: f.ownerShareUnpaid,
    isStoreFiltered: f.isStoreFiltered,
  };
}
