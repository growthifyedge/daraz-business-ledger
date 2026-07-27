// Regression tests for the reprocess PERSISTENCE bug.
//
// Live bug: the GrowthifyEdge full Income CSV imported with every fee amount = 0
// (the fee-amount column was not recognised), so all 11 statement lines persisted
// net 0. A later "Reprocess" reported success (128 lines / 118 order updates) yet
// Daraz Payouts still showed Rs 0.00 — the update payload had drifted from the
// insert payload and/or no post-write reconciliation caught the zero.
//
// Two independent defences are tested here, both PURE (no DB):
//   1. Parser: the fee-amount column is resolved across every export variant, and
//      a header with NO amount column fails LOUDLY (IncomeParseError) instead of
//      silently writing zeros.
//   2. Write payload: incomeLineWriteData / incomeFeeCreateRows — the SINGLE
//      source of truth an insert AND an in-place update both write — carry the
//      real non-zero netAmount and fee amounts. This asserts the actual persisted
//      payload, not only the dry-run totals (the gap that hid the bug).

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseIncomeCsv,
  buildIncomeLines,
  resolveAmountColumn,
  IncomeParseError,
} from '../lib/daraz/parse';
import {
  incomeLineWriteData,
  incomeFeeCreateRows,
  sumNet,
  parseIncomeBannerTotal,
  reconciles,
} from '../lib/daraz/reconcile';

const BANNER = 'Statement of Account. the total to release amount is PKR 51,177.65';

// Column layouts for the three known official export variants.
const HDR_EST =
  'Statement Period;Statement Number;Transaction Date;Fee Name;Est Release Amount(Include Tax);VAT Amount;Release Status;Comment;Order Creation Date;Order Number;Order Line ID;Seller SKU;Lazada SKU;WHT Amount;WHT included in Amount;Order Status;Product Name;Short Code';
const HDR_AMT_TAX =
  'Statement Period;Statement Number;Transaction Date;Fee Name;Amount(Include Tax);VAT Amount;Release Status;Release Date;Comment;Order Creation Date;Order Number;Order Line ID;Seller SKU;Lazada SKU;WHT Amount;WHT included in Amount;Order Status;Product Name;Short Code';
const HDR_AMT =
  'Statement Period;Statement Number;Transaction Date;Fee Name;Amount;VAT Amount;Release Status;Release Date;Comment;Order Creation Date;Order Number;Order Line ID;Seller SKU;Lazada SKU;WHT Amount;WHT included in Amount;Order Status;Product Name;Short Code';
// A header with NO fee-amount column at all — must be refused, never zeroed.
const HDR_NO_AMOUNT =
  'Statement Period;Statement Number;Transaction Date;Fee Name;VAT Amount;Release Status;Order Creation Date;Order Number;Order Line ID;Seller SKU;Order Status;Product Name';

function feeRow(hdr: string, stmt: string, oiid: string, fee: string, amt: number, vat: number, status: string) {
  // Build a row positionally aligned to whichever header is used, so field
  // resolution is exercised by NAME (not fixed position).
  const cols = hdr.split(';');
  const map: Record<string, string> = {
    'Statement Period': '01 Jul 2026 - 07 Jul 2026',
    'Statement Number': stmt,
    'Transaction Date': '05 Jul 2026',
    'Fee Name': fee,
    'Est Release Amount(Include Tax)': String(amt),
    'Amount(Include Tax)': String(amt),
    Amount: String(amt),
    'VAT Amount': String(vat),
    'Release Status': status,
    'Release Date': '10 Jul 2026',
    Comment: '',
    'Order Creation Date': '01 Jul 2026',
    'Order Number': `ORD-${oiid}`,
    'Order Line ID': oiid,
    'Seller SKU': `SKU-${oiid}`,
    'Lazada SKU': 'LZ',
    'WHT Amount': '0',
    'WHT included in Amount': 'NO',
    'Order Status': 'Delivered',
    'Product Name': 'Prod',
    'Short Code': 'SC',
  };
  return cols.map((c) => map[c] ?? '').join(';');
}

// ---------------------------------------------------------------------------
// 1. Amount-column resolution + fail-loud guard
// ---------------------------------------------------------------------------

test('resolveAmountColumn: finds each known alias by name', () => {
  const norm = (h: string) => h.split(';').map((s) => s.replace(/\s+/g, '').toLowerCase());
  assert.equal(resolveAmountColumn(norm(HDR_EST)), 4);
  assert.equal(resolveAmountColumn(norm(HDR_AMT_TAX)), 4);
  assert.equal(resolveAmountColumn(norm(HDR_AMT)), 4);
});

test('resolveAmountColumn: never mistakes VAT/WHT for the fee amount', () => {
  const norm = (h: string) => h.split(';').map((s) => s.replace(/\s+/g, '').toLowerCase());
  // Only VAT Amount + WHT Amount present, no real amount column ⇒ -1.
  assert.equal(resolveAmountColumn(norm(HDR_NO_AMOUNT)), -1);
});

test('parser: a header with no fee-amount column fails LOUDLY (never zeros)', () => {
  const csv = [BANNER, '""', HDR_NO_AMOUNT, `01 Jul;ST-1;05 Jul;Product Price Paid by Buyer;0;Released;01 Jul;ORD-1;OI-1;SKU;Delivered;Prod`].join('\n');
  assert.throws(() => parseIncomeCsv(csv), IncomeParseError);
});

test('parser: all three amount-column variants parse the SAME non-zero net', () => {
  for (const hdr of [HDR_EST, HDR_AMT_TAX, HDR_AMT]) {
    const csv = [
      BANNER,
      '""',
      hdr,
      feeRow(hdr, 'ST-1', 'OI-1', 'Product Price Paid by Buyer', 396, 0, 'Released'),
      feeRow(hdr, 'ST-1', 'OI-1', 'Commission Fee', -30, 0, 'Released'),
      feeRow(hdr, 'ST-1', 'OI-1', 'Payment Fee', -10.25, 0, 'Released'),
    ].join('\n');
    const lines = buildIncomeLines(parseIncomeCsv(csv));
    assert.equal(lines.length, 1, `variant ${hdr.slice(0, 40)}`);
    assert.equal(lines[0].netAmount, 355.75); // 396 - 30 - 10.25, never 0
  }
});

// ---------------------------------------------------------------------------
// 2. The exact write payload an insert AND an in-place update both persist
// ---------------------------------------------------------------------------

test('incomeLineWriteData: carries the real non-zero net (not a stale zero)', () => {
  const csv = [
    BANNER,
    '""',
    HDR_AMT_TAX,
    feeRow(HDR_AMT_TAX, 'ST-1', 'OI-1', 'Product Price Paid by Buyer', 500, 0, 'Released'),
    feeRow(HDR_AMT_TAX, 'ST-1', 'OI-1', 'Commission Fee', -75.5, 0, 'Released'),
  ].join('\n');
  const [line] = buildIncomeLines(parseIncomeCsv(csv));

  const data = incomeLineWriteData(line);
  assert.equal(data.netAmount, 424.5); // 500 - 75.5
  assert.notEqual(data.netAmount, 0);
  assert.equal(data.totalCredits, 500);
  assert.equal(data.totalDeductions, -75.5);
  assert.equal(data.releaseStatus, 'Released');
  // netAmount == credits + deductions ⇒ the line reconciles.
  assert.equal(data.reconciled, true);
});

test('incomeFeeCreateRows: preserves every fee with its real amount', () => {
  const csv = [
    BANNER,
    '""',
    HDR_AMT_TAX,
    feeRow(HDR_AMT_TAX, 'ST-1', 'OI-1', 'Product Price Paid by Buyer', 500, 12, 'Released'),
    feeRow(HDR_AMT_TAX, 'ST-1', 'OI-1', 'Commission Fee', -75.5, 0, 'Released'),
  ].join('\n');
  const [line] = buildIncomeLines(parseIncomeCsv(csv));

  const rows = incomeFeeCreateRows('LINE-ID', line);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.incomeLineId === 'LINE-ID'));
  const amounts = rows.map((r) => r.amount).sort((a, b) => a - b);
  assert.deepEqual(amounts, [-75.5, 500]);
  // No fee amount is silently zeroed.
  assert.ok(rows.every((r) => r.amount !== 0));
});

test('sumNet: authoritative total across the reprocessed lines', () => {
  const relRows = [5000, 5000, 5000, 5000, 5000, 5000, 5000, 4176.56].flatMap((amt, i) => [
    feeRow(HDR_AMT_TAX, `REL-${i}`, `R-${i}`, 'Product Price Paid by Buyer', amt, 0, 'Released'),
  ]);
  const readyRows = [4000, 4000, 4001.09].flatMap((amt, i) => [
    feeRow(HDR_AMT_TAX, `RDY-${i}`, `Y-${i}`, 'Product Price Paid by Buyer', amt, 0, 'Ready to Release'),
  ]);
  const csv = [BANNER, '""', HDR_AMT_TAX, ...relRows, ...readyRows].join('\n');
  const lines = buildIncomeLines(parseIncomeCsv(csv));

  // The exact per-line payloads that would be persisted must sum to the official
  // grand total — mirroring the reprocess post-write reconciliation.
  const persistedNets = lines.map((l) => incomeLineWriteData(l).netAmount);
  assert.equal(sumNet(lines.map((l) => ({ netAmount: incomeLineWriteData(l).netAmount }))), 51177.65);
  assert.equal(sumNet(persistedNets.map((netAmount) => ({ netAmount }))), 51177.65);
});

// ---------------------------------------------------------------------------
// 3. Parse-independent banner guard + rounding-safe reconciliation
// ---------------------------------------------------------------------------

test('parseIncomeBannerTotal: reads the "PKR …" grand total from the banner', () => {
  assert.equal(parseIncomeBannerTotal(BANNER), 51177.65);
  assert.equal(parseIncomeBannerTotal('no total here'), null);
});

test('reconciles: agrees within half a cent, rejects a real gap', () => {
  assert.equal(reconciles(51177.65, 51177.653), true); // rounding noise
  assert.equal(reconciles(51177.65, 0), false); // the zero-persist bug
  assert.equal(reconciles(100, 100.01), false);
});
