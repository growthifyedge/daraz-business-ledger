// Phase 1 tests for the pure Daraz income roll-up. No DB, no wiring.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rollUpDarazIncome, isReleased, type IncomeLineForRollup } from '../lib/daraz/income';
import type { FeeCategory } from '../lib/daraz/fees';
import { sellerLossForPnl } from '../lib/returns';

const fee = (category: FeeCategory, amount: number) => ({ category, amount });

// The EXACT per-category totals from the live Ashu sample (233 lines, 4
// statements). Their signed sum is the Daraz-authoritative net Rs 75,218.94.
const ASHU_CATEGORY_TOTALS: Array<[FeeCategory, number]> = [
  ['PRODUCT_REVENUE', 105344],
  ['BUYER_SHIPPING_CREDIT', 24228],
  ['SHIPPING_DISCOUNT', 11059.55],
  ['REVERSAL', 565.84],
  ['SHIPPING_FEE', -38921.75],
  ['FREE_SHIPPING_MAX_FEE', -8237.34],
  ['REFUND', -3878.26],
  ['HANDLING_FEE', -3168.25],
  ['PAYMENT_FEE', -2726.13],
  ['COMMISSION', -2379.47],
  ['SALES_TAX_WHT', -2066],
  ['INCOME_TAX_WHT', -1928],
  ['VOUCHER_PARTICIPATION', -1768.2],
  ['COINS_PARTICIPATION', -905.05],
];
const ASHU_NET = 75218.94;

test('rollup: reconciles EXACTLY to the Ashu sample net Rs 75,218.94', () => {
  // One synthetic statement line carrying every category at its sample total.
  const line: IncomeLineForRollup = {
    storeId: 'ashu',
    statementNumber: 'ST-1',
    orderItemId: 'OL-1',
    transactionDate: '2026-07-05',
    netAmount: ASHU_NET,
    fees: ASHU_CATEGORY_TOTALS.map(([c, a]) => fee(c, a)),
  };
  const r = rollUpDarazIncome([line]);
  assert.equal(r.net, ASHU_NET); // Σ line.netAmount
  assert.equal(r.categoryNet, ASHU_NET); // Σ every category
  assert.equal(r.reconDiff, 0);
  assert.equal(r.reconciles, true);
  // A few bucket checks.
  assert.equal(r.grossRevenue, 129572); // 105344 + 24228
  assert.equal(r.commission, -2379.47);
  assert.equal(r.refunds, -3878.26);
  assert.equal(r.taxesWithheld, -3994); // -2066 + -1928
});

test('rollup: byCategory sums to categoryNet and equals the Daraz net', () => {
  const line: IncomeLineForRollup = {
    statementNumber: 'ST-1', orderItemId: 'OL-1', netAmount: ASHU_NET,
    fees: ASHU_CATEGORY_TOTALS.map(([c, a]) => fee(c, a)),
  };
  const r = rollUpDarazIncome([line]);
  const sum = Object.values(r.byCategory).reduce((s, v) => s + v, 0);
  assert.equal(Math.round(sum * 100) / 100, ASHU_NET);
});

test('rollup: invariant holds for arbitrary lines (each net = Σ its fees)', () => {
  const mk = (id: string, revenue: number, commission: number): IncomeLineForRollup => ({
    statementNumber: 'ST-9', orderItemId: id,
    netAmount: revenue + commission, // = Σ fees
    fees: [fee('PRODUCT_REVENUE', revenue), fee('COMMISSION', commission)],
  });
  const r = rollUpDarazIncome([mk('A', 1000, -100), mk('B', 500, -50), mk('C', 333.33, -33.33)]);
  assert.equal(r.reconciles, true);
  assert.equal(r.net, r.categoryNet);
  assert.equal(r.lines, 3);
  assert.equal(r.orderItems, 3);
  assert.equal(r.statements, 1);
  assert.equal(r.productRevenue, 1833.33);
  assert.equal(r.commission, -183.33);
});

test('rollup: store scope — only the requested store is aggregated', () => {
  const lines: IncomeLineForRollup[] = [
    { storeId: 'ashu', statementNumber: 'ST-A', orderItemId: 'A1', netAmount: 900, fees: [fee('PRODUCT_REVENUE', 1000), fee('COMMISSION', -100)] },
    { storeId: 'ge', statementNumber: 'ST-B', orderItemId: 'B1', netAmount: 450, fees: [fee('PRODUCT_REVENUE', 500), fee('COMMISSION', -50)] },
  ];
  const ashu = rollUpDarazIncome(lines, { storeId: 'ashu' });
  assert.equal(ashu.lines, 1);
  assert.equal(ashu.net, 900);
  assert.equal(ashu.productRevenue, 1000);
  assert.equal(ashu.reconciles, true);

  const ge = rollUpDarazIncome(lines, { storeId: 'ge' });
  assert.equal(ge.net, 450);
  assert.equal(ge.productRevenue, 500);

  const all = rollUpDarazIncome(lines);
  assert.equal(all.lines, 2);
  assert.equal(all.net, 1350);
});

test('rollup: date scope — only lines within [from, to] are included; undated excluded when filtered', () => {
  const lines: IncomeLineForRollup[] = [
    { statementNumber: 'ST-1', orderItemId: 'A', transactionDate: '2026-06-25', netAmount: 100, fees: [fee('PRODUCT_REVENUE', 100)] },
    { statementNumber: 'ST-2', orderItemId: 'B', transactionDate: '2026-07-10', netAmount: 200, fees: [fee('PRODUCT_REVENUE', 200)] },
    { statementNumber: 'ST-3', orderItemId: 'C', transactionDate: null, netAmount: 999, fees: [fee('PRODUCT_REVENUE', 999)] },
  ];
  const r = rollUpDarazIncome(lines, { from: new Date('2026-07-01'), to: new Date('2026-07-31T23:59:59.999Z') });
  assert.equal(r.lines, 1); // only the 10 Jul line; June + undated excluded
  assert.equal(r.net, 200);
  // No date filter → all included (including the undated line).
  assert.equal(rollUpDarazIncome(lines).lines, 3);
});

test('rollup: empty input reconciles trivially (all zeros)', () => {
  const r = rollUpDarazIncome([]);
  assert.equal(r.lines, 0);
  assert.equal(r.net, 0);
  assert.equal(r.categoryNet, 0);
  assert.equal(r.reconciles, true);
});

// --- no double-count: imported REFUND is inside Daraz net; a linked Return adds 0

test('no double count: an imported REFUND is in the Daraz net and a linked Return does not deduct it again', () => {
  const rollup = rollUpDarazIncome([
    { statementNumber: 'ST-1', orderItemId: 'OL-1', netAmount: 697, fees: [fee('PRODUCT_REVENUE', 1000), fee('COMMISSION', -100), fee('REFUND', -203)] },
  ]);
  assert.equal(rollup.refunds, -203); // refund already inside the Daraz net
  assert.equal(rollup.net, 697);
  assert.equal(rollup.reconciles, true);

  // A Return LINKED to imported income must contribute 0 to P&L (guarded).
  const linked = sellerLossForPnl({
    refundStatus: 'COMPLETED', chargedTo: 'SELLER', deletedAt: null,
    linkedToImportedIncome: true, refundAmount: 203,
  });
  assert.equal(linked, 0); // not deducted again → counted exactly once (in Daraz net)

  // An UNLINKED (manual) return is unaffected — still a P&L loss.
  const manual = sellerLossForPnl({
    refundStatus: 'COMPLETED', chargedTo: 'SELLER', deletedAt: null,
    linkedToImportedIncome: false, refundAmount: 203,
  });
  assert.equal(manual, 203);
});

// --- released detection for Cash Flow ---------------------------------------

test('isReleased: only truly Released statuses count for Cash Flow', () => {
  assert.equal(isReleased('Released'), true);
  assert.equal(isReleased('RELEASED'), true);
  assert.equal(isReleased('Ready to Release'), false);
  assert.equal(isReleased('Not Released'), false);
  assert.equal(isReleased('Pending'), false);
  assert.equal(isReleased(null), false);
  assert.equal(isReleased(''), false);
});
