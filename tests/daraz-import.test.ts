// Synthetic tests for the Daraz import domain logic. No real customer data,
// no real order IDs — every value here is made up. Run: npm test.

import test from 'node:test';
import assert from 'node:assert/strict';

// Test-only PII key (synthetic — NOT a real key). Set before importing crypto.
process.env.DARAZ_PII_KEY ||= Buffer.alloc(32, 7).toString('base64');

import { ALL_FEE_CATEGORIES, categoriseFee, toCategorisedFee, sumByCategory } from '../lib/daraz/fees';
import {
  parseIncomeCsv,
  buildIncomeLines,
  normaliseOrderRows,
} from '../lib/daraz/parse';
import {
  computeDryRun,
  dupKey,
  type LedgerProduct,
  type StockImpact,
  type DryRunResult,
} from '../lib/daraz/dryrun';
import { summariseStatements } from '../lib/daraz/statements';
import { batchFingerprint, sha256Hex } from '../lib/daraz/fingerprint';
import { maskPhone, maskNationalId, maskEmail, maskCustomer } from '../lib/daraz/mask';
import { encryptPii, decryptPii, blindIndex } from '../lib/daraz/crypto';
import { refundCountsInPnl, sellerLossForPnl, isEligibleForPnl } from '../lib/returns';

// Narrowing helpers: stock/COGS become "unavailable" (a string) until every SKU
// is mapped; these assert the available shape for the fully-mapped cases below.
function asImpacts(v: DryRunResult['stockImpact']): StockImpact[] {
  if (!Array.isArray(v)) throw new Error('expected stock impact array (mapping complete)');
  return v;
}
function asNum(v: number | string): number {
  if (typeof v !== 'number') throw new Error('expected numeric projection (mapping complete)');
  return v;
}

// A synthetic income CSV in the real shape: banner, blank, header, fee rows.
// Two order items: "OI-1" (a normal delivered line) and "OI-2" (a return with
// refund + reversal fees). Semicolon-delimited.
const HDR =
  'Statement Period;Statement Number;Transaction Date;Fee Name;Est Release Amount(Include Tax);VAT Amount;Release Status;Comment;Order Creation Date;Order Number;Order Line ID;Seller SKU;Lazada SKU;WHT Amount;WHT included in Amount;Order Status;Product Name;Short Code';
function feeRow(oiid: string, sku: string, fee: string, amt: number, status = 'Delivered', ord = 'ORD-1') {
  return `01 Jul 2026 - 07 Jul 2026;ST-1;05 Jul 2026;${fee};${amt};0;Ready to Release;;01 Jul 2026;${ord};${oiid};${sku};LZ-${sku};0;NO;${status};Test Product ${sku};SC`;
}
// OI-1 delivered: credits 396+140=536, deductions 245.88, net 290.12
const OI1_FEES: Array<[string, number]> = [
  ['Product Price Paid by Buyer', 396],
  ['Shipping Fee Paid by Buyer', 140],
  ['Payment Fee', -10.25],
  ['Shipping Fee', -161],
  ['Free Shipping Max Fee', -34.5],
  ['Daraz Coins Discount Participation Fee', -5.75],
  ['Co-funded Voucher Max', -11.88],
  ['Income Tax Withholding', -4],
  ['Sales Tax Withholding', -7],
  ['Handling Fee', -11.5],
];
// OI-2 return: a commission + a refund + a reversal
const OI2_FEES: Array<[string, number]> = [
  ['Product Price Paid by Buyer', 300],
  ['Commission Fee', -30],
  ['Product Price Refunded to Buyer', -300],
  ['Reversal of Income Tax Withholding', 5],
];
const CSV = [
  'Download at 18 Jul 2026 local time, total to release PKR 1',
  '""',
  HDR,
  ...OI1_FEES.map(([f, a]) => feeRow('OI-1', 'SKU-A', f, a, 'Delivered', 'ORD-1')),
  ...OI2_FEES.map(([f, a]) => feeRow('OI-2', 'SKU-B', f, a, 'Returned', 'ORD-2')),
].join('\n');

const ORDER_ROWS = [
  {
    orderItemId: 'OI-1',
    orderNumber: 'ORD-1',
    sellerSku: 'SKU-A',
    itemName: 'Test Product SKU-A',
    unitPrice: '396',
    paidPrice: '396',
    status: 'delivered',
    createTime: '01 Jul 2026',
    customerName: 'Synthetic Buyer One',
    customerEmail: 'buyer1@example.com',
    nationalRegistrationNumber: '3520212345671',
    shippingName: 'Synthetic Buyer One',
    shippingAddress: 'House 1',
    shippingPhone: '03001234852',
    shippingCity: 'Lahore',
  },
  {
    orderItemId: 'OI-2',
    orderNumber: 'ORD-2',
    sellerSku: 'SKU-B',
    itemName: 'Test Product SKU-B',
    unitPrice: '300',
    paidPrice: '300',
    status: 'returned',
    createTime: '01 Jul 2026',
    customerName: 'Synthetic Buyer Two',
    customerEmail: 'buyer2@example.com',
    nationalRegistrationNumber: '3520298765432',
    shippingPhone: '03007654321',
    shippingCity: 'Karachi',
  },
];

const PRODUCTS: LedgerProduct[] = [
  { id: 'p-a', sku: 'LED-A', name: 'Ledger A', currentStock: 5, purchaseCost: 100 },
  { id: 'p-b', sku: 'LED-B', name: 'Ledger B', currentStock: 0, purchaseCost: 80 },
];
const MAPPINGS = [
  { sellerSku: 'SKU-A', productId: 'p-a' },
  { sellerSku: 'SKU-B', productId: 'p-b' },
];

// ===========================================================================
// 1. Parsing
// ===========================================================================

test('parse: income CSV skips banner/blank, reads header, parses fee rows', () => {
  const rows = parseIncomeCsv(CSV);
  assert.equal(rows.length, OI1_FEES.length + OI2_FEES.length);
  const first = rows[0];
  assert.equal(first.orderItemId, 'OI-1');
  assert.equal(first.sellerSku, 'SKU-A');
  assert.equal(first.feeName, 'Product Price Paid by Buyer');
  assert.equal(first.amount, 396);
  assert.equal(first.statementNumber, 'ST-1');
});

test('parse: order rows normalise to one unit per orderItemId', () => {
  const orders = normaliseOrderRows(ORDER_ROWS);
  assert.equal(orders.length, 2);
  assert.equal(orders[0].quantity, 1);
  assert.equal(orders[1].quantity, 1);
  assert.equal(orders[0].orderItemId, 'OI-1');
  // PII carried through for secure storage
  assert.equal(orders[0].shippingPhone, '03001234852');
});

// ===========================================================================
// 2. Fee categorisation — everything kept separate, labels preserved
// ===========================================================================

test('fees: each Daraz label maps to the correct category, commission isolated', () => {
  assert.equal(categoriseFee('Product Price Paid by Buyer'), 'PRODUCT_REVENUE');
  assert.equal(categoriseFee('Shipping Fee Paid by Buyer'), 'BUYER_SHIPPING_CREDIT');
  assert.equal(categoriseFee('Commission Fee'), 'COMMISSION');
  assert.equal(categoriseFee('Payment Fee'), 'PAYMENT_FEE');
  assert.equal(categoriseFee('Shipping Fee'), 'SHIPPING_FEE');
  assert.equal(categoriseFee('Free Shipping Max Fee'), 'FREE_SHIPPING_MAX_FEE');
  assert.equal(categoriseFee('Handling Fee'), 'HANDLING_FEE');
  assert.equal(categoriseFee('Daraz Coins Discount Participation Fee'), 'COINS_PARTICIPATION');
  assert.equal(categoriseFee('Co-funded Voucher Max'), 'VOUCHER_PARTICIPATION');
  assert.equal(categoriseFee('Shipping Fee Discount'), 'SHIPPING_DISCOUNT');
  assert.equal(categoriseFee('Income Tax Withholding'), 'INCOME_TAX_WHT');
  assert.equal(categoriseFee('Sales Tax Withholding'), 'SALES_TAX_WHT');
});

test('fees: two withholding taxes are distinct categories (not merged, not VAT)', () => {
  assert.notEqual(categoriseFee('Income Tax Withholding'), categoriseFee('Sales Tax Withholding'));
});

test('fees: refunds and reversals are their own categories, flagged, label kept', () => {
  const refund = toCategorisedFee('Product Price Refunded to Buyer', -300);
  assert.equal(refund.category, 'REFUND');
  assert.equal(refund.isRefund, true);
  assert.equal(refund.label, 'Product Price Refunded to Buyer'); // verbatim
  const rev = toCategorisedFee('Reversal of Income Tax Withholding', 5);
  assert.equal(rev.category, 'REVERSAL');
  assert.equal(rev.isReversal, true);
  // "Commission Fee Refunded" is a REFUND, not COMMISSION
  assert.equal(categoriseFee('Commission Fee Refunded'), 'REFUND');
});

test('fees: unrecognised label falls to OTHER (never silently dropped)', () => {
  assert.equal(categoriseFee('Some Brand New Daraz Fee 2027'), 'OTHER');
});

// ===========================================================================
// 3. Income line aggregation + exact reconciliation
// ===========================================================================

test('income line: aggregates fees and reconciles to 536 / 245.88 / 290.12', () => {
  const lines = buildIncomeLines(parseIncomeCsv(CSV));
  const oi1 = lines.find((l) => l.orderItemId === 'OI-1')!;
  assert.equal(oi1.totalCredits, 536);
  assert.equal(oi1.totalDeductions, -245.88);
  assert.equal(oi1.netAmount, 290.12);
  assert.equal(oi1.productPriceRevenue, 396);
  assert.equal(oi1.buyerShippingCredit, 140);
});

test('income line: return line with refund+reversal nets correctly', () => {
  const lines = buildIncomeLines(parseIncomeCsv(CSV));
  const oi2 = lines.find((l) => l.orderItemId === 'OI-2')!;
  // credits 300 + 5 = 305 ; deductions -30 + -300 = -330 ; net -25
  assert.equal(oi2.totalCredits, 305);
  assert.equal(oi2.totalDeductions, -330);
  assert.equal(oi2.netAmount, -25);
  const cats = sumByCategory(oi2.fees);
  assert.equal(cats.COMMISSION, -30);
  assert.equal(cats.REFUND, -300);
  assert.equal(cats.REVERSAL, 5);
});

// ===========================================================================
// 4. Join, SKU mapping, duplicates, reconciliation totals
// ===========================================================================

function dryRun(opts: Partial<Parameters<typeof computeDryRun>[0]> = {}) {
  const incomeLines = buildIncomeLines(parseIncomeCsv(CSV));
  const orders = normaliseOrderRows(ORDER_ROWS);
  return computeDryRun({
    incomeLines,
    orders,
    skuMappings: MAPPINGS,
    products: PRODUCTS,
    alreadyImported: new Set(),
    batchAlreadyImported: false,
    ...opts,
  });
}

test('join: matched lines by orderItemId', () => {
  const r = dryRun();
  assert.equal(r.totals.incomeLines, 2);
  assert.equal(r.totals.matched, 2);
  assert.equal(r.totals.unmatched, 0);
});

test('join: an income line with no order is unmatched', () => {
  const orders = normaliseOrderRows([ORDER_ROWS[0]]); // only OI-1
  const r = dryRun({ orders });
  assert.equal(r.totals.matched, 1);
  assert.equal(r.totals.unmatched, 1);
  assert.equal(r.lines.find((l) => l.orderItemId === 'OI-2')!.matched, false);
});

test('sku mapping: resolved when mapping exists, blocked when missing (never guessed)', () => {
  const r = dryRun({ skuMappings: [{ sellerSku: 'SKU-A', productId: 'p-a' }] }); // SKU-B unmapped
  const a = r.lines.find((l) => l.orderItemId === 'OI-1')!;
  const b = r.lines.find((l) => l.orderItemId === 'OI-2')!;
  assert.equal(a.skuResolved, true);
  assert.equal(a.resolvedProductId, 'p-a');
  assert.equal(a.blocked, false);
  assert.equal(b.skuResolved, false);
  assert.equal(b.resolvedProductId, null);
  assert.equal(b.blocked, true);
  assert.equal(r.totals.unresolvedSkus, 1);
  assert.deepEqual(
    r.unresolvedSkuList.map((u) => u.sellerSku),
    ['SKU-B']
  );
});

test('duplicates: already-imported (orderItemId, statementNumber) flagged, excluded from importable', () => {
  const r = dryRun({ alreadyImported: new Set([dupKey('OI-1', 'ST-1')]) });
  assert.equal(r.totals.duplicates, 1);
  assert.equal(r.lines.find((l) => l.orderItemId === 'OI-1')!.isDuplicate, true);
  // OI-1 delivered+resolved but duplicate → not importable; OI-2 returned+resolved
  assert.equal(r.totals.importable, 1);
});

test('reconciliation: every line reconciles and totals match Daraz net exactly', () => {
  const r = dryRun();
  assert.ok(r.lines.every((l) => l.reconciles));
  assert.equal(r.totals.reconDiff, 0);
  // calculated net == daraz net == 290.12 + (-25)
  assert.equal(r.totals.calculatedNet, 265.12);
  assert.equal(r.totals.darazNet, 265.12);
});

test('reconciliation: per-category totals stay separate across the batch', () => {
  const r = dryRun();
  const c = r.totals.feesByCategory;
  assert.equal(c.PRODUCT_REVENUE, 696); // 396 + 300
  assert.equal(c.BUYER_SHIPPING_CREDIT, 140);
  assert.equal(c.COMMISSION, -30);
  assert.equal(c.REFUND, -300);
  assert.equal(c.REVERSAL, 5);
  assert.equal(c.INCOME_TAX_WHT, -4);
  assert.equal(c.SALES_TAX_WHT, -7);
});

// ===========================================================================
// 5. Stock impact + negative-stock blocker + COGS
// ===========================================================================

test('stock: delivered resolved unit deducts stock; returned unit does not', () => {
  const r = dryRun();
  const impacts = asImpacts(r.stockImpact);
  const a = impacts.find((s) => s.productId === 'p-a')!;
  assert.equal(a.unitsOut, 1); // OI-1 delivered
  assert.equal(a.projectedStock, 4); // 5 - 1
  assert.equal(a.negativeBlocker, false);
  // p-b (OI-2) is Returned → not deducted → no stock impact row
  assert.equal(impacts.find((s) => s.productId === 'p-b'), undefined);
});

test('stock: delivered unit against zero stock is a negative-stock blocker', () => {
  const orders = normaliseOrderRows([{ ...ORDER_ROWS[1], status: 'delivered' }]); // OI-2 delivered
  const incomeLines = buildIncomeLines(
    parseIncomeCsv(
      [
        'banner',
        '""',
        HDR,
        feeRow('OI-2', 'SKU-B', 'Product Price Paid by Buyer', 300, 'Delivered', 'ORD-2'),
      ].join('\n')
    )
  );
  const r = computeDryRun({
    incomeLines,
    orders,
    skuMappings: MAPPINGS,
    products: PRODUCTS,
    alreadyImported: new Set(),
    batchAlreadyImported: false,
  });
  const blk = asImpacts(r.negativeStockBlockers).find((s) => s.productId === 'p-b')!;
  assert.ok(blk);
  assert.equal(blk.currentStock, 0);
  assert.equal(blk.unitsOut, 1);
  assert.equal(blk.projectedStock, -1);
});

test('COGS: projected from delivered units × product purchase cost', () => {
  const r = dryRun();
  assert.equal(asNum(r.totals.projectedCOGS), 100); // 1 delivered unit of p-a @ 100
  assert.equal(asNum(r.totals.projectedGrossProfit), 596); // productRevenue 696 - COGS 100
});

// ===========================================================================
// 6. Idempotency fingerprint
// ===========================================================================

test('idempotency: batch fingerprint is stable and order-independent', () => {
  const a = sha256Hex('orders-bytes');
  const b = sha256Hex('income-bytes');
  const f1 = batchFingerprint(a, b);
  const f2 = batchFingerprint(b, a);
  assert.equal(f1, f2); // order-independent
  assert.equal(f1, batchFingerprint(a, b)); // stable
  assert.notEqual(f1, batchFingerprint(a, sha256Hex('different-income')));
});

test('idempotency: same file pair flagged as already-imported', () => {
  const r = dryRun({ batchAlreadyImported: true });
  assert.equal(r.batchAlreadyImported, true);
});

// ===========================================================================
// 7. Customer masking
// ===========================================================================

test('masking: phone and national id are masked to last 3 by default', () => {
  assert.equal(maskPhone('03001234852'), '••••••••852');
  assert.equal(maskNationalId('3520212345671'), '••••••••••671');
  assert.equal(maskPhone(''), '');
  assert.equal(maskPhone(null), '');
});

test('masking: email keeps first char + domain', () => {
  assert.equal(maskEmail('ahmed@example.com'), 'a••••@example.com');
});

test('masking: maskCustomer never exposes full phone/national id', () => {
  const m = maskCustomer({
    name: 'Synthetic Buyer',
    email: 'buyer@example.com',
    phone: '03001234852',
    nationalRegistrationNumber: '3520212345671',
  });
  assert.equal(m.name, 'Synthetic Buyer'); // name shown to owner/admin
  assert.ok(!m.phoneMasked.includes('0300'));
  assert.ok(m.phoneMasked.endsWith('852'));
  assert.ok(!m.nationalIdMasked.includes('35202'));
});

// ===========================================================================
// 8. Unresolved SKU is an import blocker — NOT a zero-impact success
// ===========================================================================

test('unresolved SKU: stock/COGS/profit are unavailable, not zero, while any SKU is unmapped', () => {
  const r = dryRun({ skuMappings: [] }); // nothing mapped
  assert.equal(r.mappingComplete, false);
  assert.equal(r.stockProjectionAvailable, false);
  // Must NOT report "0 blockers" — the projection cannot be computed at all.
  assert.equal(r.stockImpact, 'Cannot calculate until product mapping is completed');
  assert.equal(r.negativeStockBlockers, 'Cannot calculate until product mapping is completed');
  assert.equal(r.totals.projectedCOGS, 'Cannot calculate until product mapping is completed');
  assert.equal(r.totals.projectedGrossProfit, 'Cannot calculate until product mapping is completed');
  // Every affected line stays blocked; nothing is importable.
  assert.equal(r.totals.importable, 0);
  assert.equal(r.totals.unresolvedSkus, 2);
  assert.ok(r.lines.every((l) => l.blocked));
  assert.equal(r.totals.blocked, r.lines.length);
});

test('unresolved SKU: a partial mapping still blocks projections (all-or-nothing)', () => {
  const r = dryRun({ skuMappings: [{ sellerSku: 'SKU-A', productId: 'p-a' }] }); // SKU-B unmapped
  assert.equal(r.mappingComplete, false);
  assert.equal(r.stockProjectionAvailable, false);
  assert.equal(typeof r.totals.projectedCOGS, 'string');
  // Financial reconciliation is still fully available even while blocked.
  assert.equal(r.totals.reconDiff, 0);
});

// ===========================================================================
// 9. Full financial reconciliation — no unexplained balance
// ===========================================================================

test('reconciliation: Σ(all category nets) === totalCredits + totalDeductions === Daraz net', () => {
  const r = dryRun();
  const t = r.totals;
  const categorySum = ALL_FEE_CATEGORIES.reduce((s, c) => s + t.feesByCategory[c], 0);
  const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  assert.equal(round2(categorySum), t.darazNet);
  assert.equal(round2(t.totalCredits + t.totalDeductions), t.darazNet);
  assert.equal(t.categorySumCheck, 0); // no unexplained balance
});

test('reconciliation: gross credit/deduction split reconciles to credits/deductions and to net', () => {
  const r = dryRun();
  const t = r.totals;
  const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  const sumCredit = round2(ALL_FEE_CATEGORIES.reduce((s, c) => s + t.feeCreditByCategory[c], 0));
  const sumDeduct = round2(ALL_FEE_CATEGORIES.reduce((s, c) => s + t.feeDeductionByCategory[c], 0));
  assert.equal(sumCredit, t.totalCredits);
  assert.equal(sumDeduct, t.totalDeductions);
  // Per-category: credit + deduction === net, for every category.
  for (const c of ALL_FEE_CATEGORIES) {
    assert.equal(round2(t.feeCreditByCategory[c] + t.feeDeductionByCategory[c]), t.feesByCategory[c]);
  }
});

// ===========================================================================
// 10. Approved refund rule — Daraz income authoritative, no double-count
// ===========================================================================

test('refund rule: a return linked to imported Daraz income does NOT reduce P&L again', () => {
  const base = { refundStatus: 'COMPLETED', chargedTo: 'SELLER', deletedAt: null } as const;
  // Eligible on its own, but the income statement already booked the refund.
  assert.equal(isEligibleForPnl(base), true);
  assert.equal(refundCountsInPnl({ ...base, linkedToImportedIncome: true }), false);
  assert.equal(sellerLossForPnl({ ...base, linkedToImportedIncome: true, refundAmount: 300 }), 0);
});

test('refund rule: an unlinked/manual return keeps existing eligibility behaviour', () => {
  const base = { refundStatus: 'COMPLETED', chargedTo: 'SELLER', deletedAt: null } as const;
  assert.equal(refundCountsInPnl({ ...base, linkedToImportedIncome: false }), true);
  assert.equal(sellerLossForPnl({ ...base, linkedToImportedIncome: false, refundAmount: 300 }), 300);
  // Platform-absorbed refund is not a seller loss regardless of linkage.
  const platform = { refundStatus: 'COMPLETED', chargedTo: 'PLATFORM', deletedAt: null } as const;
  assert.equal(refundCountsInPnl({ ...platform, linkedToImportedIncome: false }), false);
  assert.equal(sellerLossForPnl({ ...platform, linkedToImportedIncome: false, refundAmount: 300 }), 0);
});

// ===========================================================================
// 11. PII encryption — AES-256-GCM + blind index
// ===========================================================================

test('crypto: encrypt→decrypt round-trips and ciphertext is never plaintext', () => {
  const plain = 'Synthetic Buyer, House 1, Lahore';
  const enc = encryptPii(plain);
  assert.ok(enc && enc.startsWith('v1:'));
  assert.ok(!enc.includes(plain)); // stored value is not readable plaintext
  assert.equal(decryptPii(enc), plain);
  assert.equal(encryptPii(null), null);
  assert.equal(encryptPii(''), null);
  assert.equal(decryptPii(null), null);
});

test('crypto: same plaintext encrypts differently each time but decrypts equal (random IV)', () => {
  const p = '03001234852';
  const a = encryptPii(p)!;
  const b = encryptPii(p)!;
  assert.notEqual(a, b);
  assert.equal(decryptPii(a), decryptPii(b));
});

test('crypto: tampering with ciphertext is detected (GCM auth) and throws', () => {
  const enc = encryptPii('3520212345671')!;
  const parts = enc.split(':');
  // Flip a byte in the ciphertext segment.
  const ct = Buffer.from(parts[3], 'base64');
  ct[0] ^= 0xff;
  const tampered = [parts[0], parts[1], parts[2], ct.toString('base64')].join(':');
  assert.throws(() => decryptPii(tampered));
  assert.throws(() => decryptPii('v1:not:valid'));
});

test('crypto: blind index is deterministic, normalised, one-way and non-plaintext', () => {
  const h1 = blindIndex('0300 123 4852')!;
  const h2 = blindIndex('03001234852')!; // whitespace-insensitive
  assert.equal(h1, h2);
  assert.match(h1, /^[0-9a-f]{64}$/); // HMAC-SHA256 hex
  assert.ok(!h1.includes('03001234852')); // reveals no plaintext
  assert.notEqual(blindIndex('03001234852'), blindIndex('03009999999'));
  assert.equal(blindIndex(null), null);
});

// ===========================================================================
// 12. Composite statement identity — one Order Item ID in two statements
// ===========================================================================

// A single fee row with an explicit statement number.
function stmtRow(stmt: string, fee: string, amt: number, oiid = 'OI-9', sku = 'SKU-A') {
  return `01 Jul 2026 - 07 Jul 2026;${stmt};05 Jul 2026;${fee};${amt};0;Ready to Release;;01 Jul 2026;ORD-9;${oiid};${sku};LZ;0;NO;Returned;Prod ${sku};SC`;
}
const TWO_STMT_CSV = [
  'banner',
  '""',
  HDR,
  stmtRow('026', 'Product Price Paid by Buyer', 100),
  stmtRow('027', 'Product Price Refunded to Buyer', -100),
].join('\n');

test('composite identity: one Order Item ID across two statements yields two distinct lines', () => {
  const lines = buildIncomeLines(parseIncomeCsv(TWO_STMT_CSV));
  assert.equal(lines.length, 2); // two statement-specific lines, NOT merged
  assert.deepEqual(lines.map((l) => l.statementNumber).sort(), ['026', '027']);
  assert.ok(lines.every((l) => l.orderItemId === 'OI-9'));

  const orders = normaliseOrderRows([
    { orderItemId: 'OI-9', orderNumber: 'ORD-9', sellerSku: 'SKU-A', status: 'returned' },
  ]);
  const r = computeDryRun({
    incomeLines: lines,
    orders,
    skuMappings: [],
    products: [],
    alreadyImported: new Set(),
    batchAlreadyImported: false,
  });
  assert.equal(r.totals.incomeLines, 2); // statement-specific combinations
  assert.equal(r.totals.distinctOrderItemIds, 1); // one physical order item
  assert.equal(r.totals.statementCount, 2);
  assert.equal(r.totals.matched, 1); // matched at the order-item level
  assert.equal(r.totals.unmatched, 0);
  assert.equal(r.totals.darazNet, 0); // 100 + (-100)
});

test('composite identity: duplicate detection is per (orderItemId, statementNumber)', () => {
  const lines = buildIncomeLines(parseIncomeCsv(TWO_STMT_CSV));
  const orders = normaliseOrderRows([
    { orderItemId: 'OI-9', orderNumber: 'ORD-9', sellerSku: 'SKU-A', status: 'returned' },
  ]);
  const r = computeDryRun({
    incomeLines: lines,
    orders,
    skuMappings: [],
    products: [],
    alreadyImported: new Set([dupKey('OI-9', '026')]), // only the 026 line seen before
    batchAlreadyImported: false,
  });
  assert.equal(r.totals.duplicates, 1);
  assert.equal(r.lines.find((l) => l.statementNumber === '026')!.isDuplicate, true);
  assert.equal(r.lines.find((l) => l.statementNumber === '027')!.isDuplicate, false);
});

test('statements: summariseStatements rolls up every fee category per statement', () => {
  const lines = buildIncomeLines(parseIncomeCsv(CSV)); // OI-1 + OI-2, both statement ST-1
  const s = summariseStatements(
    lines.map((l) => ({
      statementNumber: l.statementNumber,
      statementPeriod: l.statementPeriod,
      releaseStatus: l.releaseStatus,
      transactionDate: l.transactionDates[0] ?? null,
      orderItemId: l.orderItemId,
      productPriceRevenue: l.productPriceRevenue,
      buyerShippingCredit: l.buyerShippingCredit,
      totalCredits: l.totalCredits,
      totalDeductions: l.totalDeductions,
      netAmount: l.netAmount,
      fees: l.fees.map((f) => ({ category: f.category, amount: f.amount })),
    }))
  );
  assert.equal(s.length, 1); // both order items settled in ST-1
  assert.equal(s[0].orderItemCount, 2);
  assert.equal(s[0].lineCount, 2);
  assert.equal(s[0].netPayout, 265.12);
  assert.equal(s[0].commission, -30);
  assert.equal(s[0].refunds, -300);
  assert.equal(s[0].reversals, 5);
});
