// Pure, store-scoped selectors for the Dashboard overview. NO Prisma, NO I/O —
// the page supplies already-fetched Daraz income lines; this module only filters
// by store and buckets each line into Released / Ready-to-Release. Kept pure so
// the scoping rules (store filter, All-Stores = Σ stores, Released + Ready = Net)
// are unit-testable without a database.
//
// This is presentation wiring only: it reuses the SAME Released/Ready rules as
// Cash Flow and the Payouts page (sumReleasedNet / sumReadyToReleaseNet), so the
// Dashboard can never diverge from them. It does not change any calculation.

import { round2 } from './daraz/fees';
import { sumReleasedNet, sumReadyToReleaseNet, type DarazCashLine } from './cashflow';

// ---------------------------------------------------------------------------
// Store filter — pure href + click-guard helpers (shared by the client selector
// and its tests). Keeping these here means the interaction rules (which button
// is active, when a click must be ignored, what URL a store maps to) are unit-
// testable without a DOM.
// ---------------------------------------------------------------------------

/** URL for a given store scope. null / undefined ⇒ All Stores (bare route). */
export function storeHref(storeId: string | null | undefined): string {
  return storeId ? `/dashboard?store=${encodeURIComponent(storeId)}` : '/dashboard';
}

/**
 * Whether a click on a store button should be ignored — either because a switch
 * is already in flight (prevents double-clicks / repeated navigation) or because
 * the target is already the active scope (no pointless re-navigation). Treats
 * null and undefined as the same "All Stores" scope.
 */
export function isStoreSwitchBlocked(
  isPending: boolean,
  targetStoreId: string | null | undefined,
  currentStoreId: string | null | undefined
): boolean {
  if (isPending) return true;
  return (targetStoreId ?? null) === (currentStoreId ?? null);
}

/** One imported income line as the Dashboard needs it: store + release + net. */
export interface DashboardIncomeLine extends DarazCashLine {
  storeId?: string | null;
}

export interface DarazIncomeOverview {
  /** Σ line.netAmount in scope — Daraz-authoritative net income. */
  net: number;
  /** Σ net of Released lines — actual cash paid out (matches Cash Flow / Payouts). */
  released: number;
  /** Σ net of Ready-to-Release lines — expected, not yet paid. */
  ready: number;
  /** True when every line is Released or Ready, so released + ready === net. */
  reconciles: boolean;
}

/**
 * Summarise imported Daraz income for the Dashboard, scoped to one store (by
 * storeId) or All Stores (storeId null/undefined). A store filter includes ONLY
 * lines whose storeId matches; All Stores includes every line. Because every
 * line belongs to exactly one store bucket, the All-Stores totals equal the sum
 * of the individual stores' totals. Pure — never mutates its input.
 */
export function summariseDarazIncome(
  lines: DashboardIncomeLine[],
  storeId?: string | null
): DarazIncomeOverview {
  const scoped = storeId ? lines.filter((l) => (l.storeId ?? null) === storeId) : lines;
  const net = round2(scoped.reduce((s, l) => s + l.netAmount, 0));
  const released = sumReleasedNet(scoped);
  const ready = sumReadyToReleaseNet(scoped);
  return {
    net,
    released,
    ready,
    reconciles: round2(released + ready) === net,
  };
}

// ---------------------------------------------------------------------------
// Inventory snapshot — one product read, valued at cost, with low/negative
// counts. Pure so the page can fetch products ONCE (instead of getStockValue
// plus a second product query) and derive every Inventory figure from it. Uses
// the same valuation rule as getStockValue (currentStock × purchaseCost).
// ---------------------------------------------------------------------------

export interface InventoryProductRow {
  currentStock: number;
  purchaseCost: number;
  minStockLevel: number;
}

export interface InventorySnapshot {
  stockValueAtCost: number;
  totalUnits: number;
  productCount: number;
  lowStockCount: number; // at or below minimum
  negativeStockCount: number; // physically impossible stock (data issue)
}

export function summariseInventory(products: InventoryProductRow[]): InventorySnapshot {
  let stockValueAtCost = 0;
  let totalUnits = 0;
  let lowStockCount = 0;
  let negativeStockCount = 0;
  for (const p of products) {
    stockValueAtCost += p.currentStock * p.purchaseCost;
    totalUnits += p.currentStock;
    if (p.currentStock <= p.minStockLevel) lowStockCount += 1;
    if (p.currentStock < 0) negativeStockCount += 1;
  }
  return {
    stockValueAtCost: round2(stockValueAtCost),
    totalUnits,
    productCount: products.length,
    lowStockCount,
    negativeStockCount,
  };
}
