// Pure tests for the corrected Cash Flow accounting (lib/cashflow.ts) plus a
// source-level guard that getCashFlow no longer touches the legacy Settlement
// table. No DB, no real data.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  sumReleasedNet,
  sumReadyToReleaseNet,
  sumStoreScopedCosts,
  buildCashFlow,
  type CashFlowFigures,
} from '../lib/cashflow';

// A baseline set of figures; individual tests override what they exercise.
function figures(over: Partial<CashFlowFigures> = {}): CashFlowFigures {
  return {
    investment: 0,
    darazReleasedNet: 0,
    reimbursedToYahya: 0,
    expensesPaid: 0,
    profitPayoutsPaid: 0,
    darazReadyToReleaseNet: 0,
    owedToYahya: 0,
    reconciliationPending: 0,
    yahyaShareUnpaid: 0,
    ownerShareUnpaid: 0,
    isStoreFiltered: false,
    ...over,
  };
}

test('1) Released imported income is cash; Ready to Release is not', () => {
  const lines = [
    { releaseStatus: 'Released', netAmount: 1000 },
    { releaseStatus: 'Ready to Release', netAmount: 400 },
    { releaseStatus: 'Pending', netAmount: 30 },
  ];
  const released = sumReleasedNet(lines); // 1000
  const ready = sumReadyToReleaseNet(lines); // 400
  assert.equal(released, 1000);
  assert.equal(ready, 400);

  const cf = buildCashFlow(figures({ darazReleasedNet: released, darazReadyToReleaseNet: ready }));
  // Only Released moved cash; Ready to Release did not touch the movement.
  assert.equal(cf.netCashMovement, 1000);
  assert.equal(cf.darazReadyToReleaseNet, 400);
});

test('2) Ready-to-Release appears as expected payout only, never in cash movement', () => {
  const base = buildCashFlow(figures({ darazReleasedNet: 500, darazReadyToReleaseNet: 0 }));
  const withReady = buildCashFlow(figures({ darazReleasedNet: 500, darazReadyToReleaseNet: 9999 }));
  // Changing Ready-to-Release must not change the movement at all.
  assert.equal(base.netCashMovement, 500);
  assert.equal(withReady.netCashMovement, 500);
  assert.equal(withReady.darazReadyToReleaseNet, 9999);
});

test('3) Legacy Settlement rows cannot affect Cash Flow (never queried or summed)', () => {
  // Structural: buildCashFlow has no settlement input, so no Settlement value can
  // reach the movement. Prove the movement is exactly its actual-cash inputs.
  const cf = buildCashFlow(
    figures({ investment: 100, darazReleasedNet: 50, reimbursedToYahya: 20, expensesPaid: 5, profitPayoutsPaid: 10 })
  );
  assert.equal(cf.netCashMovement, 100 + 50 - 20 - 5 - 10); // 115 — no settlement term exists
  assert.equal('settlementsReceived' in cf, false);

  // Source-level: getCashFlow must not query prisma.settlement.
  const src = readFileSync(join(process.cwd(), 'lib', 'calculations.ts'), 'utf8');
  const start = src.indexOf('export async function getCashFlow');
  assert.ok(start >= 0, 'getCashFlow must exist');
  const after = src.slice(start);
  const end = after.indexOf('\nexport ', 1);
  const body = end >= 0 ? after.slice(0, end) : after;
  assert.ok(!/prisma\.settlement/i.test(body), 'getCashFlow must not query the Settlement table');
  // A comment may name the obsolete table, but no settlement VALUE may be summed.
  assert.ok(!/settlementsReceived|settle\._sum|settlementWhere/i.test(body), 'getCashFlow must not compute a settlement figure');
});

test('4) Stock debt and profit-share payable stay separate and are never summed into cash', () => {
  const cf = buildCashFlow(
    figures({ owedToYahya: 2900, yahyaShareUnpaid: 345.55, ownerShareUnpaid: 345.55 })
  );
  // Distinct fields, distinct values — not merged.
  assert.equal(cf.owedToYahya, 2900);
  assert.equal(cf.yahyaShareUnpaid, 345.55);
  assert.equal(cf.ownerShareUnpaid, 345.55);
  // None of these obligations touch cash movement.
  assert.equal(cf.netCashMovement, 0);
  // Varying the obligations never changes the movement.
  const cf2 = buildCashFlow(figures({ owedToYahya: 1, yahyaShareUnpaid: 2, ownerShareUnpaid: 3 }));
  assert.equal(cf2.netCashMovement, 0);
});

test('5) Store-filtered Cash Flow excludes global Investment and Profit Payouts', () => {
  const store = buildCashFlow(
    figures({ investment: 5000, profitPayoutsPaid: 800, darazReleasedNet: 0, reimbursedToYahya: 13180, isStoreFiltered: true })
  );
  assert.equal(store.investment, 0); // global, hidden in a single store
  assert.equal(store.profitPayoutsPaid, 0);
  assert.equal(store.globalsExcluded, true);
  // Movement = 0 + 0 released − 13180 reimbursed − 0 − 0 = −13180 (matches the audit)
  assert.equal(store.netCashMovement, -13180);
});

test('6) Store-scoped costs exclude other-store AND unassigned/global costs', () => {
  const rows = [
    { storeId: 'ashu', amount: 100 },
    { storeId: 'ge', amount: 200 },
    { storeId: null, amount: 50 }, // unassigned/global (e.g. accessories)
  ];
  // A store filter takes ONLY that store — never another store, never global.
  assert.equal(sumStoreScopedCosts(rows, 'ashu'), 100);
  assert.equal(sumStoreScopedCosts(rows, 'ge'), 200);
});

test('7) All Stores includes every applicable figure', () => {
  const rows = [
    { storeId: 'ashu', amount: 100 },
    { storeId: 'ge', amount: 200 },
    { storeId: null, amount: 50 },
  ];
  assert.equal(sumStoreScopedCosts(rows, null), 350); // all costs
  const all = buildCashFlow(figures({ investment: 5000, profitPayoutsPaid: 800, isStoreFiltered: false }));
  assert.equal(all.investment, 5000); // globals included in All Stores
  assert.equal(all.profitPayoutsPaid, 800);
  assert.equal(all.globalsExcluded, false);
  assert.equal(all.netCashMovement, 5000 - 800); // 4200
});
