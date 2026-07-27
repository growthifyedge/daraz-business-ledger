// Regression tests for reprocessing an already-imported batch in place.
//
// Scenario: the GrowthifyEdge Income CSV was first imported when the fee-amount
// column ("Amount(Include Tax)") parsed as zero, so all 11 statement lines were
// written with net 0. The file is unchanged, so a normal commit is a no-op — the
// Reprocess path must instead UPDATE those existing lines in place (never insert
// duplicates) so the corrected figures land:
//   Released:  Rs 39,176.56 (8 statements)
//   Ready to Release: Rs 12,001.09 (3 statements)
//   Total: Rs 51,177.65
//
// Pure tests (no DB): they exercise the parser + planIncomeLineWrites (the exact
// insert/update split the reprocess transaction uses) + classifyImportAction (the
// button-enable rule) + the pure cash-flow summers.

import test from 'node:test';
import assert from 'node:assert/strict';

import { parseIncomeCsv, buildIncomeLines } from '../lib/daraz/parse';
import { planIncomeLineWrites, dupKey, classifyImportAction } from '../lib/daraz/dryrun';
import { sumReleasedNet, sumReadyToReleaseNet } from '../lib/cashflow';

// Full/latest official Income header: fee amount is "Amount(Include Tax)" and a
// "Release Date" column is present.
const HDR =
  'Statement Period;Statement Number;Transaction Date;Fee Name;Amount(Include Tax);VAT Amount;Release Status;Release Date;Comment;Order Creation Date;Order Number;Order Line ID;Seller SKU;Lazada SKU;WHT Amount;WHT included in Amount;Order Status;Product Name;Short Code';

function row(stmt: string, oiid: string, amt: number, status: string) {
  return `01 Jul 2026 - 07 Jul 2026;${stmt};05 Jul 2026;Product Price Paid by Buyer;${amt};0;${status};10 Jul 2026;;01 Jul 2026;ORD-${oiid};${oiid};SKU-${oiid};LZ;0;NO;Delivered;Prod;SC`;
}

// The official GE statement split: 8 Released + 3 Ready to Release.
const RELEASED_NETS = [5000, 5000, 5000, 5000, 5000, 5000, 5000, 4176.56]; // Σ 39,176.56
const READY_NETS = [4000, 4000, 4001.09]; // Σ 12,001.09

function officialCsv(): string {
  const rel = RELEASED_NETS.map((amt, i) => row(`REL-${i}`, `R-${i}`, amt, 'Released'));
  const ready = READY_NETS.map((amt, i) => row(`RDY-${i}`, `Y-${i}`, amt, 'Ready to Release'));
  return ['banner', '""', HDR, ...rel, ...ready].join('\n');
}

test('reprocess: every parsed line already exists ⇒ all updates, zero inserts (no duplicates)', () => {
  const lines = buildIncomeLines(parseIncomeCsv(officialCsv()));
  assert.equal(lines.length, 11);

  // Simulate the DB state from the original (zeroed) import: the SAME composite
  // keys are already present.
  const existingKeys = new Set(lines.map((l) => dupKey(l.orderItemId, l.statementNumber)));
  const { inserts, updates } = planIncomeLineWrites(existingKeys, lines);

  assert.equal(inserts.length, 0); // nothing new — reprocess never inserts
  assert.equal(updates.length, 11); // all 11 statement lines update in place
});

test('reprocess: updated-in-place lines yield the official corrected totals', () => {
  const lines = buildIncomeLines(parseIncomeCsv(officialCsv()));
  const existingKeys = new Set(lines.map((l) => dupKey(l.orderItemId, l.statementNumber)));
  const { updates } = planIncomeLineWrites(existingKeys, lines);

  const released = sumReleasedNet(updates);
  const ready = sumReadyToReleaseNet(updates);
  assert.equal(released, 39176.56);
  assert.equal(ready, 12001.09);
  assert.equal(Math.round((released + ready) * 100) / 100, 51177.65);

  // Release statuses are preserved exactly through the update set.
  assert.equal(updates.filter((l) => l.releaseStatus === 'Released').length, 8);
  assert.equal(updates.filter((l) => l.releaseStatus === 'Ready to Release').length, 3);
});

test('reprocess: no statement key appears twice across insert+update (duplicate-proof)', () => {
  const lines = buildIncomeLines(parseIncomeCsv(officialCsv()));
  const existingKeys = new Set(lines.map((l) => dupKey(l.orderItemId, l.statementNumber)));
  const { inserts, updates } = planIncomeLineWrites(existingKeys, lines);
  const all = [...inserts, ...updates].map((l) => dupKey(l.orderItemId, l.statementNumber));
  assert.equal(new Set(all).size, all.length); // every key is unique
  assert.equal(all.length, 11);
});

// ---------------------------------------------------------------------------
// Button-enable rule (classifyImportAction) — the shared UI/backend predicate.
// ---------------------------------------------------------------------------

test('action: already-committed pair with only updates ⇒ reprocess', () => {
  assert.equal(
    classifyImportAction({
      alreadyCommitted: true,
      orderLinesNew: 0,
      incomeLinesNew: 0,
      orderLinesUpdated: 118,
      incomeLinesUpdated: 128,
    }),
    'reprocess'
  );
});

test('action: statement-line updates alone still enable reprocess', () => {
  assert.equal(
    classifyImportAction({
      alreadyCommitted: true,
      orderLinesNew: 0,
      incomeLinesNew: 0,
      orderLinesUpdated: 0,
      incomeLinesUpdated: 128,
    }),
    'reprocess'
  );
});

test('action: identical already-committed file with no changes ⇒ noop (never reprocess)', () => {
  assert.equal(
    classifyImportAction({
      alreadyCommitted: true,
      orderLinesNew: 0,
      incomeLinesNew: 0,
      orderLinesUpdated: 0,
      incomeLinesUpdated: 0,
    }),
    'noop'
  );
});

test('action: a never-imported pair is a normal import, not a reprocess', () => {
  assert.equal(
    classifyImportAction({
      alreadyCommitted: false,
      orderLinesNew: 200,
      incomeLinesNew: 128,
      orderLinesUpdated: 0,
      incomeLinesUpdated: 0,
    }),
    'import'
  );
});

test('action: anything genuinely new blocks reprocess (that is an import)', () => {
  assert.equal(
    classifyImportAction({
      alreadyCommitted: true,
      orderLinesNew: 5, // new order lines present
      incomeLinesNew: 0,
      orderLinesUpdated: 10,
      incomeLinesUpdated: 20,
    }),
    'noop'
  );
});
