// Focused tests for the Bulk Purchase Upload preview: CSV parsing, validation,
// and the three duplicate rules. Pure — no DB. The context is synthetic.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseBulkPurchaseCsv,
  classifyBulkPurchases,
  bulkPurchaseTemplateCsv,
  refKeyOf,
  softKeyOf,
  BULK_PURCHASE_HEADERS,
  type BulkContext,
  type RawBulkRow,
} from '../lib/purchaseBulk';

function ctx(overrides: Partial<BulkContext> = {}): BulkContext {
  return {
    productBySku: new Map([
      ['1008', { id: 'p8', name: 'Hand gripper', sku: '1008' }],
      ['1010', { id: 'p10', name: 'Posture belt', sku: '1010' }],
    ]),
    storeByName: new Map([['ashu traderz', { id: 's1', name: 'Ashu Traderz' }]]),
    existingRefKeys: new Set<string>(),
    existingSoftKeys: new Set<string>(),
    ...overrides,
  };
}

function row(p: Partial<RawBulkRow> = {}): RawBulkRow {
  return {
    date: '2026-07-18',
    productSku: '1008',
    quantity: '10',
    unitCost: '250',
    reference: '',
    store: '',
    purchasedBy: '',
    notes: '',
    ...p,
  };
}

// --- template + parsing ---

test('template: header matches the defined columns', () => {
  const csv = bulkPurchaseTemplateCsv();
  assert.equal(csv.split('\n')[0], BULK_PURCHASE_HEADERS.join(','));
});

test('parse: reads header-keyed rows and trims; column order independent', () => {
  const csv = 'quantity,date,productSku,unitCost,reference,store,purchasedBy,notes\n5, 2026-07-01 ,1010, 300 ,R1,Ashu Traderz,Yahya,ok\n';
  const rows = parseBulkPurchaseCsv(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].productSku, '1010');
  assert.equal(rows[0].date, '2026-07-01');
  assert.equal(rows[0].quantity, '5');
});

test('parse: quoted field with comma is preserved', () => {
  const csv = 'date,productSku,quantity,unitCost,reference,store,purchasedBy,notes\n2026-07-01,1008,1,250,,,,"box, tape"\n';
  const rows = parseBulkPurchaseCsv(csv);
  assert.equal(rows[0].notes, 'box, tape');
});

test('parse: missing required column throws', () => {
  assert.throws(() => parseBulkPurchaseCsv('date,productSku,quantity\n2026-07-01,1008,1\n'), /Missing required column/);
});

// --- classification: NEW + ERROR ---

test('classify: a clean, unseen row is NEW', () => {
  const { rows, summary } = classifyBulkPurchases([row()], ctx());
  assert.equal(rows[0].status, 'NEW');
  assert.equal(rows[0].parsed?.productId, 'p8');
  assert.equal(rows[0].parsed?.totalCost, 2500);
  assert.equal(summary.new, 1);
});

test('classify: unknown SKU, bad qty/cost/date/store all → ERROR (never name-matched)', () => {
  const bad = classifyBulkPurchases(
    [
      row({ productSku: 'Hand gripper' }), // a NAME, not an active SKU
      row({ quantity: '0' }),
      row({ unitCost: '-5' }),
      row({ date: 'not-a-date' }),
      row({ store: 'Nowhere' }),
    ],
    ctx()
  );
  assert.deepEqual(
    bad.rows.map((r) => r.status),
    ['ERROR', 'ERROR', 'ERROR', 'ERROR', 'ERROR']
  );
  assert.match(bad.rows[0].messages.join(' '), /Unknown or inactive SKU/);
});

// --- duplicate rule 1: reference + SKU ---

test('rule 1: matching reference + product SKU → DUPLICATE', () => {
  const c = ctx({ existingRefKeys: new Set([refKeyOf('p8', 'INV-1042')]) });
  const { rows } = classifyBulkPurchases([row({ reference: 'INV-1042' })], c);
  assert.equal(rows[0].status, 'DUPLICATE');
  assert.match(rows[0].messages.join(' '), /Reference already recorded/);
});

test('rule 1: same reference but different product is NOT a duplicate', () => {
  const c = ctx({ existingRefKeys: new Set([refKeyOf('p8', 'INV-1042')]) });
  const { rows } = classifyBulkPurchases([row({ productSku: '1010', reference: 'INV-1042' })], c);
  assert.equal(rows[0].status, 'NEW');
});

// --- duplicate rule 2: identical rows within the file ---

test('rule 2: identical repeated row in the same file → second is DUPLICATE', () => {
  const { rows } = classifyBulkPurchases([row({ reference: 'A' }), row({ reference: 'A' })], ctx());
  assert.equal(rows[0].status, 'NEW');
  assert.equal(rows[1].status, 'DUPLICATE');
  assert.match(rows[1].messages.join(' '), /earlier row in this file/);
});

// --- duplicate rule 3: same date+SKU+qty+unitCost → possible duplicate (warning) ---

test('rule 3: same date+SKU+qty+unitCost as existing → POSSIBLE_DUPLICATE only', () => {
  const c = ctx({ existingSoftKeys: new Set([softKeyOf('p8', '2026-07-18', 10, 250)]) });
  const { rows, summary } = classifyBulkPurchases([row()], c);
  assert.equal(rows[0].status, 'POSSIBLE_DUPLICATE');
  assert.equal(summary.possibleDuplicate, 1);
  assert.match(rows[0].messages.join(' '), /verify before importing/);
});

test('rule precedence: reference duplicate wins over soft match', () => {
  const c = ctx({
    existingRefKeys: new Set([refKeyOf('p8', 'INV-1042')]),
    existingSoftKeys: new Set([softKeyOf('p8', '2026-07-18', 10, 250)]),
  });
  const { rows } = classifyBulkPurchases([row({ reference: 'INV-1042' })], c);
  assert.equal(rows[0].status, 'DUPLICATE');
});

test('summary counts every bucket', () => {
  const c = ctx({ existingSoftKeys: new Set([softKeyOf('p10', '2026-07-18', 10, 250)]) });
  const { summary } = classifyBulkPurchases(
    [
      row(), // NEW
      row({ productSku: '1010' }), // POSSIBLE_DUPLICATE
      row({ quantity: 'x' }), // ERROR
      row({ reference: 'B' }),
      row({ reference: 'B' }), // second identical → DUPLICATE
    ],
    c
  );
  assert.equal(summary.total, 5);
  assert.equal(summary.new, 2);
  assert.equal(summary.possibleDuplicate, 1);
  assert.equal(summary.error, 1);
  assert.equal(summary.duplicate, 1);
});
