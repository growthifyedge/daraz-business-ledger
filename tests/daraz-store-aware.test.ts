// Phase 4 focused tests: store isolation, same SKU in both stores, order-line
// idempotency + status update, raw-PII-column rejection, sanitized acceptance.
// Pure — no DB, no real Daraz data.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  validateSanitizedOrderHeaders,
  normaliseSanitizedOrderRows,
  planOrderLineWrites,
  type SanitizedOrderRecord,
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

// --- raw-PII-column rejection ------------------------------------------------

test('PII rejection: any customer/personal column rejects the whole Orders file', () => {
  const forbiddenSets = [
    ['Order Number', 'Order Line ID', 'Seller SKU', 'Product Name', 'Order Date', 'Order Status', 'Customer Name'],
    ['Order Line ID', 'customerEmail'],
    ['Order Line ID', 'shippingPhone'],
    ['Order Line ID', 'Shipping Address'],
    ['Order Line ID', 'nationalRegistrationNumber'],
    ['Order Line ID', 'billingName'],
    ['Order Line ID', 'trackingCode'],
  ];
  for (const headers of forbiddenSets) {
    const v = validateSanitizedOrderHeaders(headers);
    assert.equal(v.ok, false, `should reject: ${headers.join(',')}`);
    assert.ok((v.forbidden?.length ?? 0) > 0, `should flag PII in: ${headers.join(',')}`);
  }
});

test('PII rejection: the error names the offending column(s)', () => {
  const v = validateSanitizedOrderHeaders(['Order Line ID', 'Customer Name', 'shippingPhone']);
  assert.match(v.error ?? '', /Customer Name/);
  assert.match(v.error ?? '', /shippingPhone/);
});

// --- sanitized-file acceptance ----------------------------------------------

test('sanitized acceptance: the exact permitted column set is accepted', () => {
  const v = validateSanitizedOrderHeaders([
    'Order Number', 'Order Line ID', 'Seller SKU', 'Product Name', 'Order Date', 'Order Status',
  ]);
  assert.equal(v.ok, true);
});

test('sanitized acceptance: accepted synonyms and optional Quantity are allowed', () => {
  const v = validateSanitizedOrderHeaders([
    'Order Number', 'Order Item ID', 'SKU', 'Product Name', 'Order Date', 'Status', 'Quantity',
  ]);
  assert.equal(v.ok, true);
});

test('sanitized acceptance: a missing required column is reported (not treated as PII)', () => {
  const v = validateSanitizedOrderHeaders(['Order Line ID', 'Seller SKU', 'Product Name', 'Order Date', 'Order Status']);
  assert.equal(v.ok, false);
  assert.deepEqual(v.missing, ['Order Number']);
  assert.equal(v.forbidden, undefined);
});

test('sanitized normalise: derives quantity 1 and carries no PII', () => {
  const rows = normaliseSanitizedOrderRows([
    { 'Order Number': 'ORD-1', 'Order Line ID': 'OL-1', 'Seller SKU': 'SKU-X', 'Product Name': 'P', 'Order Date': '01 Jul 2026', 'Order Status': 'Delivered' },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].quantity, 1);
  assert.equal(rows[0].orderItemId, 'OL-1');
  assert.deepEqual(Object.keys(rows[0]).sort(), ['orderDate', 'orderItemId', 'orderNumber', 'productName', 'quantity', 'sellerSku', 'status']);
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
