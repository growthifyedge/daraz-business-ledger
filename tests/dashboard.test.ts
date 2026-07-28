// Tests for the Dashboard redesign: the Store filter must scope every figure,
// All Stores must equal the sum of both stores, Released + Ready must equal the
// imported Daraz Net, and the removed Cash-Flow / manual-settlement / profit-
// share cards must be gone from the Dashboard page. The figure tests exercise the
// pure selector; the removal test scans the page source (no DB / render needed).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  summariseDarazIncome,
  summariseInventory,
  storeHref,
  isStoreSwitchBlocked,
  type DashboardIncomeLine,
  type InventoryProductRow,
} from '../lib/dashboard';

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

// --- Store filter helpers -------------------------------------------------

test('storeHref maps a store id to a scoped URL and null to the bare route', () => {
  assert.equal(storeHref('store_ge'), '/dashboard?store=store_ge');
  assert.equal(storeHref(null), '/dashboard');
  assert.equal(storeHref(undefined), '/dashboard');
  // Ids are URL-encoded so odd characters can't break the query string.
  assert.equal(storeHref('a b&c'), '/dashboard?store=a%20b%26c');
});

test('isStoreSwitchBlocked ignores clicks while pending or on the active scope', () => {
  // A switch already in flight blocks every click.
  assert.equal(isStoreSwitchBlocked(true, 'store_ge', null), true);
  assert.equal(isStoreSwitchBlocked(true, null, null), true);
  // Re-selecting the current scope is a no-op (null/undefined are the same scope).
  assert.equal(isStoreSwitchBlocked(false, null, null), true);
  assert.equal(isStoreSwitchBlocked(false, undefined, null), true);
  assert.equal(isStoreSwitchBlocked(false, 'store_ge', 'store_ge'), true);
  // A real switch to a different scope is allowed.
  assert.equal(isStoreSwitchBlocked(false, 'store_ge', null), false);
  assert.equal(isStoreSwitchBlocked(false, null, 'store_ge'), false);
  assert.equal(isStoreSwitchBlocked(false, 'store_ashu', 'store_ge'), false);
});

// --- Inventory snapshot ---------------------------------------------------

test('summariseInventory values stock at cost and counts low/negative products', () => {
  const products: InventoryProductRow[] = [
    { currentStock: 10, purchaseCost: 100, minStockLevel: 5 }, // healthy
    { currentStock: 3, purchaseCost: 50, minStockLevel: 5 }, // low (<= min)
    { currentStock: 5, purchaseCost: 20, minStockLevel: 5 }, // low (== min)
    { currentStock: -2, purchaseCost: 40, minStockLevel: 0 }, // negative + low
  ];
  const snap = summariseInventory(products);
  assert.equal(snap.stockValueAtCost, 10 * 100 + 3 * 50 + 5 * 20 + -2 * 40);
  assert.equal(snap.totalUnits, 16);
  assert.equal(snap.productCount, 4);
  assert.equal(snap.lowStockCount, 3);
  assert.equal(snap.negativeStockCount, 1);
});

test('summariseInventory returns zeroes for an empty product list', () => {
  const snap = summariseInventory([]);
  assert.deepEqual(snap, {
    stockValueAtCost: 0,
    totalUnits: 0,
    productCount: 0,
    lowStockCount: 0,
    negativeStockCount: 0,
  });
});

test('DashboardShell gives immediate, non-blank loading feedback on store switch', () => {
  const src = readFileSync(
    resolve(process.cwd(), 'app/(dashboard)/dashboard/DashboardShell.tsx'),
    'utf8'
  );
  // Spinner text beside the selector while a switch is loading.
  assert.ok(src.includes('Updating dashboard'), 'shows an updating spinner label');
  // Buttons disabled during the switch to prevent double navigation.
  assert.ok(src.includes('disabled={isPending}'), 'disables store buttons while pending');
  // Previous figures stay mounted but dimmed (never blank).
  assert.ok(src.includes('aria-busy={isPending}'), 'marks the figures busy while pending');
  assert.ok(src.includes('opacity-40'), 'dims the previous figures instead of blanking them');
  // Double-click / repeat-navigation guard is wired to the pure helper.
  assert.ok(src.includes('isStoreSwitchBlocked'), 'guards against repeat navigation');
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
