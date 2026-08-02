// Presentation Safe View — demo action placement + the two new workflows.
//
// 1) Placement: every demo-capable module renders its demo action(s) ABOVE the
//    main table (before the first content Card), via the shared DemoActionsBar —
//    never below a long list.
// 2) The two new workflows (Record Demo Sale, Record Demo Accessory / Stock
//    Usage) exist, are isolated (no real action/route/fetch/prisma), and redact
//    entered money by the active profile.
// 3) Audit: reporting pages (P&L, Reports, Statements, Payouts) gain no fake
//    create actions; normal-mode managers stay demo-free.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { PresentationContext } from '../lib/presentation/core';
import { toSalesPresentationRows } from '../lib/presentation/viewmodels/sales';
import { toAccessoriesPresentationRows } from '../lib/presentation/viewmodels/accessories';

const OPS: PresentationContext = { active: true, profile: 'OPERATIONS' };
const FIN: PresentationContext = { active: true, profile: 'FINANCE' };

function src(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8');
}

// ---------------------------------------------------------------------------
// 1) Placement — demo mount is above the main table in every module
// ---------------------------------------------------------------------------

const VIEWS: Array<{ file: string; mount: string }> = [
  { file: 'app/(dashboard)/products/ProductsPresentationView.tsx', mount: '<DemoProductActions' },
  { file: 'app/(dashboard)/purchases/PurchasesPresentationView.tsx', mount: '<DemoRecordPurchase' },
  { file: 'app/(dashboard)/returns/ReturnsPresentationView.tsx', mount: '<DemoRecordReturn' },
  { file: 'app/(dashboard)/expenses/ExpensesPresentationView.tsx', mount: '<DemoRecordExpense' },
  { file: 'app/(dashboard)/sales/SalesPresentationView.tsx', mount: '<DemoRecordSale' },
  { file: 'app/(dashboard)/accessories/AccessoriesPresentationView.tsx', mount: '<DemoRecordAccessory' },
];

test('every demo-capable module mounts its demo actions above the table', () => {
  for (const { file, mount } of VIEWS) {
    const s = src(file);
    const mountAt = s.indexOf(mount);
    const tableAt = s.indexOf('<Card>');
    assert.ok(mountAt >= 0, `${file} mounts ${mount}`);
    assert.ok(tableAt >= 0, `${file} has a content Card`);
    assert.ok(mountAt < tableAt, `${file}: demo actions must appear before the table`);
  }
});

test('demo controls share the top DemoActionsBar toolbar', () => {
  for (const f of [
    'app/(dashboard)/products/DemoProductActions.tsx',
    'app/(dashboard)/purchases/DemoRecordPurchase.tsx',
    'app/(dashboard)/returns/DemoRecordReturn.tsx',
    'app/(dashboard)/expenses/DemoRecordExpense.tsx',
    'app/(dashboard)/sales/DemoRecordSale.tsx',
    'app/(dashboard)/accessories/DemoRecordAccessory.tsx',
  ]) {
    assert.ok(src(f).includes('<DemoActionsBar>'), `${f} uses the shared toolbar`);
  }
});

test('each module exposes its required demo action label', () => {
  assert.ok(src('app/(dashboard)/products/DemoProductActions.tsx').includes('Add Product'), 'Add Product');
  assert.ok(src('app/(dashboard)/products/DemoProductActions.tsx').includes('Add Stock'), 'Add Stock');
  assert.ok(src('app/(dashboard)/purchases/DemoRecordPurchase.tsx').includes('Record Purchase'), 'Record Purchase');
  assert.ok(src('app/(dashboard)/returns/DemoRecordReturn.tsx').includes('Record Return'), 'Record Return');
  assert.ok(src('app/(dashboard)/expenses/DemoRecordExpense.tsx').includes('Record Expense'), 'Record Expense');
  assert.ok(src('app/(dashboard)/sales/DemoRecordSale.tsx').includes('Record Demo Sale'), 'Record Demo Sale');
  assert.ok(
    src('app/(dashboard)/accessories/DemoRecordAccessory.tsx').includes('Record Demo Accessory / Stock Usage'),
    'Record Demo Accessory / Stock Usage'
  );
  // Daraz income demo import stays visible (dashboard tile, active-gated).
  assert.ok(src('app/(dashboard)/dashboard/page.tsx').includes('presentation.active && <DemoImport'), 'Demo import');
});

// ---------------------------------------------------------------------------
// 2) New workflows — redaction + isolation
// ---------------------------------------------------------------------------

test('demo sale money follows the profile and never shows the exact figure', () => {
  const build = (ctx: PresentationContext) =>
    toSalesPresentationRows(
      [{ id: 'demo-sale-new-1', date: '2026-01-25', storeName: 'Ashu Traderz', productName: 'Wireless Earbuds Pro', quantitySold: 3, grossAmount: 5990, netAmount: 5100 }],
      ctx
    )[0];
  assert.equal(build(OPS).grossAmount, 'Positive');
  assert.match(build(FIN).grossAmount, /^Rs .*k/);
  for (const ctx of [OPS, FIN]) {
    const blob = JSON.stringify(build(ctx));
    for (const exact of ['5990', '5,990', '5100', '5,100']) assert.ok(!blob.includes(exact), `sale leaked ${exact}`);
  }
});

test('demo accessory cost follows the profile and never shows the exact figure', () => {
  const build = (ctx: PresentationContext) =>
    toAccessoriesPresentationRows(
      [{ id: 'demo-accessory-new-1', name: 'Packing Tape', quantityPurchased: 100, quantityUsed: 40, unitCost: 3000, totalCost: 6000, purchaseDate: '2026-01-25' }],
      ctx
    )[0];
  assert.equal(build(OPS).totalCost, 'Positive');
  assert.match(build(FIN).totalCost, /^Rs .*k/);
  for (const ctx of [OPS, FIN]) {
    const blob = JSON.stringify(build(ctx));
    for (const exact of ['3000', '3,000', '6000', '6,000']) assert.ok(!blob.includes(exact), `accessory leaked ${exact}`);
  }
});

test('new demo workflows and the shared toolbar call no real action/route/network', () => {
  const forbidden = ['fetch(', "from './actions'", 'saveSale', 'saveAccessory', '/api/', '@/lib/prisma', 'revalidatePath', 'localStorage'];
  for (const f of [
    'app/(dashboard)/sales/DemoRecordSale.tsx',
    'app/(dashboard)/accessories/DemoRecordAccessory.tsx',
    'components/demo/DemoActionsBar.tsx',
  ]) {
    const s = src(f);
    for (const bad of forbidden) assert.ok(!s.includes(bad), `${f} must not reference ${bad}`);
  }
});

test('real mutation guards remain the server-side backstop (regression)', () => {
  assert.ok(src('app/(dashboard)/sales/actions.ts').includes('presentationWriteBlock'), 'sales guarded');
  assert.ok(src('app/(dashboard)/accessories/actions.ts').includes('presentationWriteBlock'), 'accessories guarded');
});

// ---------------------------------------------------------------------------
// 3) Audit — reporting pages get no fake creates; managers stay demo-free
// ---------------------------------------------------------------------------

test('reporting pages have no fake create/demo-mutation controls', () => {
  for (const p of [
    'app/(dashboard)/profit-loss/page.tsx',
    'app/(dashboard)/reports/page.tsx',
    'app/(dashboard)/statements/page.tsx',
    'app/(dashboard)/payouts/page.tsx',
  ]) {
    const s = src(p);
    assert.ok(!s.includes('DemoRecord') && !s.includes('DemoProductActions'), `${p} adds no demo create action`);
  }
});

test('normal-mode managers reference none of the demo controls', () => {
  for (const m of [
    'app/(dashboard)/products/ProductsManager.tsx',
    'app/(dashboard)/purchases/PurchasesManager.tsx',
    'app/(dashboard)/returns/ReturnsManager.tsx',
    'app/(dashboard)/expenses/ExpensesManager.tsx',
    'app/(dashboard)/sales/SalesManager.tsx',
    'app/(dashboard)/accessories/AccessoriesManager.tsx',
  ]) {
    const s = src(m);
    for (const t of ['DemoActionsBar', 'DemoRecordSale', 'DemoRecordAccessory', 'DemoProductActions', 'DemoRecordReturn', 'DemoRecordExpense']) {
      assert.ok(!s.includes(t), `${m} must not reference ${t}`);
    }
  }
});
