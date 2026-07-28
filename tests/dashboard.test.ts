// Tests for the Dashboard redesign: the Store filter must scope every figure,
// All Stores must equal the sum of both stores, Released + Ready must equal the
// imported Daraz Net, and the removed Cash-Flow / manual-settlement / profit-
// share cards must be gone from the Dashboard page. The figure tests exercise the
// pure selector; the removal test scans the page source (no DB / render needed).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { summariseDarazIncome, type DashboardIncomeLine } from '../lib/dashboard';

// Two stores, mixed release statuses. Every line is Released or Ready to Release.
const ASHU = 'store_ashu';
const GE = 'store_ge';
const lines: DashboardIncomeLine[] = [
  { storeId: ASHU, releaseStatus: 'Released', netAmount: 1000 },
  { storeId: ASHU, releaseStatus: 'Ready to Release', netAmount: 250 },
  { storeId: GE, releaseStatus: 'Released', netAmount: 39176.56 },
  { storeId: GE, releaseStatus: 'Ready to Release', netAmount: 12001.09 },
  { storeId: GE, releaseStatus: 'Released', netAmount: 500 },
];

test('store filter scopes the figures to only that store', () => {
  const ge = summariseDarazIncome(lines, GE);
  // Only the three GrowthifyEdge lines are counted; Ashu is excluded.
  assert.equal(ge.net, 51677.65);
  assert.equal(ge.released, 39676.56);
  assert.equal(ge.ready, 12001.09);

  const ashu = summariseDarazIncome(lines, ASHU);
  assert.equal(ashu.net, 1250);
  assert.equal(ashu.released, 1000);
  assert.equal(ashu.ready, 250);
});

test('All Stores equals the sum of both stores', () => {
  const all = summariseDarazIncome(lines, null);
  const ashu = summariseDarazIncome(lines, ASHU);
  const ge = summariseDarazIncome(lines, GE);

  assert.equal(all.net, Math.round((ashu.net + ge.net) * 100) / 100);
  assert.equal(all.released, Math.round((ashu.released + ge.released) * 100) / 100);
  assert.equal(all.ready, Math.round((ashu.ready + ge.ready) * 100) / 100);
});

test('Released + Ready equals the imported Daraz Net (reconciles)', () => {
  for (const scope of [null, ASHU, GE]) {
    const s = summariseDarazIncome(lines, scope);
    assert.equal(Math.round((s.released + s.ready) * 100) / 100, s.net);
    assert.equal(s.reconciles, true);
  }
});

test('no store filter defaults to All Stores (every line counted)', () => {
  const all = summariseDarazIncome(lines);
  assert.equal(all.net, 52927.65);
});

test('Dashboard page no longer renders Cash Flow, settlement or profit-share cards', () => {
  const src = readFileSync(
    resolve(process.cwd(), 'app/(dashboard)/dashboard/page.tsx'),
    'utf8'
  );
  const forbidden = [
    'Total Investment',
    'Manual Sales',
    'Manual Net Profit',
    'Yahya Share',
    'Owner Share',
    'Sales & Profit Trend',
    'Profit Distribution',
    'Cash Flow',
    'Settlement',
  ];
  for (const term of forbidden) {
    assert.ok(!src.includes(term), `Dashboard must not mention "${term}"`);
  }
});

test('Dashboard page keeps the store filter and the three overview sections', () => {
  const src = readFileSync(
    resolve(process.cwd(), 'app/(dashboard)/dashboard/page.tsx'),
    'utf8'
  );
  for (const term of ['All Stores', 'Daraz income', 'Profitability', 'Inventory']) {
    assert.ok(src.includes(term), `Dashboard should contain "${term}"`);
  }
});
