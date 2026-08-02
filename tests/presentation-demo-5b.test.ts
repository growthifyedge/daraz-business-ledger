// Presentation Safe View — Demo Interaction Layer Phase 5B tests.
//
// The three new demo workflows (Add Product / Add Stock, Record Return, Record
// Expense) append rows to in-memory React state only. These tests prove:
//   1) money a presenter types into a demo form is redacted by the active
//      profile before it is shown — never an exact figure — using the SAME
//      view-models the components call;
//   2) every demo component is isolated: no real action, API route, fetch,
//      Prisma, upload, or database write, and the in-memory collection hook uses
//      no storage/network;
//   3) the demo actions are wired into the active-mode views only, and the real
//      mutation guards are untouched (normal mode renders none of this).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { PresentationContext } from '../lib/presentation/core';
import { toReturnsPresentationRows } from '../lib/presentation/viewmodels/returns';
import { toExpensesPresentationRows } from '../lib/presentation/viewmodels/expenses';

const OPS: PresentationContext = { active: true, profile: 'OPERATIONS' };
const FIN: PresentationContext = { active: true, profile: 'FINANCE' };

function src(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8');
}

// ---------------------------------------------------------------------------
// 1) A demo-entered amount is redacted by the active profile (both), never exact
// ---------------------------------------------------------------------------

test('demo-recorded return money follows the profile and never shows the exact figure', () => {
  // Mirrors what DemoRecordReturn builds from the form on submit.
  const buildRow = (ctx: PresentationContext) =>
    toReturnsPresentationRows(
      [
        {
          id: 'demo-return-new-1',
          returnDate: '2026-01-25',
          productName: 'Wireless Earbuds Pro',
          storeName: 'Ashu Traderz',
          orderNumber: 'DEMO-NEW-1001',
          returnOrderId: 'DEMO-RO-NEW-1001',
          trackingNumber: 'DEMO-TRK-NEW-1001',
          quantity: 2,
          refundAmount: 7350,
          chargedTo: 'SELLER',
          refundStatus: 'PENDING',
          inventoryStatus: 'PENDING',
          reason: 'Damaged in transit',
        },
      ],
      ctx
    )[0];

  assert.equal(buildRow(OPS).refund, 'Positive');
  assert.match(buildRow(FIN).refund, /^Rs .*k/);
  for (const ctx of [OPS, FIN]) {
    const blob = JSON.stringify(buildRow(ctx));
    for (const exact of ['7350', '7,350', 'DEMO-NEW-1001', 'DEMO-TRK-NEW-1001']) {
      assert.ok(!blob.includes(exact), `demo return leaked ${exact}`);
    }
    assert.match(buildRow(ctx).customer, /^Customer [A-Z]\d{1,2}$/);
  }
});

test('demo-recorded expense money follows the profile and payer is anonymised', () => {
  const buildRow = (ctx: PresentationContext) =>
    toExpensesPresentationRows(
      [{ id: 'demo-expense-new-1', date: '2026-01-25', category: 'PACKAGING', storeName: 'Ashu Traderz', amount: 3400 }],
      ctx
    )[0];

  assert.equal(buildRow(OPS).amount, 'Positive');
  assert.match(buildRow(FIN).amount, /^Rs .*k/);
  for (const ctx of [OPS, FIN]) {
    const row = buildRow(ctx);
    assert.match(row.payer, /^Payer [A-Z]\d{1,2}$/);
    assert.ok(!JSON.stringify(row).includes('3400') && !JSON.stringify(row).includes('3,400'), 'no exact amount');
  }
});

// ---------------------------------------------------------------------------
// 2) Isolation — no real action / route / network / storage
// ---------------------------------------------------------------------------

const DEMO_FILES = [
  'app/(dashboard)/products/DemoProductActions.tsx',
  'app/(dashboard)/returns/DemoRecordReturn.tsx',
  'app/(dashboard)/expenses/DemoRecordExpense.tsx',
  'lib/presentation/demo/useDemoCollection.ts',
];

test('demo workflows call no real action, route, network, prisma, or upload', () => {
  const forbidden = [
    'fetch(',
    "from './actions'",
    'saveProduct',
    'adjustStock',
    'saveReturn',
    'saveExpense',
    '/api/',
    '@/lib/prisma',
    'revalidatePath',
  ];
  for (const f of DEMO_FILES) {
    const s = src(f);
    for (const bad of forbidden) assert.ok(!s.includes(bad), `${f} must not reference ${bad}`);
  }
});

test('the in-memory collection hook uses no persistence or network', () => {
  const s = src('lib/presentation/demo/useDemoCollection.ts');
  for (const bad of ['localStorage', 'sessionStorage', 'cookie', 'document.cookie', 'fetch(', 'indexedDB']) {
    assert.ok(!s.includes(bad), `collection hook must not use ${bad}`);
  }
  assert.ok(s.includes('useState'), 'holds rows in React state only');
});

test('real mutation guards remain the server-side backstop (regression)', () => {
  assert.ok(src('app/(dashboard)/products/actions.ts').includes('presentationWriteBlock'), 'products actions guarded');
  assert.ok(src('app/(dashboard)/returns/actions.ts').includes('presentationWriteBlock'), 'returns actions guarded');
  assert.ok(src('app/(dashboard)/expenses/actions.ts').includes('presentationWriteBlock'), 'expenses actions guarded');
});

// ---------------------------------------------------------------------------
// 3) Wiring + active-only gating
// ---------------------------------------------------------------------------

test('demo actions are wired into the active-mode presentation views only', () => {
  assert.ok(src('app/(dashboard)/products/ProductsPresentationView.tsx').includes('<DemoProductActions'), 'products view');
  assert.ok(src('app/(dashboard)/returns/ReturnsPresentationView.tsx').includes('<DemoRecordReturn'), 'returns view');
  assert.ok(src('app/(dashboard)/expenses/ExpensesPresentationView.tsx').includes('<DemoRecordExpense'), 'expenses view');
  // The presentation views only render inside `if (presentation.active)` branches,
  // so normal mode (the Managers) never mounts any of this.
  assert.ok(src('app/(dashboard)/products/page.tsx').includes('if (presentation.active) {'), 'products gated');
  assert.ok(src('app/(dashboard)/returns/page.tsx').includes('if (presentation.active) {'), 'returns gated');
  assert.ok(src('app/(dashboard)/expenses/page.tsx').includes('if (presentation.active) {'), 'expenses gated');
});

test('normal-mode managers do not reference the demo workflows', () => {
  for (const m of [
    'app/(dashboard)/products/ProductsManager.tsx',
    'app/(dashboard)/returns/ReturnsManager.tsx',
    'app/(dashboard)/expenses/ExpensesManager.tsx',
  ]) {
    const s = src(m);
    assert.ok(!s.includes('DemoRecordReturn') && !s.includes('DemoRecordExpense') && !s.includes('DemoProductActions'), `${m} stays demo-free`);
  }
});

test('every demo form carries the permanent demo notice', () => {
  for (const f of DEMO_FILES.slice(0, 3)) {
    assert.ok(src(f).includes('<DemoBadge'), `${f} shows the demo badge`);
    assert.ok(src(f).includes('Reset demo changes'), `${f} offers a reset for repeat takes`);
  }
});
