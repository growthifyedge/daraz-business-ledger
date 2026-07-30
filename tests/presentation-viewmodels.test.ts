// Presentation Safe View — Phase 3A view-model tests (Returns, Purchases,
// Products). Proves that the redacted DTOs handed to client components contain
// no original confidential value or dropped key, in both profiles, and that the
// inactive context yields byte-identical values to today. Also simulates the
// client-side CSV cell extraction to prove exports carry no originals.
//
// Pure modules → run under `tsx --test` with no Next runtime.

import test from 'node:test';
import assert from 'node:assert/strict';

import { formatMoney } from '../lib/utils';
import type { PresentationContext } from '../lib/presentation/core';
import {
  toReturnsPresentationRows,
  toReturnsPresentationTotals,
  type ReturnsSourceRow,
} from '../lib/presentation/viewmodels/returns';
import {
  toPurchasesPresentationRows,
  toPurchasesPresentationTotals,
  type PurchasesSourceRow,
} from '../lib/presentation/viewmodels/purchases';
import {
  toProductsPresentationRows,
  type ProductsSourceRow,
} from '../lib/presentation/viewmodels/products';

const OPS: PresentationContext = { active: true, profile: 'OPERATIONS' };
const FIN: PresentationContext = { active: true, profile: 'FINANCE' };
const OFF: PresentationContext = { active: false, profile: null };

// Distinctive confidential sample values — chosen so a substring match is a true
// leak, not a coincidence with a preserved field.
const RETURN: ReturnsSourceRow = {
  id: 'r1',
  returnDate: new Date('2026-05-01T00:00:00Z'),
  productName: 'Wireless Widget',
  storeName: 'Ashu',
  orderNumber: '114-2233445-9',
  returnOrderId: 'RO-99887766',
  trackingNumber: 'TRK-55443322',
  quantity: 2,
  refundAmount: 12_345,
  chargedTo: 'SELLER',
  refundStatus: 'COMPLETED',
  inventoryStatus: 'RESTOCKED',
  reason: 'Defective',
  buyerName: 'Ahmed Khan',
};
const RETURN_SECRETS = ['Ahmed Khan', '114-2233445-9', 'RO-99887766', 'TRK-55443322', '12345', '12,345'];

const PURCHASE: PurchasesSourceRow = {
  id: 'p1',
  date: new Date('2026-04-02T00:00:00Z'),
  productName: 'Wireless Widget',
  storeName: 'Ashu',
  quantity: 5,
  unitCost: 2_600,
  totalCost: 13_000,
  paymentStatus: 'PAID',
  purchasedBy: 'Yahya Traders',
};
const PURCHASE_SECRETS = ['Yahya Traders', '2600', '2,600', '13000', '13,000'];

const PRODUCT: ProductsSourceRow = {
  id: 'pr1',
  name: 'Wireless Widget',
  sku: 'WW-001',
  category: 'Lifestyle Gadgets',
  purchaseCost: 2_600,
  sellingPrice: 4_900,
  currentStock: 40,
  minStockLevel: 8,
  damagedStock: 1,
  lostStock: 0,
  returnedStock: 2,
  active: true,
  storeNames: ['Ashu', 'GrowthifyEdge'],
  notes: 'buys from confidential supplier X',
};
const PRODUCT_SECRETS = ['2600', '2,600', '4900', '4,900', '104000', '104,000', 'confidential supplier'];

function assertNoSecrets(obj: unknown, secrets: string[]) {
  const blob = JSON.stringify(obj);
  for (const s of secrets) {
    assert.ok(!blob.includes(s), `leaked confidential value: ${s}`);
  }
}

// ---------------------------------------------------------------------------
// Returns
// ---------------------------------------------------------------------------

test('returns: active DTO drops sensitive keys and never leaks originals (both profiles)', () => {
  for (const ctx of [OPS, FIN]) {
    const [row] = toReturnsPresentationRows([RETURN], ctx);
    const keys = Object.keys(row);
    assert.ok(!keys.includes('buyerName'), 'buyerName key absent');
    assert.ok(!keys.includes('notes'), 'notes key absent');
    assert.match(row.customer, /^Customer [A-Z]\d{1,2}$/);
    assert.match(row.orderNumber, /^ORD-[0-9A-F]{6}$/);
    assert.match(row.returnId, /^RET-[0-9A-F]{6}$/);
    assert.match(row.tracking, /^TRK-[0-9A-F]{6}$/);
    // Preserved operational fields.
    assert.equal(row.productName, 'Wireless Widget');
    assert.equal(row.quantity, 2);
    assertNoSecrets(row, RETURN_SECRETS);
  }
});

test('returns: money is status (Operations) vs band (Finance), never exact', () => {
  assert.equal(toReturnsPresentationRows([RETURN], OPS)[0].refund, 'Positive');
  assert.equal(toReturnsPresentationRows([RETURN], FIN)[0].refund, 'Rs 10k–25k');
});

test('returns: inactive context is identity', () => {
  const [row] = toReturnsPresentationRows([RETURN], OFF);
  assert.equal(row.customer, 'Ahmed Khan');
  assert.equal(row.orderNumber, '114-2233445-9');
  assert.equal(row.returnId, 'RO-99887766');
  assert.equal(row.tracking, 'TRK-55443322');
  assert.equal(row.refund, formatMoney(12_345));
});

test('returns: totals are redacted per profile', () => {
  const input = { refund: 12_345, sellerLoss: 6_000, platformCovered: 3_000, pending: 1_500, count: 4 };
  const ops = toReturnsPresentationTotals(input, OPS);
  assert.equal(ops.sellerLoss, 'Positive');
  assert.equal(ops.count, 4);
  const fin = toReturnsPresentationTotals(input, FIN);
  assert.equal(fin.sellerLoss, 'Rs 5k–10k');
  assert.equal(toReturnsPresentationTotals(input, OFF).refund, formatMoney(12_345));
});

// ---------------------------------------------------------------------------
// Purchases
// ---------------------------------------------------------------------------

test('purchases: active DTO drops sensitive keys and never leaks originals (both profiles)', () => {
  for (const ctx of [OPS, FIN]) {
    const [row] = toPurchasesPresentationRows([PURCHASE], ctx);
    const keys = Object.keys(row);
    for (const k of ['purchasedBy', 'bankReference', 'invoiceUrl', 'notes']) {
      assert.ok(!keys.includes(k), `${k} key absent`);
    }
    assert.match(row.supplier, /^Supplier [A-Z]\d{1,2}$/);
    assert.equal(row.productName, 'Wireless Widget');
    assert.equal(row.quantity, 5);
    assertNoSecrets(row, PURCHASE_SECRETS);
  }
});

test('purchases: costs are status vs band, never exact; inactive is identity', () => {
  assert.equal(toPurchasesPresentationRows([PURCHASE], OPS)[0].unitCost, 'Positive');
  assert.equal(toPurchasesPresentationRows([PURCHASE], FIN)[0].totalCost, 'Rs 10k–25k');
  const off = toPurchasesPresentationRows([PURCHASE], OFF)[0];
  assert.equal(off.supplier, 'Yahya Traders');
  assert.equal(off.unitCost, formatMoney(2_600));
  assert.equal(off.totalCost, formatMoney(13_000));
});

test('purchases: totals are redacted per profile', () => {
  const input = { total: 13_000, payable: 8_000, paid: 5_000, count: 3 };
  assert.equal(toPurchasesPresentationTotals(input, OPS).payable, 'Positive');
  assert.equal(toPurchasesPresentationTotals(input, FIN).payable, 'Rs 5k–10k');
  assert.equal(toPurchasesPresentationTotals(input, OFF).total, formatMoney(13_000));
});

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

test('products: active DTO hides money + notes, preserves operational fields (both profiles)', () => {
  for (const ctx of [OPS, FIN]) {
    const [row] = toProductsPresentationRows([PRODUCT], ctx);
    assert.ok(!Object.keys(row).includes('notes'), 'notes key absent');
    // Preserved.
    assert.equal(row.name, 'Wireless Widget');
    assert.equal(row.sku, 'WW-001');
    assert.equal(row.currentStock, 40);
    assert.equal(row.active, true);
    assert.equal(row.lowStock, false);
    assert.deepEqual(row.storeNames, ['Ashu', 'GrowthifyEdge']);
    assertNoSecrets(row, PRODUCT_SECRETS);
  }
});

test('products: cost/price/stock-value are status vs band; inactive is identity', () => {
  const ops = toProductsPresentationRows([PRODUCT], OPS)[0];
  assert.equal(ops.purchaseCost, 'Positive');
  assert.equal(ops.sellingPrice, 'Positive');
  assert.equal(ops.stockValue, 'Positive');
  const fin = toProductsPresentationRows([PRODUCT], FIN)[0];
  assert.equal(fin.purchaseCost, 'Rs 2.5k–5k');
  assert.equal(fin.stockValue, 'Rs 100k–250k'); // 40 * 2600 = 104,000
  const off = toProductsPresentationRows([PRODUCT], OFF)[0];
  assert.equal(off.purchaseCost, formatMoney(2_600));
  assert.equal(off.sellingPrice, formatMoney(4_900));
  assert.equal(off.stockValue, formatMoney(104_000));
});

// ---------------------------------------------------------------------------
// Export safety — simulate the client-side CSV cell extraction over the exact
// redacted rows the presentation views pass to <ExportButtons>.
// ---------------------------------------------------------------------------

test('exports: CSV cells built from redacted rows contain no original values', () => {
  const returnsCsv = toReturnsPresentationRows([RETURN], FIN)
    .flatMap((r) => Object.values(r).map((v) => String(v ?? '')))
    .join(',');
  for (const s of RETURN_SECRETS) assert.ok(!returnsCsv.includes(s), `returns CSV leaked ${s}`);

  const purchasesCsv = toPurchasesPresentationRows([PURCHASE], FIN)
    .flatMap((r) => Object.values(r).map((v) => String(v ?? '')))
    .join(',');
  for (const s of PURCHASE_SECRETS) assert.ok(!purchasesCsv.includes(s), `purchases CSV leaked ${s}`);

  const productsCsv = toProductsPresentationRows([PRODUCT], FIN)
    .flatMap((r) => Object.values(r).map((v) => String(v ?? '')))
    .join(',');
  for (const s of PRODUCT_SECRETS) assert.ok(!productsCsv.includes(s), `products CSV leaked ${s}`);
});
