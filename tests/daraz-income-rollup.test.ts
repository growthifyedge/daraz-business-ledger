// Phase 1 tests for the pure Daraz income roll-up. No DB, no wiring.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rollUpDarazIncome,
  isReleased,
  estimateDarazCogs,
  listMissingCogsProducts,
  isDeliveredExact,
  buildBusinessPnl,
  type IncomeLineForRollup,
  type DeliveredOrderLine,
  type SkuMappingRow,
  type ProductCostRow,
} from '../lib/daraz/income';
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

// --- Estimated Daraz COGS -----------------------------------------------------

const MAPPINGS: SkuMappingRow[] = [
  { storeId: 'ashu', sellerSku: 'SKU-A', productId: 'p-a' },
  { storeId: 'ashu', sellerSku: 'SKU-B', productId: 'p-b' }, // mapped but no cost
  { storeId: 'ge', sellerSku: 'SKU-A', productId: 'p-a' },
];
const PRODUCTS: ProductCostRow[] = [
  { id: 'p-a', purchaseCost: 100 },
  { id: 'p-b', purchaseCost: 0 }, // missing cost
];
const dline = (
  sellerSku: string, status: string, storeId = 'ashu', orderDate: string | null = '2026-07-05', quantity = 1
): DeliveredOrderLine => ({ storeId, sellerSku, status, orderDate, quantity });

test('cogs: costs EXACTLY Delivered lines only (excludes shipping/shipped/returned/cancelled/failed)', () => {
  const c = estimateDarazCogs(
    [
      dline('SKU-A', 'delivered'),
      dline('SKU-A', 'Delivered'), // case-insensitive exact
      dline('SKU-A', 'Shipping'),
      dline('SKU-A', 'shipped'),
      dline('SKU-A', 'returned'),
      dline('SKU-A', 'canceled'),
      dline('SKU-A', 'Buyer Delivery Failed'), // contains "deliver" but NOT delivered
      dline('SKU-A', 'In Transit: Returning to seller'),
    ],
    MAPPINGS,
    PRODUCTS
  );
  assert.equal(c.deliveredUnits, 2); // only the two exact "delivered"
  assert.equal(c.costedUnits, 2);
  assert.equal(c.estimatedCogs, 200);
});

test('cogs: isDeliveredExact matches only "delivered"', () => {
  assert.equal(isDeliveredExact('delivered'), true);
  assert.equal(isDeliveredExact('Delivered'), true);
  assert.equal(isDeliveredExact('Buyer Delivery Failed'), false);
  assert.equal(isDeliveredExact('shipped'), false);
  assert.equal(isDeliveredExact('returned'), false);
  assert.equal(isDeliveredExact(null), false);
});

test('cogs: coverage — mapped/costed units, missing mapping, missing cost', () => {
  const c = estimateDarazCogs(
    [
      dline('SKU-A', 'delivered'), // mapped + cost → costed
      dline('SKU-B', 'delivered'), // mapped, cost 0 → missing cost
      dline('SKU-X', 'delivered'), // no mapping → unmapped
    ],
    MAPPINGS,
    PRODUCTS
  );
  assert.equal(c.deliveredUnits, 3);
  assert.equal(c.mappedUnits, 2);
  assert.equal(c.unmappedUnits, 1);
  assert.equal(c.costedUnits, 1);
  assert.equal(c.missingCostUnits, 1);
  assert.equal(c.estimatedCogs, 100); // only the costed unit
  assert.deepEqual(c.unmappedSkus, ['SKU-X']);
  assert.equal(c.coveragePct, 33.33); // 1/3
});

test('cogs: store + date scope', () => {
  const lines = [
    dline('SKU-A', 'delivered', 'ashu', '2026-07-05'),
    dline('SKU-A', 'delivered', 'ge', '2026-07-05'), // other store
    dline('SKU-A', 'delivered', 'ashu', '2026-06-01'), // out of range
    dline('SKU-A', 'delivered', 'ashu', null), // undated → excluded when filtered
  ];
  const c = estimateDarazCogs(lines, MAPPINGS, PRODUCTS, {
    storeId: 'ashu', from: new Date('2026-07-01'), to: new Date('2026-07-31T23:59:59.999Z'),
  });
  assert.equal(c.deliveredUnits, 1); // only ashu, in July, dated
  assert.equal(c.estimatedCogs, 100);
});

test('cogs: pure — no writes, inputs not mutated (no stock/product/purchase change)', () => {
  const products = [{ id: 'p-a', purchaseCost: 100 }];
  const mappings = [{ storeId: 'ashu', sellerSku: 'SKU-A', productId: 'p-a' }];
  const pSnap = JSON.stringify(products);
  const mSnap = JSON.stringify(mappings);
  const lines = [dline('SKU-A', 'delivered')];
  const lSnap = JSON.stringify(lines);
  estimateDarazCogs(lines, mappings, products);
  assert.equal(JSON.stringify(products), pSnap); // product cost/stock untouched
  assert.equal(JSON.stringify(mappings), mSnap);
  assert.equal(JSON.stringify(lines), lSnap);
});

test('cogs: profit reconciliation — combined = manual net + Daraz net − est. COGS', () => {
  const rollup = rollUpDarazIncome([
    { statementNumber: 'ST-1', orderItemId: 'OL-1', netAmount: 697, fees: [fee('PRODUCT_REVENUE', 1000), fee('COMMISSION', -100), fee('REFUND', -203)] },
  ]);
  const cogs = estimateDarazCogs([dline('SKU-A', 'delivered')], MAPPINGS, PRODUCTS);
  const manualNet = 500;
  const combined = manualNet + rollup.net - cogs.estimatedCogs;
  assert.equal(rollup.net, 697);
  assert.equal(cogs.estimatedCogs, 100);
  assert.equal(combined, 1097); // 500 + 697 − 100
});

// --- Missing-COGS breakdown (feeds the "Missing COGS costs" page) ------------

// The invariant the page depends on: the total units shown MUST equal the
// Dashboard warning's shortfall (deliveredUnits − costedUnits) for the same
// inputs — computed here by the same pure code, so they can never diverge.
test('missing-cogs: total equals estimateDarazCogs deliveredUnits − costedUnits', () => {
  const lines = [
    dline('SKU-A', 'delivered'), // mapped + cost → covered
    dline('SKU-A', 'delivered'), // covered again
    dline('SKU-B', 'delivered'), // mapped, cost 0 → missing (2 units)
    dline('SKU-B', 'delivered', 'ashu', '2026-07-06', 2),
    dline('SKU-X', 'delivered'), // unmapped → missing (1 unit)
    dline('SKU-A', 'shipped'), // not delivered → ignored
  ];
  const est = estimateDarazCogs(lines, MAPPINGS, PRODUCTS);
  const report = listMissingCogsProducts(lines, MAPPINGS, PRODUCTS);
  assert.equal(report.totalMissingUnits, est.deliveredUnits - est.costedUnits);
  assert.equal(report.totalMissingUnits, 4); // 3 × SKU-B + 1 × SKU-X
});

test('missing-cogs: groups by (store, sku); mapped-uncosted and unmapped rows carry the right fields', () => {
  const lines = [
    dline('SKU-B', 'delivered', 'ashu', '2026-07-05', 1),
    dline('SKU-B', 'delivered', 'ashu', '2026-07-06', 2), // same (store, sku) → summed
    dline('SKU-X', 'delivered', 'ge'), // unmapped
  ];
  const report = listMissingCogsProducts(lines, MAPPINGS, PRODUCTS);
  assert.equal(report.rows.length, 2);
  // Sorted by units desc → SKU-B (3) first.
  const [b, x] = report.rows;
  assert.deepEqual(b, {
    productId: 'p-b',
    storeId: 'ashu',
    sellerSku: 'SKU-B',
    deliveredUnitsMissingCost: 3,
    currentPurchaseCost: 0,
    mapped: true,
  });
  assert.deepEqual(x, {
    productId: null,
    storeId: 'ge',
    sellerSku: 'SKU-X',
    deliveredUnitsMissingCost: 1,
    currentPurchaseCost: 0,
    mapped: false,
  });
});

test('missing-cogs: a costed product (cost > 0) never appears — inclusion is driven by delivered units, not stock', () => {
  // SKU-A → p-a (cost 100). Even with many delivered units it is fully covered,
  // so it is excluded regardless of any stock level (the helper has no stock input).
  const report = listMissingCogsProducts(
    [dline('SKU-A', 'delivered'), dline('SKU-A', 'delivered', 'ge')],
    MAPPINGS,
    PRODUCTS
  );
  assert.equal(report.rows.length, 0);
  assert.equal(report.totalMissingUnits, 0);
});

test('missing-cogs: same store+date scope and settled-income filter as the COGS estimate', () => {
  const lines = [
    dline('SKU-B', 'delivered', 'ashu', '2026-07-05'), // in scope, settled
    dline('SKU-B', 'delivered', 'ge', '2026-07-05'), // other store (scoped out at DB → excluded via filter)
    dline('SKU-B', 'delivered', 'ashu', '2026-06-01'), // out of date range
  ].map((l, i) => ({ ...l, orderItemId: `OL-${i}` }));
  const settled = new Set(['OL-0']); // only the first line has settled income

  const report = listMissingCogsProducts(
    lines,
    MAPPINGS,
    PRODUCTS,
    { storeId: 'ashu', from: new Date('2026-07-01'), to: new Date('2026-07-31T23:59:59.999Z') },
    settled
  );
  const est = estimateDarazCogs(
    lines,
    MAPPINGS,
    PRODUCTS,
    { storeId: 'ashu', from: new Date('2026-07-01'), to: new Date('2026-07-31T23:59:59.999Z') },
    settled
  );
  assert.equal(report.totalMissingUnits, est.deliveredUnits - est.costedUnits);
  assert.equal(report.rows.length, 1);
  assert.equal(report.rows[0].deliveredUnitsMissingCost, 1);
});

test('missing-cogs: empty input yields no rows and zero total; inputs are not mutated', () => {
  const products = [{ id: 'p-b', purchaseCost: 0 }];
  const mappings = [{ storeId: 'ashu', sellerSku: 'SKU-B', productId: 'p-b' }];
  const lines = [dline('SKU-B', 'delivered')];
  const snaps = [products, mappings, lines].map((x) => JSON.stringify(x));
  const empty = listMissingCogsProducts([], mappings, products);
  assert.deepEqual(empty, { rows: [], totalMissingUnits: 0 });
  // Purity: a real run must not mutate its inputs.
  listMissingCogsProducts(lines, mappings, products);
  assert.deepEqual([products, mappings, lines].map((x) => JSON.stringify(x)), snaps);
});

// --- unified Business P&L statement (UI reconciliation) ----------------------

test('business P&L: no manual sales — statement lines reconcile to combined net', () => {
  // Manual Sales = 0; combinedNetProfit = daraz net − est.COGS − opex − accessories.
  const combined = 13168.94; // 75218.94 − 60550 − 1000 − 500
  const p = buildBusinessPnl({
    darazNet: 75218.94, estimatedDarazCogs: 60550,
    grossSales: 0, productCost: 0, commission: 0, vat: 0, otherDarazCharges: 0, returnsRefunds: 0,
    operatingExpenses: 1000, accessoriesConsumed: 500,
    combinedNetProfit: combined,
  });
  assert.equal(p.manualSalesMargin, 0);
  assert.equal(p.hasManualSales, false);
  assert.equal(p.businessNetProfit, combined);
  assert.equal(p.reconstructed, combined); // Daraz net − COGS − opex − accessories
  assert.equal(p.reconciles, true);
});

test('business P&L: with manual sales — margin line keeps the statement reconciling', () => {
  // Manual: gross 2000, cost 800, commission 100, vat 50 → margin 1050.
  // manualNetProfit = 1050 − opex(1000) − acc(500) = −450.
  // combinedNetProfit = manualNetProfit + darazNet − estCogs = −450 + 5000 − 3000 = 1550.
  const p = buildBusinessPnl({
    darazNet: 5000, estimatedDarazCogs: 3000,
    grossSales: 2000, productCost: 800, commission: 100, vat: 50, otherDarazCharges: 0, returnsRefunds: 0,
    operatingExpenses: 1000, accessoriesConsumed: 500,
    combinedNetProfit: 1550,
  });
  assert.equal(p.manualSalesMargin, 1050);
  assert.equal(p.hasManualSales, true);
  assert.equal(p.reconstructed, 1550); // 5000 − 3000 + 1050 − 1000 − 500
  assert.equal(p.reconciles, true);
  assert.equal(p.businessNetProfit, 1550);
});
