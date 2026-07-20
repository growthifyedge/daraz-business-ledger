// Focused tests for the Bulk Purchase Upload preview: CSV parsing, validation,
// and the three duplicate rules. Pure — no DB. The context is synthetic.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseBulkPurchaseCsv,
  classifyBulkPurchases,
  selectImportableRows,
  bulkPurchaseTemplateCsv,
  rowsFromGrid,
  cellToString,
  refKeyOf,
  softKeyOf,
  BULK_PURCHASE_HEADERS,
  type BulkContext,
  type ClassifiedBulkRow,
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
  const c = ctx({ existingRefKeys: new Set([refKeyOf('p8', 'INV-1042', null)]) });
  const { rows } = classifyBulkPurchases([row({ reference: 'INV-1042' })], c);
  assert.equal(rows[0].status, 'DUPLICATE');
  assert.match(rows[0].messages.join(' '), /Reference already recorded/);
});

test('rule 1: same reference but different product is NOT a duplicate', () => {
  const c = ctx({ existingRefKeys: new Set([refKeyOf('p8', 'INV-1042', null)]) });
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
    existingRefKeys: new Set([refKeyOf('p8', 'INV-1042', null)]),
    existingSoftKeys: new Set([softKeyOf('p8', '2026-07-18', 10, 250)]),
  });
  const { rows } = classifyBulkPurchases([row({ reference: 'INV-1042' })], c);
  assert.equal(rows[0].status, 'DUPLICATE');
});

// --- duplicate rule 1 is store-aware: reference + SKU + store ---

test('refKeyOf: store is part of the strong key', () => {
  assert.notEqual(refKeyOf('p8', 'INV-1042', 's1'), refKeyOf('p8', 'INV-1042', 's2'));
  assert.notEqual(refKeyOf('p8', 'INV-1042', 's1'), refKeyOf('p8', 'INV-1042', null));
  assert.equal(refKeyOf('p8', 'INV-1042', 's1'), refKeyOf('p8', 'INV-1042', 's1'));
});

test('rule 1 store-aware: same reference+SKU in a different store is NOT a duplicate', () => {
  const c = ctx({
    storeByName: new Map([
      ['ashu traderz', { id: 's1', name: 'Ashu Traderz' }],
      ['warehouse b', { id: 's2', name: 'Warehouse B' }],
    ]),
    existingRefKeys: new Set([refKeyOf('p8', 'INV-1042', 's1')]),
  });
  const { rows } = classifyBulkPurchases(
    [
      row({ reference: 'INV-1042', store: 'Ashu Traderz' }), // same store → DUPLICATE
      row({ reference: 'INV-1042', store: 'Warehouse B' }), // different store → NEW
      row({ reference: 'INV-1042', store: '' }), // no store → NEW (different key)
    ],
    c
  );
  assert.deepEqual(
    rows.map((r) => r.status),
    ['DUPLICATE', 'NEW', 'NEW']
  );
});

// --- Excel path parity: rowsFromGrid + cellToString ---

test('cellToString: Date → ISO, number → string (numeric SKU), null → empty', () => {
  assert.equal(cellToString(new Date(Date.UTC(2026, 6, 18))), '2026-07-18T00:00:00.000Z');
  assert.equal(cellToString(1008), '1008');
  assert.equal(cellToString(250.5), '250.5');
  assert.equal(cellToString(null), '');
  assert.equal(cellToString(undefined), '');
  assert.equal(cellToString({ richText: [{ text: 'box' }, { text: ' tape' }] }), 'box tape');
  assert.equal(cellToString({ result: 42 }), '42');
});

test('rowsFromGrid: header-keyed, column-order independent (shared with CSV)', () => {
  const grid = [
    ['quantity', 'date', 'productSku', 'unitCost', 'reference', 'store', 'purchasedBy', 'notes'],
    ['5', '2026-07-01', '1010', '300', 'R1', 'Ashu Traderz', 'Yahya', 'ok'],
  ];
  const rows = rowsFromGrid(grid);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].productSku, '1010');
  assert.equal(rows[0].quantity, '5');
});

test('rowsFromGrid: missing column and empty grid throw', () => {
  assert.throws(() => rowsFromGrid([['date', 'productSku', 'quantity']]), /Missing required column/);
  assert.throws(() => rowsFromGrid([]), /empty/);
});

test('excel parity: a grid built from spreadsheet cells classifies same as CSV', () => {
  // Simulate what exceljs yields: numeric SKU/qty/cost and a Date cell.
  const grid = [
    [...BULK_PURCHASE_HEADERS],
    [
      cellToString(new Date(Date.UTC(2026, 6, 18))),
      cellToString(1008), // numeric SKU
      cellToString(10),
      cellToString(250),
      cellToString('INV-1042'),
      cellToString('Ashu Traderz'),
      cellToString('Yahya'),
      cellToString('restock'),
    ],
  ];
  const rows = rowsFromGrid(grid);
  const { rows: out } = classifyBulkPurchases(rows, ctx());
  assert.equal(out[0].status, 'NEW');
  assert.equal(out[0].parsed?.productId, 'p8');
  assert.equal(out[0].parsed?.dateISO, '2026-07-18');
  assert.equal(out[0].parsed?.totalCost, 2500);
});

// --- import selection (what the commit path is allowed to write) ---

test('selectImportableRows: NEW always; POSSIBLE only if ticked; never ERROR/DUPLICATE', () => {
  const rows = classifyBulkPurchases(
    [
      row(), // NEW
      row({ reference: 'B' }),
      row({ reference: 'B' }), // in-file DUPLICATE
      row({ quantity: '0' }), // ERROR
      row({ productSku: '1010' }), // POSSIBLE_DUPLICATE (soft match below)
    ],
    ctx({ existingSoftKeys: new Set([softKeyOf('p10', '2026-07-18', 10, 250)]) })
  ).rows;

  const statuses = rows.map((r) => r.status);
  assert.deepEqual(statuses, ['NEW', 'NEW', 'DUPLICATE', 'ERROR', 'POSSIBLE_DUPLICATE']);

  // Nothing ticked → only the two NEW rows.
  const none = selectImportableRows(rows, new Set());
  assert.deepEqual(none.map((r) => r.line), [1, 2]);

  // Tick the possible-duplicate line (5) → it joins; duplicates/errors never do.
  const withPossible = selectImportableRows(rows, new Set([5]));
  assert.deepEqual(withPossible.map((r) => r.line), [1, 2, 5]);

  // A ticked line that is NOT a possible-duplicate (e.g. the DUPLICATE line 3)
  // is still never importable.
  const tickDup = selectImportableRows(rows, new Set([3, 4]));
  assert.deepEqual(tickDup.map((r) => r.line), [1, 2]);
});

test('import works with ZERO NEW rows: a ticked possible-duplicate is importable', () => {
  const c = ctx({ existingSoftKeys: new Set([softKeyOf('p8', '2026-07-18', 10, 250)]) });
  const rows = classifyBulkPurchases([row()], c).rows;
  assert.equal(rows[0].status, 'POSSIBLE_DUPLICATE');
  assert.equal(rows.filter((r) => r.status === 'NEW').length, 0); // no NEW rows at all
  // Nothing ticked → nothing importable.
  assert.equal(selectImportableRows(rows, new Set()).length, 0);
  // Tick the possible row → it becomes importable even with zero NEW rows.
  assert.deepEqual(selectImportableRows(rows, new Set([1])).map((r) => r.line), [1]);
});

test('selectImportableRows: empty when only duplicates/errors exist', () => {
  const rows: ClassifiedBulkRow[] = classifyBulkPurchases(
    [row({ quantity: 'x' }), row({ reference: 'C' }), row({ reference: 'C' })],
    ctx()
  ).rows;
  // line1 ERROR, line2 NEW, line3 DUPLICATE -> only line2 importable
  assert.deepEqual(selectImportableRows(rows, new Set()).map((r) => r.line), [2]);
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
