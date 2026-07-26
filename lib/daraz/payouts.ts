// Pure roll-up for the read-only "Daraz Payouts" page. Every payout is derived
// ONLY from imported Daraz income (DarazIncomeLine / DarazIncomeFee) — there is
// no manual entry and no legacy Settlement involvement here. Amounts come
// straight from the per-statement summary; fees are never re-added.
//
// A "payout" is one (store, statement number, period). Released classification
// uses the SAME isReleased() that Cash Flow uses, so the Released total on this
// page and the money-in Cash Flow counts can never diverge.

import { round2 } from './fees';
import { isReleased } from './income';
import { summariseStatements, type StatementLineInput, type StatementSummary } from './statements';

/** Income line for a payout, plus the storeId used for store filtering. */
export interface PayoutLineInput extends StatementLineInput {
  storeId?: string | null;
}

export interface PayoutFilter {
  storeId?: string | null;
  from?: Date | null;
  to?: Date | null;
}

/** released → counted in Cash Flow · ready → expected income · other → any raw status. */
export type PayoutStatusKind = 'released' | 'ready' | 'other';

export interface PayoutRow extends StatementSummary {
  /** True iff the raw status means Released (identical rule to Cash Flow). */
  released: boolean;
  statusKind: PayoutStatusKind;
}

export interface PayoutTotals {
  readyToReleaseTotal: number; // Σ net of Ready-to-Release payouts (expected income)
  releasedTotal: number; // Σ net of Released payouts — matches Cash Flow money-in
  totalPayouts: number; // Σ net of ALL imported payouts
  statementCount: number; // number of (store, statement) payouts
}

export interface DarazPayouts {
  rows: PayoutRow[];
  totals: PayoutTotals;
}

/** Classify a raw Daraz release status without losing information. */
export function classifyPayoutStatus(raw: string | null | undefined): PayoutStatusKind {
  if (isReleased(raw)) return 'released';
  const x = (raw ?? '').toLowerCase();
  if (x.includes('ready') && x.includes('releas')) return 'ready';
  return 'other';
}

function ts(d: Date | string | null | undefined): number | null {
  if (d == null) return null;
  const t = d instanceof Date ? d.getTime() : Date.parse(String(d));
  return Number.isNaN(t) ? null : t;
}

/**
 * Store- and date-scope income lines before rolling them up. Same inclusive
 * [from, to] semantics as the shared income helpers; a dated filter drops
 * undated lines. Pure — never mutates its input.
 */
export function filterPayoutLines<T extends PayoutLineInput>(
  lines: T[],
  f: PayoutFilter = {}
): T[] {
  const fromT = f.from ? f.from.getTime() : null;
  const toT = f.to ? f.to.getTime() : null;
  return lines.filter((l) => {
    if (f.storeId && (l.storeId ?? null) !== f.storeId) return false;
    if (fromT != null || toT != null) {
      const t = ts(l.transactionDate);
      if (t == null) return false;
      if (fromT != null && t < fromT) return false;
      if (toT != null && t > toT) return false;
    }
    return true;
  });
}

/**
 * Roll imported income lines up into payouts, grouped by (store, statement,
 * period), with the summary cards' totals. Reconciles exactly: the sum of every
 * row's netPayout equals the sum of the input lines' netAmount.
 */
export function summariseDarazPayouts(lines: PayoutLineInput[]): DarazPayouts {
  // Partition by store first so a statement number that (unexpectedly) spanned
  // two stores becomes two distinct payout rows instead of a merged "Multiple".
  const byStore = new Map<string, PayoutLineInput[]>();
  for (const l of lines) {
    const key = l.storeName ?? '';
    const arr = byStore.get(key);
    if (arr) arr.push(l);
    else byStore.set(key, [l]);
  }

  const rows: PayoutRow[] = [];
  for (const group of byStore.values()) {
    for (const s of summariseStatements(group)) {
      rows.push({
        ...s,
        released: isReleased(s.releaseStatus),
        statusKind: classifyPayoutStatus(s.releaseStatus),
      });
    }
  }
  rows.sort(
    (a, b) =>
      a.storeName.localeCompare(b.storeName) || a.statementNumber.localeCompare(b.statementNumber)
  );

  let readyToReleaseTotal = 0;
  let releasedTotal = 0;
  let totalPayouts = 0;
  for (const r of rows) {
    totalPayouts = round2(totalPayouts + r.netPayout);
    if (r.released) releasedTotal = round2(releasedTotal + r.netPayout);
    else if (r.statusKind === 'ready') readyToReleaseTotal = round2(readyToReleaseTotal + r.netPayout);
  }

  return {
    rows,
    totals: { readyToReleaseTotal, releasedTotal, totalPayouts, statementCount: rows.length },
  };
}
