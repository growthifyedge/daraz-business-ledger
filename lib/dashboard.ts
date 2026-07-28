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
