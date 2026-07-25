// Phase 4 focused tests: store isolation, same SKU in both stores, order-line
// idempotency + status update, raw-PII-column rejection, sanitized acceptance.
// Pure — no DB, no real Daraz data.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  validateRawOrderHeaders,
  normaliseRawOrderRows,
  planOrderLineWrites,
  combineOrderRecords,
  statusRank,
  statusBucket,
  type SanitizedOrderRecord,
  type RawOrderRecord,
} from '../lib/daraz/sanitize';
import {
  computeDryRun,
  dupKey,
  planIncomeLineWrites,
  type SkuMappingEntry,
  type LedgerProduct,
} from '../lib/daraz/dryrun';
import { buildIncomeLines, parseIncomeCsv } from '../lib/daraz/parse';
import { batchFingerprint, sha256Hex } from '../lib/daraz/fingerprint';

const ASHU = 'store-ashu';
const GE = 'store-ge';

// One shared product; the SAME Seller SKU is mapped in BOTH stores to it.
const PRODUCTS: LedgerProduct[] = [
  { id: 'p-shared', sku: 'LED-1', name: 'Shared Product', currentStock: 10, purchaseCost: 100 },
];
const MAPPINGS: SkuMappingEntry[] = [
  { storeId: ASHU, sellerSku: 'SKU-X', productId: 'p-shared' },
  { storeId: GE, sellerSku: 'SKU-X', productId: 'p-shared' },
];

const HDR =
  'Statement Period;Statement Number;Transaction Date;Fee Name;Est Release Amount(Include Tax);VAT Amount;Release Status;Comment;Order Creation Date;Order Number;Order Line ID;Seller SKU;Lazada SKU;WHT Amount;WHT included in Amount;Order Status;Product Name;Short Code';
const csvFor = (oiid: string, sku: string) =>
  ['banner', '""', HDR,
    `01 Jul 2026;ST-1;05 Jul 2026;Product Price Paid by Buyer;100;0;Ready;;01 Jul 2026;ORD-1;${oiid};${sku};LZ;0;NO;Delivered;Prod;SC`,
  ].join('\n');

const order = (oiid: string, sku: string, status = 'Delivered'): SanitizedOrderRecord => ({
  orderItemId: oiid, orderNumber: 'ORD-1', sellerSku: sku, productName: 'Prod', orderDate: '01 Jul 2026', status, quantity: 1,
});

function run(storeId: string, oiid: string, sku: string, existingOrderLineIds = new Set<string>()) {
  return computeDryRun({
    storeId,
    incomeLines: buildIncomeLines(parseIncomeCsv(csvFor(oiid, sku))),
    orders: [order(oiid, sku)],
    skuMappings: MAPPINGS,
    products: PRODUCTS,
    alreadyImported: new Set(),
    existingOrderLineIds,
    batchAlreadyImported: false,
  });
}

// --- store isolation ---------------------------------------------------------

test('store isolation: a mapping resolves only for its own store', () => {
  // Only Ashu maps SKU-Y; GrowthifyEdge does not.
  const mappings: SkuMappingEntry[] = [{ storeId: ASHU, sellerSku: 'SKU-Y', productId: 'p-shared' }];
  const base = {
    incomeLines: buildIncomeLines(parseIncomeCsv(csvFor('OI-1', 'SKU-Y'))),
    orders: [order('OI-1', 'SKU-Y')],
    skuMappings: mappings,
    products: PRODUCTS,
    alreadyImported: new Set<string>(),
    batchAlreadyImported: false,
  };
  const ashu = computeDryRun({ ...base, storeId: ASHU });
  const ge = computeDryRun({ ...base, storeId: GE });
  assert.equal(ashu.lines[0].skuResolved, true);
  assert.equal(ashu.lines[0].resolvedProductId, 'p-shared');
  assert.equal(ge.lines[0].skuResolved, false); // GE cannot see Ashu's mapping
  assert.equal(ge.totals.unresolvedSkus, 1);
});

test('same SKU in both stores resolves to the shared product for each store', () => {
  const a = run(ASHU, 'OI-A', 'SKU-X');
  const g = run(GE, 'OI-G', 'SKU-X');
  assert.equal(a.lines[0].resolvedProductId, 'p-shared');
  assert.equal(g.lines[0].resolvedProductId, 'p-shared');
  assert.equal(a.mappingComplete, true);
  assert.equal(g.mappingComplete, true);
});

test('store isolation: same files, different store → distinct batch fingerprint', () => {
  const o = sha256Hex('orders'), i = sha256Hex('income');
  assert.notEqual(batchFingerprint(o, i, ASHU), batchFingerprint(o, i, GE));
});

// --- order-line idempotency + status update ---------------------------------

test('order-line idempotency: a re-uploaded Order Line ID is an update, not a duplicate', () => {
  const incoming: SanitizedOrderRecord[] = [
    order('OL-1', 'SKU-X', 'Delivered'), // already stored (was Shipping)
    order('OL-2', 'SKU-X', 'Shipping'), // brand new
  ];
  const plan = planOrderLineWrites(new Set(['OL-1']), incoming);
  assert.deepEqual(plan.updates.map((o) => o.orderItemId), ['OL-1']);
  assert.deepEqual(plan.inserts.map((o) => o.orderItemId), ['OL-2']);
  // The Shipping→Delivered line carries the new status into the update.
  assert.equal(plan.updates[0].status, 'Delivered');
});

test('order-line idempotency: dry-run reports new vs updated counts by Order Line ID', () => {
  const r = run(ASHU, 'OL-9', 'SKU-X', new Set(['OL-9'])); // OL-9 already stored
  assert.equal(r.totals.orderLinesUpdated, 1);
  assert.equal(r.totals.orderLinesNew, 0);
  const fresh = run(ASHU, 'OL-10', 'SKU-X'); // nothing stored
  assert.equal(fresh.totals.orderLinesNew, 1);
  assert.equal(fresh.totals.orderLinesUpdated, 0);
});

test('order-line idempotency: duplicate Order Line IDs within one file collapse to one', () => {
  const plan = planOrderLineWrites(new Set(), [order('OL-1', 'SKU-X'), order('OL-1', 'SKU-X')]);
  assert.equal(plan.inserts.length, 1);
});

// --- raw file with PII is ACCEPTED and auto-sanitized (not rejected) ---------

// Real raw Daraz "All Orders" headers use camelCase and carry lots of PII.
const RAW_HEADERS = [
  'orderItemId', 'orderNumber', 'sellerSku', 'itemName', 'createTime', 'status',
  'customerName', 'customerEmail', 'nationalRegistrationNumber',
  'shippingName', 'shippingAddress', 'shippingPhone', 'shippingCity',
  'billingName', 'billingAddress', 'billingPhone', 'trackingCode', 'trackingUrl',
  'shippingProvider', 'unitPrice', 'paidPrice', 'notes',
];

test('raw accept: the official raw Daraz Orders header (with PII columns) is accepted', () => {
  const v = validateRawOrderHeaders(RAW_HEADERS);
  assert.equal(v.ok, true); // NOT rejected
  assert.ok((v.discardedColumns ?? 0) >= 16); // all PII/extra columns are discarded
});

test('raw accept: a file missing the order identifiers is rejected as not-a-Daraz-export', () => {
  const v = validateRawOrderHeaders(['customerName', 'shippingPhone', 'unitPrice']);
  assert.equal(v.ok, false);
  assert.ok((v.missing?.length ?? 0) > 0);
});

test('raw accept: synonyms (Order Item ID / SKU / Status / Order Date) are recognised', () => {
  const v = validateRawOrderHeaders(['Order Number', 'Order Item ID', 'SKU', 'Product Name', 'Order Date', 'Status']);
  assert.equal(v.ok, true);
});

// --- retained rows contain ONLY the seven permitted fields (PII discarded) ----

const PERMITTED_KEYS = ['orderDate', 'orderItemId', 'orderNumber', 'productName', 'quantity', 'sellerSku', 'status'];

test('auto-discard: a raw row with PII yields ONLY the seven permitted fields', () => {
  const rows = normaliseRawOrderRows([
    {
      orderItemId: 'OL-1', orderNumber: 'ORD-1', sellerSku: 'SKU-X', itemName: 'Widget',
      createTime: '01 Jul 2026', status: 'Delivered',
      customerName: 'Real Person', customerEmail: 'p@example.com', shippingPhone: '03001234567',
      shippingAddress: 'House 1, Lahore', nationalRegistrationNumber: '3520212345671',
      billingName: 'Real Person', trackingCode: 'TRK-999', shippingProvider: 'Daraz Express',
      unitPrice: '999', paidPrice: '999', notes: 'leave at gate',
    },
  ]);
  assert.equal(rows.length, 1);
  assert.deepEqual(Object.keys(rows[0]).sort(), PERMITTED_KEYS);
  assert.equal(rows[0].orderItemId, 'OL-1');
  assert.equal(rows[0].productName, 'Widget'); // itemName → productName
  assert.equal(rows[0].orderDate, '01 Jul 2026'); // createTime → orderDate
  assert.equal(rows[0].quantity, 1); // derived
});

test('auto-discard: NO discarded PII value appears anywhere in the sanitized output', () => {
  const rows = normaliseRawOrderRows([
    {
      orderItemId: 'OL-9', orderNumber: 'ORD-9', sellerSku: 'SKU-X', itemName: 'Widget',
      createTime: '01 Jul 2026', status: 'Shipping',
      customerName: 'Jane Doe', customerEmail: 'jane@x.com', shippingPhone: '03007654321',
      shippingAddress: 'Secret Street 42', trackingCode: 'TRK-SECRET', billingPhone: '03009999999',
    },
  ]);
  const serialized = JSON.stringify(rows);
  for (const secret of ['Jane Doe', 'jane@x.com', '03007654321', 'Secret Street 42', 'TRK-SECRET', '03009999999']) {
    assert.equal(serialized.includes(secret), false, `discarded PII "${secret}" must not survive`);
  }
});

// --- multi-file combine by Order Line ID (Shipping → Delivered → Returned) ----

const oline = (status: string, updateTime?: string, id = 'OL-1'): RawOrderRecord => ({
  orderItemId: id, orderNumber: 'ORD-1', sellerSku: 'SKU-X', productName: 'W',
  orderDate: '01 Jul 2026', status, quantity: 1, ...(updateTime ? { updateTime } : {}),
});

test('combine: same Order Line ID across Shipping→Delivered→Returned collapses to one (newest by updateTime)', () => {
  const files = [
    oline('Shipping', '2026-07-01T10:00:00Z'),
    oline('Returned', '2026-07-05T10:00:00Z'),
    oline('Delivered', '2026-07-03T10:00:00Z'),
  ];
  const c = combineOrderRecords(files);
  assert.equal(c.records.length, 1);
  assert.equal(c.records[0].status, 'Returned'); // newest updateTime wins
  assert.equal(c.mergedDuplicates, 2);
  assert.deepEqual(c.byStatus, { shipping: 0, delivered: 0, returned: 1, other: 0 });
  assert.equal('updateTime' in c.records[0], false); // transient, never stored
});

test('combine: order of input does not matter — result is deterministic', () => {
  const a = combineOrderRecords([oline('Shipping', '2026-07-01T10:00:00Z'), oline('Delivered', '2026-07-03T10:00:00Z')]);
  const b = combineOrderRecords([oline('Delivered', '2026-07-03T10:00:00Z'), oline('Shipping', '2026-07-01T10:00:00Z')]);
  assert.equal(a.records[0].status, 'Delivered');
  assert.equal(b.records[0].status, 'Delivered');
});

test('combine: without updateTime, the later lifecycle status wins (Returned > Delivered > Shipping)', () => {
  const c = combineOrderRecords([oline('Delivered'), oline('Shipping'), oline('Returned')]);
  assert.equal(c.records.length, 1);
  assert.equal(c.records[0].status, 'Returned');
  assert.ok(statusRank('Returned') > statusRank('Delivered'));
  assert.ok(statusRank('Delivered') > statusRank('Shipping'));
  assert.equal(statusBucket('Delivered to buyer'), 'delivered');
});

test('combine: multiple files, distinct + shared lines — shared collapses, distinct kept', () => {
  const shippingFile = [oline('Shipping', '2026-07-01T10:00:00Z', 'OL-1'), oline('Shipping', '2026-07-01T10:00:00Z', 'OL-2')];
  const deliveredFile = [oline('Delivered', '2026-07-03T10:00:00Z', 'OL-1'), oline('Delivered', '2026-07-03T10:00:00Z', 'OL-3')];
  const c = combineOrderRecords([...shippingFile, ...deliveredFile]);
  assert.equal(c.records.length, 3); // OL-1, OL-2, OL-3
  assert.equal(c.mergedDuplicates, 1); // OL-1 appeared twice
  const ol1 = c.records.find((r) => r.orderItemId === 'OL-1')!;
  assert.equal(ol1.status, 'Delivered'); // newest across files
});

test('combine: a later weekly re-upload updates the same line, not a duplicate (DB side is ON CONFLICT)', () => {
  // Within one combine, and the dry-run then classifies it as an update vs stored.
  const combined = combineOrderRecords([oline('Delivered', '2026-07-10T10:00:00Z', 'OL-9')]);
  const plan = planOrderLineWrites(new Set(['OL-9']), combined.records); // OL-9 already stored
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.inserts.length, 0);
  assert.equal(plan.updates[0].status, 'Delivered');
});

// --- Daraz Returned export (different header names) ---------------------------

// The Returned export uses different headers for Order Number and Seller SKU
// (the bug: previously rejected as "missing orderNumber and sellerSku").
const RETURNED_HEADERS = [
  'Sale Order Number', 'Return Order Item ID', 'Shop SKU', 'Product Name',
  'Return Requested Date', 'Return Status', 'Update Time',
  'Buyer Name', 'Buyer Phone', 'Return Reason', 'Tracking Number',
];

test('returned format: the Daraz Returned header set is now accepted (not missing orderNumber/sellerSku)', () => {
  const v = validateRawOrderHeaders(RETURNED_HEADERS);
  assert.equal(v.ok, true);
  assert.equal(v.missing, undefined);
});

// The EXACT headers from the live Daraz Returned export (plus return-only PII).
const LIVE_RETURNED_HEADERS = ['Order ID', 'Order Item ID', 'Seller SKU ID', 'Item Name', 'Order Date', 'Status'];

test('returned format (live headers): exact live Returned header set is accepted and maps correctly', () => {
  const withPii = [...LIVE_RETURNED_HEADERS, 'Buyer Name', 'Buyer Phone', 'Return Reason', 'Tracking Number'];
  assert.equal(validateRawOrderHeaders(withPii).ok, true);

  const rows = normaliseRawOrderRows([
    {
      'Order ID': 'ORD-77',
      'Order Item ID': 'OL-77',
      'Seller SKU ID': 'SKU-Z',
      'Item Name': 'Gadget',
      'Order Date': '05 Jul 2026',
      'Status': 'Returned',
      'Buyer Name': 'Jane Doe',
      'Buyer Phone': '03007654321',
      'Return Reason': 'changed mind',
      'Tracking Number': 'TRK-XYZ',
    },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].orderNumber, 'ORD-77'); // Order ID → Order Number
  assert.equal(rows[0].orderItemId, 'OL-77'); // Order Item ID → Order Line ID
  assert.equal(rows[0].sellerSku, 'SKU-Z'); // Seller SKU ID → Seller SKU
  assert.equal(rows[0].productName, 'Gadget'); // Item Name → Product Name
  assert.equal(rows[0].orderDate, '05 Jul 2026'); // Order Date → Order Date
  assert.equal(rows[0].status, 'Returned'); // Status → Order Status
  assert.equal(rows[0].quantity, 1); // derived
  assert.deepEqual(Object.keys(rows[0]).sort(), PERMITTED_KEYS);
  // In-memory PII discard preserved — no return-only PII value survives.
  const serialized = JSON.stringify(rows);
  for (const secret of ['Jane Doe', '03007654321', 'changed mind', 'TRK-XYZ']) {
    assert.equal(serialized.includes(secret), false, `discarded "${secret}" must not survive`);
  }
});

test('returned format: rows map to the seven permitted fields; PII discarded', () => {
  const rows = normaliseRawOrderRows([
    {
      'Sale Order Number': 'ORD-1', 'Return Order Item ID': 'OL-1', 'Shop SKU': 'SKU-X',
      'Product Name': 'Widget', 'Return Requested Date': '05 Jul 2026', 'Return Status': 'Returned',
      'Update Time': '2026-07-05T10:00:00Z',
      'Buyer Name': 'Jane Doe', 'Buyer Phone': '03007654321', 'Return Reason': 'changed mind',
    },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].orderNumber, 'ORD-1'); // Sale Order Number → Order Number
  assert.equal(rows[0].sellerSku, 'SKU-X'); // Shop SKU → Seller SKU
  assert.equal(rows[0].orderItemId, 'OL-1');
  assert.equal(rows[0].status, 'Returned');
  const serialized = JSON.stringify(rows);
  for (const secret of ['Jane Doe', '03007654321', 'changed mind']) {
    assert.equal(serialized.includes(secret), false, `discarded "${secret}" must not survive`);
  }
});

test('mixed batch: Shipping + Delivered + Returned files combine to one line, newest status', () => {
  const shipping = normaliseRawOrderRows([
    { orderItemId: 'OL-1', orderNumber: 'ORD-1', sellerSku: 'SKU-X', itemName: 'W', createTime: '01 Jul 2026', status: 'Shipping', updateTime: '2026-07-01T10:00:00Z' },
    { orderItemId: 'OL-2', orderNumber: 'ORD-2', sellerSku: 'SKU-X', itemName: 'W', createTime: '01 Jul 2026', status: 'Shipping', updateTime: '2026-07-01T10:00:00Z' },
  ]);
  const delivered = normaliseRawOrderRows([
    { orderItemId: 'OL-1', orderNumber: 'ORD-1', sellerSku: 'SKU-X', itemName: 'W', createTime: '01 Jul 2026', status: 'Delivered', updateTime: '2026-07-03T10:00:00Z' },
  ]);
  const returned = normaliseRawOrderRows([
    { 'Sale Order Number': 'ORD-1', 'Return Order Item ID': 'OL-1', 'Shop SKU': 'SKU-X', 'Product Name': 'W', 'Return Requested Date': '05 Jul 2026', 'Return Status': 'Returned', 'Update Time': '2026-07-05T10:00:00Z' },
  ]);
  const c = combineOrderRecords([...shipping, ...delivered, ...returned]);
  assert.equal(c.records.length, 2); // OL-1 (returned), OL-2 (shipping)
  const ol1 = c.records.find((r) => r.orderItemId === 'OL-1')!;
  assert.equal(ol1.status, 'Returned'); // newest across all three files
  assert.equal(c.byStatus.returned, 1);
  assert.equal(c.byStatus.shipping, 1);
});

// --- unknown-format header-only diagnostic (column names only, no row values) --

test('unknown format: readOrdersWorkbook error lists detected COLUMN NAMES, never row values', async () => {
  const ExcelJS = (await import('exceljs')).default;
  const { readOrdersWorkbook } = await import('../lib/daraz/xlsx');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('orders');
  // A file that is NOT a recognised export: has an Order Line ID but nothing
  // that maps to Order Number / Seller SKU / Product Name / Date / Status.
  ws.addRow(['Order Line ID', 'Mystery Column', 'Buyer Full Name']);
  ws.addRow(['OL-1', 'zzz', 'Jane Doe']); // "Jane Doe" is a ROW VALUE — must never leak
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  await assert.rejects(
    readOrdersWorkbook(buf),
    (e: unknown) => {
      const msg = String((e as Error).message);
      assert.match(msg, /Mystery Column/); // detected column names ARE shown
      assert.match(msg, /Buyer Full Name/); // a column NAME (label) is fine to show
      assert.match(msg, /Order Number|Seller SKU/); // names the missing fields
      assert.equal(msg.includes('Jane Doe'), false); // a row VALUE is never shown
      return true;
    }
  );
});

// --- integration: read a real raw .xlsx (with PII) and confirm it is stripped -

test('raw xlsx: reading a raw workbook with PII columns keeps only permitted fields', async () => {
  const ExcelJS = (await import('exceljs')).default;
  const { readOrdersWorkbook } = await import('../lib/daraz/xlsx');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('orders');
  ws.addRow(RAW_HEADERS);
  ws.addRow([
    'OL-1', 'ORD-1', 'SKU-X', 'Widget', '01 Jul 2026', 'Delivered',
    'Real Person', 'p@example.com', '3520212345671',
    'Real Person', 'House 1', '03001234567', 'Lahore',
    'Real Person', 'House 1', '03001234567', 'TRK-1', 'http://track',
    'Daraz Express', '999', '999', 'note',
  ]);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const parsed = await readOrdersWorkbook(buf);
  assert.equal(parsed.length, 1);
  // Only permitted (canonical) keys are present — PII columns never read.
  assert.deepEqual(Object.keys(parsed[0]).sort(), ['orderDate', 'orderItemId', 'orderNumber', 'productName', 'sellerSku', 'status']);
  const serialized = JSON.stringify(parsed);
  for (const secret of ['Real Person', 'p@example.com', '3520212345671', '03001234567', 'TRK-1', 'Daraz Express']) {
    assert.equal(serialized.includes(secret), false, `PII "${secret}" must never be read from the workbook`);
  }
});

// --- revised income-line updates (not silently ignored) ---------------------

test('revised income: an existing (orderItemId, statementNumber) is an UPDATE, not a skip', () => {
  const lines = buildIncomeLines(parseIncomeCsv(csvFor('OI-1', 'SKU-X')));
  const key = dupKey(lines[0].orderItemId, lines[0].statementNumber);
  const plan = planIncomeLineWrites(new Set([key]), lines);
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.inserts.length, 0);
  // The revised (new) figures flow through the update, not the stored ones.
  assert.equal(plan.updates[0].netAmount, lines[0].netAmount);
});

test('revised income: a brand-new statement line is an insert', () => {
  const lines = buildIncomeLines(parseIncomeCsv(csvFor('OI-2', 'SKU-X')));
  const plan = planIncomeLineWrites(new Set(['other OI-key']), lines);
  assert.equal(plan.inserts.length, 1);
  assert.equal(plan.updates.length, 0);
});

test('revised income: dry-run reports updated vs new and does NOT block the revised line', () => {
  const lines = buildIncomeLines(parseIncomeCsv(csvFor('OI-1', 'SKU-X')));
  const key = dupKey('OI-1', lines[0].statementNumber);
  const r = computeDryRun({
    storeId: ASHU,
    incomeLines: lines,
    orders: [order('OI-1', 'SKU-X')],
    skuMappings: MAPPINGS,
    products: PRODUCTS,
    alreadyImported: new Set([key]), // already imported before — a revision
    batchAlreadyImported: false,
  });
  assert.equal(r.totals.incomeLinesUpdated, 1);
  assert.equal(r.totals.incomeLinesNew, 0);
  assert.equal(r.lines[0].isDuplicate, true);
  assert.equal(r.lines[0].blocked, false); // revised → updated, not blocked/ignored
  assert.ok(r.totals.importable >= 1);
});

// --- no UI/API can reveal customer or tracking data --------------------------

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const REVEAL_PATTERNS =
  /decryptPii|encryptPii|blindIndex|revealCustomer|CustomerReveal|DarazCustomer|darazCustomer|nameEnc|emailEnc|phoneEnc|nationalRegistrationEnc|shipping\w*Enc|billing\w*Enc|trackingCodeEnc|trackingUrlEnc|shippingPhoneHash/;

test('exposure guard: reveal + crypto/mask modules are removed', () => {
  for (const f of [
    'app/(dashboard)/statements/CustomerReveal.tsx',
    'app/(dashboard)/statements/actions.ts',
    'lib/daraz/crypto.ts',
    'lib/daraz/mask.ts',
  ]) {
    assert.equal(existsSync(f), false, `${f} must be removed`);
  }
});

test('exposure guard: no app/lib/schema code references customer/tracking PII or decryption', () => {
  const files = [
    ...walk('app/(dashboard)/statements'),
    ...walk('app/(dashboard)/import'),
    ...walk('app/api/daraz-import'),
    ...walk('lib/daraz'),
    'prisma/schema.prisma',
  ].filter(existsSync);
  assert.ok(files.length > 0, 'expected to scan some files');
  for (const f of files) {
    assert.equal(REVEAL_PATTERNS.test(readFileSync(f, 'utf8')), false, `${f} must not reference customer/tracking PII`);
  }
});
