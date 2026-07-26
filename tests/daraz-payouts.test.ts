// Pure tests for the read-only "Daraz Payouts" roll-up. No DB, no real data.
// Proves: (1) grouping + totals reconcile exactly to imported net;
// (2) Ready to Release is excluded from the Released total; (3) store/date
// filtering works; (4) the Payouts route neither creates nor queries the legacy
// Settlement table (source-level check).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  filterPayoutLines,
  summariseDarazPayouts,
  classifyPayoutStatus,
  type PayoutLineInput,
} from '../lib/daraz/payouts';
import type { FeeCategory } from '../lib/daraz/fees';

const fee = (category: FeeCategory, amount: number) => ({ category, amount });

// One statement line. netAmount is the Daraz-authoritative net; fees are the
// breakdown. Product revenue + buyer shipping + deductions are pre-split so the
// summary columns fill in, but only netAmount drives the payout total.
function line(
  over: Partial<PayoutLineInput> & { statementNumber: string; netAmount: number }
): PayoutLineInput {
  return {
    statementPeriod: '01 Jul 2026 - 07 Jul 2026',
    releaseStatus: 'Released',
    transactionDate: new Date('2026-07-05'),
    storeName: 'Ashu Traderz',
    storeId: 'ashu',
    orderItemId: `OI-${Math.random().toString(36).slice(2, 8)}`,
    productPriceRevenue: 0,
    buyerShippingCredit: 0,
    totalCredits: 0,
    totalDeductions: 0,
    fees: [],
    ...over,
  };
}

test('payouts: grouping + totals reconcile EXACTLY to imported net', () => {
  const lines: PayoutLineInput[] = [
    // ST-1 Ashu, two order items → one payout
    line({ statementNumber: 'ST-1', netAmount: 290.12, productPriceRevenue: 396, buyerShippingCredit: 140, totalDeductions: -245.88, orderItemId: 'OI-1', fees: [fee('PRODUCT_REVENUE', 396), fee('BUYER_SHIPPING_CREDIT', 140), fee('COMMISSION', -245.88)] }),
    line({ statementNumber: 'ST-1', netAmount: 100, productPriceRevenue: 120, totalDeductions: -20, orderItemId: 'OI-2', fees: [fee('PRODUCT_REVENUE', 120), fee('COMMISSION', -20)] }),
    // ST-2 GrowthifyEdge → separate payout
    line({ statementNumber: 'ST-2', netAmount: 55.5, storeName: 'GrowthifyEdge', storeId: 'ge', orderItemId: 'OI-3', fees: [fee('PRODUCT_REVENUE', 55.5)] }),
  ];
  const { rows, totals } = summariseDarazPayouts(lines);

  assert.equal(rows.length, 2); // (Ashu, ST-1) and (GE, ST-2)
  assert.equal(totals.statementCount, 2);
  // Every row's netPayout sums to the imported net — no fee re-added.
  const importedNet = Math.round(lines.reduce((s, l) => s + l.netAmount, 0) * 100) / 100;
  const rowsNet = Math.round(rows.reduce((s, r) => s + r.netPayout, 0) * 100) / 100;
  assert.equal(rowsNet, importedNet);
  assert.equal(totals.totalPayouts, importedNet);
  // The ST-1 payout aggregates its two order items.
  const st1 = rows.find((r) => r.statementNumber === 'ST-1')!;
  assert.equal(st1.storeName, 'Ashu Traderz');
  assert.equal(st1.orderItemCount, 2);
  assert.equal(st1.netPayout, 390.12);
  assert.equal(st1.productRevenue, 516); // 396 + 120
  assert.equal(st1.buyerShippingCredit, 140);
});

test('payouts: Ready to Release is expected income, EXCLUDED from the Released total', () => {
  const lines: PayoutLineInput[] = [
    line({ statementNumber: 'REL-1', netAmount: 1000, releaseStatus: 'Released' }),
    line({ statementNumber: 'RDY-1', netAmount: 400, releaseStatus: 'Ready to Release' }),
    line({ statementNumber: 'OTH-1', netAmount: 30, releaseStatus: 'Pending' }),
  ];
  const { totals } = summariseDarazPayouts(lines);

  assert.equal(totals.releasedTotal, 1000); // only the Released statement
  assert.equal(totals.readyToReleaseTotal, 400); // only the Ready-to-Release one
  assert.equal(totals.totalPayouts, 1430); // everything, including 'Pending'
  // Released classification is the same rule Cash Flow uses.
  assert.equal(classifyPayoutStatus('Released'), 'released');
  assert.equal(classifyPayoutStatus('Ready to Release'), 'ready');
  assert.equal(classifyPayoutStatus('Pending'), 'other');
});

test('payouts: store + date filtering works', () => {
  const lines: PayoutLineInput[] = [
    line({ statementNumber: 'A-JUL', netAmount: 100, storeId: 'ashu', storeName: 'Ashu Traderz', transactionDate: new Date('2026-07-05') }),
    line({ statementNumber: 'A-JUN', netAmount: 200, storeId: 'ashu', storeName: 'Ashu Traderz', transactionDate: new Date('2026-06-05') }),
    line({ statementNumber: 'G-JUL', netAmount: 300, storeId: 'ge', storeName: 'GrowthifyEdge', transactionDate: new Date('2026-07-05') }),
  ];

  // Store filter → only that store's payouts.
  const ashuOnly = summariseDarazPayouts(filterPayoutLines(lines, { storeId: 'ashu' }));
  assert.deepEqual(ashuOnly.rows.map((r) => r.statementNumber).sort(), ['A-JUL', 'A-JUN']);
  assert.equal(ashuOnly.totals.totalPayouts, 300);

  // Date range → only July lines, across both stores.
  const july = summariseDarazPayouts(
    filterPayoutLines(lines, { from: new Date('2026-07-01'), to: new Date('2026-07-31') })
  );
  assert.deepEqual(july.rows.map((r) => r.statementNumber).sort(), ['A-JUL', 'G-JUL']);
  assert.equal(july.totals.totalPayouts, 400);

  // Store + date combined.
  const ashuJuly = summariseDarazPayouts(
    filterPayoutLines(lines, { storeId: 'ashu', from: new Date('2026-07-01'), to: new Date('2026-07-31') })
  );
  assert.deepEqual(ashuJuly.rows.map((r) => r.statementNumber), ['A-JUL']);
  assert.equal(ashuJuly.totals.totalPayouts, 100);
});

test('payouts route: never creates or queries the legacy Settlement table', () => {
  const pagePath = join(process.cwd(), 'app', '(dashboard)', 'payouts', 'page.tsx');
  const helperPath = join(process.cwd(), 'lib', 'daraz', 'payouts.ts');
  const page = readFileSync(pagePath, 'utf8');
  const helper = readFileSync(helperPath, 'utf8');

  // No legacy Settlement TABLE access anywhere in the payouts feature (a comment
  // may name it, but no `prisma.settlement` query/mutation may exist).
  assert.ok(!/prisma\.settlement/i.test(page), 'payouts page must not query the Settlement table');
  assert.ok(!/prisma\.settlement/i.test(helper), 'payouts helper must not query the Settlement table');
  // Read-only: no server actions, no mutations of ANY table on this route.
  assert.ok(!/use server/.test(page), 'payouts page must not be a server-action module');
  assert.ok(!/prisma\.\w+\.(create|update|delete|upsert|createMany|updateMany|deleteMany)\(/.test(page), 'payouts page must not mutate any table');
  // The legacy Settlements route is gone (no manual Daraz settlement entry).
  assert.equal(existsSync(join(process.cwd(), 'app', '(dashboard)', 'settlements')), false);
  assert.equal(existsSync(join(process.cwd(), 'app', '(dashboard)', 'payouts', 'actions.ts')), false);
});
