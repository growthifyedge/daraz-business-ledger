// Regression tests for the Income CSV header alias fix.
//
// Live bug: after importing the full/latest official GrowthifyEdge Income CSV,
// Cash Flow showed Daraz Released Rs 0.00 and Expected (Ready to Release) Rs 0.00.
// Root cause: the parser matched the fee-amount column by the exact header
// "Est Release Amount(Include Tax)" (the "To Release" export). The full Income
// export names the SAME figure "Amount(Include Tax)", so the column was not
// found → every fee amount parsed as 0 → all statement nets became 0.
//
// These tests are pure (no DB): they exercise lib/daraz/parse.ts and the pure
// cash-flow summers in lib/cashflow.ts against BOTH official header variants and
// reproduce the official statement totals.

import test from 'node:test';
import assert from 'node:assert/strict';

import { parseIncomeCsv, buildIncomeLines } from '../lib/daraz/parse';
import { sumReleasedNet, sumReadyToReleaseNet } from '../lib/cashflow';

// Header used by the older "To Release" export.
const HDR_EST =
  'Statement Period;Statement Number;Transaction Date;Fee Name;Est Release Amount(Include Tax);VAT Amount;Release Status;Comment;Order Creation Date;Order Number;Order Line ID;Seller SKU;Lazada SKU;WHT Amount;WHT included in Amount;Order Status;Product Name;Short Code';
// Header used by the full/latest official Income export: the fee-amount column is
// "Amount(Include Tax)" and a new "Release Date" column appears. Same 1st columns.
const HDR_AMT =
  'Statement Period;Statement Number;Transaction Date;Fee Name;Amount(Include Tax);VAT Amount;Release Status;Release Date;Comment;Order Creation Date;Order Number;Order Line ID;Seller SKU;Lazada SKU;WHT Amount;WHT included in Amount;Order Status;Product Name;Short Code';

// A fee row for the OLD header layout (18 columns, no Release Date).
function rowEst(stmt: string, oiid: string, fee: string, amt: number, status: string) {
  return `01 Jul 2026 - 07 Jul 2026;${stmt};05 Jul 2026;${fee};${amt};0;${status};;01 Jul 2026;ORD-${oiid};${oiid};SKU-${oiid};LZ;0;NO;Delivered;Prod;SC`;
}
// A fee row for the NEW header layout (19 columns, includes Release Date).
function rowAmt(stmt: string, oiid: string, fee: string, amt: number, status: string, relDate = '10 Jul 2026') {
  return `01 Jul 2026 - 07 Jul 2026;${stmt};05 Jul 2026;${fee};${amt};0;${status};${relDate};;01 Jul 2026;ORD-${oiid};${oiid};SKU-${oiid};LZ;0;NO;Delivered;Prod;SC`;
}

test('alias: "Amount(Include Tax)" is read as the fee amount (not zeroed)', () => {
  const csv = ['banner', '""', HDR_AMT, rowAmt('ST-1', 'OI-1', 'Product Price Paid by Buyer', 396, 'Released')].join('\n');
  const rows = parseIncomeCsv(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount, 396); // previously parsed as 0
  assert.equal(rows[0].releaseStatus, 'Released'); // preserved exactly
});

test('alias: both official header variants parse identical amounts and nets', () => {
  const fees: Array<[string, number]> = [
    ['Product Price Paid by Buyer', 396],
    ['Payment Fee', -10.25],
    ['Commission Fee', -30],
  ];
  const est = ['banner', '""', HDR_EST, ...fees.map(([f, a]) => rowEst('ST-1', 'OI-1', f, a, 'Released'))].join('\n');
  const amt = ['banner', '""', HDR_AMT, ...fees.map(([f, a]) => rowAmt('ST-1', 'OI-1', f, a, 'Released'))].join('\n');

  const lEst = buildIncomeLines(parseIncomeCsv(est));
  const lAmt = buildIncomeLines(parseIncomeCsv(amt));
  assert.equal(lEst.length, 1);
  assert.equal(lAmt.length, 1);
  // Net = 396 - 10.25 - 30 = 355.75 under BOTH header layouts.
  assert.equal(lEst[0].netAmount, 355.75);
  assert.equal(lAmt[0].netAmount, 355.75);
  assert.equal(lEst[0].netAmount, lAmt[0].netAmount);
});

test('alias: Release Status is preserved exactly (Released vs Ready to Release)', () => {
  const csv = [
    'banner',
    '""',
    HDR_AMT,
    rowAmt('ST-1', 'OI-1', 'Product Price Paid by Buyer', 100, 'Released'),
    rowAmt('ST-2', 'OI-2', 'Product Price Paid by Buyer', 200, 'Ready to Release'),
    rowAmt('ST-3', 'OI-3', 'Product Price Paid by Buyer', 300, 'Pending'),
  ].join('\n');
  const lines = buildIncomeLines(parseIncomeCsv(csv));
  const byStmt = Object.fromEntries(lines.map((l) => [l.statementNumber, l.releaseStatus]));
  assert.equal(byStmt['ST-1'], 'Released');
  assert.equal(byStmt['ST-2'], 'Ready to Release');
  assert.equal(byStmt['ST-3'], 'Pending');
});

test('alias: the new "Release Date" column does not shift any parsed field', () => {
  const csv = ['banner', '""', HDR_AMT, rowAmt('ST-1', 'OI-7', 'Product Price Paid by Buyer', 250, 'Released', '12 Jul 2026')].join('\n');
  const rows = parseIncomeCsv(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].orderItemId, 'OI-7'); // Order Line ID resolved by name, not position
  assert.equal(rows[0].sellerSku, 'SKU-OI-7');
  assert.equal(rows[0].amount, 250);
  assert.equal(rows[0].orderStatus, 'Delivered');
  assert.equal(rows[0].productName, 'Prod');
});

// ---------------------------------------------------------------------------
// Reproduce the official GrowthifyEdge Income CSV totals:
//   Released:  8 statements = Rs 39,176.56
//   Ready to Release: 3 statements = Rs 12,001.09
//   Total: Rs 51,177.65
// ---------------------------------------------------------------------------

const RELEASED_NETS = [5000, 5000, 5000, 5000, 5000, 5000, 5000, 4176.56]; // 8 → 39176.56
const READY_NETS = [4000, 4000, 4001.09]; // 3 → 12001.09

test('official figures: Released 39,176.56 / Ready 12,001.09 / Total 51,177.65', () => {
  const relRows = RELEASED_NETS.map((amt, i) =>
    rowAmt(`REL-${i}`, `R-${i}`, 'Product Price Paid by Buyer', amt, 'Released')
  );
  const readyRows = READY_NETS.map((amt, i) =>
    rowAmt(`RDY-${i}`, `Y-${i}`, 'Product Price Paid by Buyer', amt, 'Ready to Release')
  );
  const csv = ['banner', '""', HDR_AMT, ...relRows, ...readyRows].join('\n');

  const lines = buildIncomeLines(parseIncomeCsv(csv));
  assert.equal(lines.length, 11); // 11 statements total

  const released = sumReleasedNet(lines);
  const ready = sumReadyToReleaseNet(lines);
  assert.equal(released, 39176.56);
  assert.equal(ready, 12001.09);
  assert.equal(Math.round((released + ready) * 100) / 100, 51177.65);

  // Cash-flow rule holds: only Released is actual cash; Ready is expected-only.
  assert.notEqual(released, 0);
  assert.notEqual(ready, 0);
});
