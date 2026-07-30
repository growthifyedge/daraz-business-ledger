// Presentation Safe View — Phase 3B tests (financial & Daraz reporting views).
//
// 1) redactExportRows: the data crossing into the client export components
//    (<ExportButtons>, PnlExport) carries no exact figure in either profile, and
//    is identity when inactive.
// 2) Source scans: every in-scope page resolves the presentation context and
//    routes money through the redaction core (never a bare formatMoney in an
//    active-reachable render), and masks statement numbers / order identifiers /
//    bank references. This proves the redaction is wired server-side without a
//    running DB.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { PresentationContext } from '../lib/presentation/core';
import { redactExportRows } from '../lib/presentation/viewmodels/exports';

const OPS: PresentationContext = { active: true, profile: 'OPERATIONS' };
const FIN: PresentationContext = { active: true, profile: 'FINANCE' };
const OFF: PresentationContext = { active: false, profile: null };

function src(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8');
}

// ---------------------------------------------------------------------------
// redactExportRows — the client export boundary
// ---------------------------------------------------------------------------

const COLUMNS = [
  { key: 'date', label: 'Date' },
  { key: 'product', label: 'Product' },
  { key: 'gross', label: 'Gross', money: true },
  { key: 'net', label: 'Net', money: true },
];
const ROWS = [{ date: '01 Jan', product: 'Widget', gross: 12_345, net: -6_789 }];
const EXACT = ['12345', '12,345', '6789', '6,789'];

test('redactExportRows: inactive is identity (same columns + rows)', () => {
  const out = redactExportRows(COLUMNS, ROWS, OFF);
  assert.equal(out.columns, COLUMNS);
  assert.equal(out.rows, ROWS);
});

test('redactExportRows: active clears money flags and redacts values (both profiles)', () => {
  for (const ctx of [OPS, FIN]) {
    const out = redactExportRows(COLUMNS, ROWS, ctx);
    // Money flags are cleared so the client never re-formats a figure.
    assert.ok(out.columns.every((c) => !c.money), 'no money flags remain');
    // Non-money fields preserved.
    assert.equal(out.rows[0].product, 'Widget');
    assert.equal(out.rows[0].date, '01 Jan');
    // No exact figure anywhere in the serialized export payload.
    const blob = JSON.stringify(out.rows);
    for (const s of EXACT) assert.ok(!blob.includes(s), `export leaked ${s}`);
  }
});

test('redactExportRows: Operations → status, Finance → band', () => {
  const ops = redactExportRows(COLUMNS, ROWS, OPS).rows[0];
  assert.equal(ops.gross, 'Positive');
  assert.equal(ops.net, 'Negative');
  const fin = redactExportRows(COLUMNS, ROWS, FIN).rows[0];
  assert.equal(fin.gross, 'Rs 10k–25k');
});

// ---------------------------------------------------------------------------
// Source scans — every in-scope page is wired to redact server-side
// ---------------------------------------------------------------------------

// Pages where EVERY money render was routed through the `money` closure, so a
// bare formatMoney( call must no longer appear.
const FULLY_REDACTED_PAGES = [
  'app/(dashboard)/dashboard/page.tsx',
  'app/(dashboard)/payouts/page.tsx',
  'app/(dashboard)/statements/page.tsx',
  'app/(dashboard)/statements/[statementNumber]/page.tsx',
  'app/(dashboard)/reports/sales/page.tsx',
  'app/(dashboard)/reports/profit/page.tsx',
  'app/(dashboard)/reports/purchases/page.tsx',
  'app/(dashboard)/reports/expenses/page.tsx',
  'app/(dashboard)/reports/inventory/page.tsx',
];

test('every in-scope page resolves the presentation context and redacts money', () => {
  const pages = [...FULLY_REDACTED_PAGES, 'app/(dashboard)/profit-loss/page.tsx'];
  for (const p of pages) {
    const s = src(p);
    assert.ok(s.includes('getPresentationContext'), `${p} resolves the context`);
    assert.ok(s.includes('redactMoney'), `${p} uses redactMoney`);
  }
});

test('fully-redacted pages contain no bare formatMoney( render', () => {
  for (const p of FULLY_REDACTED_PAGES) {
    assert.ok(!src(p).includes('formatMoney('), `${p} has no bare formatMoney(`);
  }
});

test('profit-loss keeps formatMoney only behind an active-mode guard', () => {
  const s = src('app/(dashboard)/profit-loss/page.tsx');
  // The only formatMoney left is the inactive branch of the redaction ternary.
  assert.ok(s.includes('ctx.active'), 'PnlLine branches on ctx.active');
  assert.ok(s.includes('redactMoney(deduction'), 'active branch redacts');
  // Export amounts are redacted before reaching the client PnlExport.
  assert.ok(s.includes('money={!presentation.active}'), 'export money flag gated');
  assert.ok(s.includes('exportRowsRaw.map'), 'export rows redacted when active');
});

test('statement numbers are masked and drill-downs suppressed when active', () => {
  const payouts = src('app/(dashboard)/payouts/page.tsx');
  assert.ok(payouts.includes('redactStatementNumber'), 'payouts masks statement number');
  assert.ok(payouts.includes('presentation.active ? ('), 'payouts hides the drill-down link');

  const statements = src('app/(dashboard)/statements/page.tsx');
  assert.ok(statements.includes('redactStatementNumber'), 'statements masks statement number');
  assert.ok(statements.includes('presentation.active ? ('), 'statements delinks when active');
});

test('statement detail masks statement number and every order identifier', () => {
  const s = src('app/(dashboard)/statements/[statementNumber]/page.tsx');
  assert.ok(s.includes('redactStatementNumber'), 'masks statement number');
  assert.ok(s.includes("redactId(l.orderItemId"), 'masks order item id');
  assert.ok(s.includes("redactId(l.orderNumber"), 'masks order number');
  assert.ok(s.includes("redactId(l.sellerSku"), 'masks seller sku');
});

test('reports export rows are redacted and purchases hides bank references', () => {
  for (const p of [
    'app/(dashboard)/reports/sales/page.tsx',
    'app/(dashboard)/reports/profit/page.tsx',
    'app/(dashboard)/reports/purchases/page.tsx',
    'app/(dashboard)/reports/expenses/page.tsx',
    'app/(dashboard)/reports/inventory/page.tsx',
  ]) {
    const s = src(p);
    assert.ok(s.includes('redactExportRows'), `${p} redacts export rows`);
    assert.ok(s.includes('columns={exp.columns}'), `${p} passes redacted export columns`);
  }
  const purchases = src('app/(dashboard)/reports/purchases/page.tsx');
  assert.ok(
    purchases.includes("presentation.active ? '' : p.bankReference"),
    'purchases report drops bank ref from export when active'
  );
  assert.ok(
    purchases.includes("presentation.active ? '—' : p.bankReference"),
    'purchases report hides bank ref cell when active'
  );
});
