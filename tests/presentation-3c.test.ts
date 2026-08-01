// Presentation Safe View — Phase 3C tests (Expenses, Accessories, Manual Sales,
// Stores).
//
// 1) View-model unit tests: the redacted DTOs handed to the read-only client
//    views contain no original confidential value or dropped key, in BOTH
//    profiles; money is status (Operations) vs band (Finance), never exact; and
//    the inactive context is byte-identical to today.
// 2) Export simulation: the exact rows the presentation views pass to
//    <ExportButtons> serialize to CSV cells with no original value.
// 3) Source scans: each in-scope page resolves the presentation context, gates a
//    read-only branch on it, still renders the normal Manager when inactive, and
//    fetches only safe columns; the read-only views emit no file URL.
//
// Pure modules → run under `tsx --test` with no Next runtime / DB.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { formatMoney } from '../lib/utils';
import type { PresentationContext } from '../lib/presentation/core';
import {
  toExpensesPresentationRows,
  toExpensesPresentationTotals,
  type ExpensesSourceRow,
} from '../lib/presentation/viewmodels/expenses';
import {
  toAccessoriesPresentationRows,
  toAccessoriesPresentationTotals,
  type AccessoriesSourceRow,
} from '../lib/presentation/viewmodels/accessories';
import {
  toSalesPresentationRows,
  toSalesPresentationTotals,
  type SalesSourceRow,
} from '../lib/presentation/viewmodels/sales';
import {
  toStoresPresentationRows,
  type StoresSourceRow,
} from '../lib/presentation/viewmodels/stores';

const OPS: PresentationContext = { active: true, profile: 'OPERATIONS' };
const FIN: PresentationContext = { active: true, profile: 'FINANCE' };
const OFF: PresentationContext = { active: false, profile: null };

function src(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8');
}

function assertNoSecrets(obj: unknown, secrets: string[]) {
  const blob = JSON.stringify(obj);
  for (const s of secrets) {
    assert.ok(!blob.includes(s), `leaked confidential value: ${s}`);
  }
}

// Distinctive confidential samples — a substring match is a true leak.
const EXPENSE: ExpensesSourceRow = {
  id: 'e1',
  date: new Date('2026-05-01T00:00:00Z'),
  category: 'PACKAGING',
  storeName: 'Ashu',
  amount: 12_345,
  paidBy: 'Zulfiqar Sons Trading',
};
const EXPENSE_SECRETS = ['Zulfiqar Sons Trading', '12345', '12,345'];

const ACCESSORY: AccessoriesSourceRow = {
  id: 'a1',
  name: 'Packing Tape',
  quantityPurchased: 100,
  quantityUsed: 40,
  unitCost: 2_600,
  totalCost: 13_000,
  purchaseDate: new Date('2026-04-02T00:00:00Z'),
};
const ACCESSORY_SECRETS = ['2600', '2,600', '13000', '13,000'];

const SALE: SalesSourceRow = {
  id: 's1',
  date: new Date('2026-05-03T00:00:00Z'),
  storeName: 'GrowthifyEdge',
  productName: 'Wireless Widget',
  quantitySold: 3,
  grossAmount: 12_345,
  netAmount: -6_789,
};
const SALE_SECRETS = ['12345', '12,345', '6789', '6,789'];

const STORE: StoresSourceRow = {
  id: 'st1',
  name: 'Ashu Traderz',
  active: true,
  productCount: 12,
  notes: 'confidential landlord ref XYZ-9911',
};
const STORE_SECRETS = ['confidential landlord ref XYZ-9911'];

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

test('expenses: active DTO anonymises payer, drops sensitive keys, never leaks (both profiles)', () => {
  for (const ctx of [OPS, FIN]) {
    const [row] = toExpensesPresentationRows([EXPENSE], ctx);
    const keys = Object.keys(row);
    for (const k of ['paidBy', 'paymentMethod', 'receiptUrl', 'notes']) {
      assert.ok(!keys.includes(k), `${k} key absent`);
    }
    assert.match(row.payer, /^Payer [A-Z]\d{1,2}$/);
    // Preserved operational context.
    assert.equal(row.category, 'Packaging');
    assert.equal(row.storeName, 'Ashu');
    assertNoSecrets(row, EXPENSE_SECRETS);
  }
});

test('expenses: amount is status vs band, never exact; inactive is identity', () => {
  assert.equal(toExpensesPresentationRows([EXPENSE], OPS)[0].amount, 'Positive');
  assert.equal(toExpensesPresentationRows([EXPENSE], FIN)[0].amount, 'Rs 10k–25k');
  const off = toExpensesPresentationRows([EXPENSE], OFF)[0];
  assert.equal(off.payer, 'Zulfiqar Sons Trading');
  assert.equal(off.amount, formatMoney(12_345));
});

test('expenses: totals are redacted per profile', () => {
  const input = { total: 12_345, month: 6_000, count: 7 };
  assert.equal(toExpensesPresentationTotals(input, OPS).total, 'Positive');
  assert.equal(toExpensesPresentationTotals(input, FIN).month, 'Rs 5k–10k');
  assert.equal(toExpensesPresentationTotals(input, OFF).total, formatMoney(12_345));
  assert.equal(toExpensesPresentationTotals(input, FIN).count, 7);
});

// ---------------------------------------------------------------------------
// Accessories
// ---------------------------------------------------------------------------

test('accessories: active DTO hides costs, drops receipt/notes, never leaks (both profiles)', () => {
  for (const ctx of [OPS, FIN]) {
    const [row] = toAccessoriesPresentationRows([ACCESSORY], ctx);
    const keys = Object.keys(row);
    for (const k of ['receiptUrl', 'notes']) {
      assert.ok(!keys.includes(k), `${k} key absent`);
    }
    // Preserved operational context.
    assert.equal(row.name, 'Packing Tape');
    assert.equal(row.quantityPurchased, 100);
    assert.equal(row.quantityUsed, 40);
    assertNoSecrets(row, ACCESSORY_SECRETS);
  }
});

test('accessories: unit/total cost are status vs band; inactive is identity', () => {
  const ops = toAccessoriesPresentationRows([ACCESSORY], OPS)[0];
  assert.equal(ops.unitCost, 'Positive');
  assert.equal(ops.totalCost, 'Positive');
  const fin = toAccessoriesPresentationRows([ACCESSORY], FIN)[0];
  assert.equal(fin.unitCost, 'Rs 2.5k–5k');
  assert.equal(fin.totalCost, 'Rs 10k–25k');
  const off = toAccessoriesPresentationRows([ACCESSORY], OFF)[0];
  assert.equal(off.unitCost, formatMoney(2_600));
  assert.equal(off.totalCost, formatMoney(13_000));
});

test('accessories: totals are redacted per profile', () => {
  const input = { totalCost: 13_000, consumedCost: 6_000, count: 5 };
  assert.equal(toAccessoriesPresentationTotals(input, OPS).totalCost, 'Positive');
  assert.equal(toAccessoriesPresentationTotals(input, FIN).totalCost, 'Rs 10k–25k');
  assert.equal(toAccessoriesPresentationTotals(input, OFF).consumedCost, formatMoney(6_000));
});

// ---------------------------------------------------------------------------
// Manual Sales
// ---------------------------------------------------------------------------

test('sales: active DTO hides money, drops notes/buyer, never leaks (both profiles)', () => {
  for (const ctx of [OPS, FIN]) {
    const [row] = toSalesPresentationRows([SALE], ctx);
    const keys = Object.keys(row);
    for (const k of ['notes', 'buyerName', 'createdBy', 'unitCost', 'commission', 'vat']) {
      assert.ok(!keys.includes(k), `${k} key absent`);
    }
    // Preserved operational context.
    assert.equal(row.productName, 'Wireless Widget');
    assert.equal(row.storeName, 'GrowthifyEdge');
    assert.equal(row.quantitySold, 3);
    assertNoSecrets(row, SALE_SECRETS);
  }
});

test('sales: gross/net are status vs band, never exact; inactive is identity', () => {
  const ops = toSalesPresentationRows([SALE], OPS)[0];
  assert.equal(ops.grossAmount, 'Positive');
  assert.equal(ops.netAmount, 'Negative');
  const fin = toSalesPresentationRows([SALE], FIN)[0];
  assert.equal(fin.grossAmount, 'Rs 10k–25k');
  const off = toSalesPresentationRows([SALE], OFF)[0];
  assert.equal(off.grossAmount, formatMoney(12_345));
  assert.equal(off.netAmount, formatMoney(-6_789));
});

test('sales: totals are redacted per profile', () => {
  const input = { gross: 12_345, net: 6_000, units: 9 };
  assert.equal(toSalesPresentationTotals(input, OPS).gross, 'Positive');
  assert.equal(toSalesPresentationTotals(input, FIN).net, 'Rs 5k–10k');
  assert.equal(toSalesPresentationTotals(input, OFF).gross, formatMoney(12_345));
  assert.equal(toSalesPresentationTotals(input, FIN).units, 9);
});

// ---------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------

test('stores: DTO drops notes, preserves name/status/count, never leaks', () => {
  const [row] = toStoresPresentationRows([STORE]);
  assert.ok(!Object.keys(row).includes('notes'), 'notes key absent');
  assert.equal(row.name, 'Ashu Traderz');
  assert.equal(row.active, true);
  assert.equal(row.productCount, 12);
  assertNoSecrets(row, STORE_SECRETS);
});

// ---------------------------------------------------------------------------
// Export safety — simulate the client CSV cell extraction over the exact
// redacted rows the presentation views hand to <ExportButtons>.
// ---------------------------------------------------------------------------

test('exports: CSV cells built from redacted rows contain no original values', () => {
  const cases: Array<[string[], string]> = [
    [EXPENSE_SECRETS, csv(toExpensesPresentationRows([EXPENSE], FIN))],
    [ACCESSORY_SECRETS, csv(toAccessoriesPresentationRows([ACCESSORY], FIN))],
    [SALE_SECRETS, csv(toSalesPresentationRows([SALE], FIN))],
    [STORE_SECRETS, csv(toStoresPresentationRows([STORE]))],
  ];
  for (const [secrets, blob] of cases) {
    for (const s of secrets) assert.ok(!blob.includes(s), `CSV leaked ${s}`);
  }
});

function csv<T extends object>(rows: T[]): string {
  return rows.flatMap((r) => Object.values(r).map((v) => String(v ?? ''))).join(',');
}

// ---------------------------------------------------------------------------
// Source scans — server-side wiring, inactive fallback, and no file URLs
// ---------------------------------------------------------------------------

const PAGES: Array<{ page: string; view: string; manager: string; select: string[] }> = [
  {
    page: 'app/(dashboard)/expenses/page.tsx',
    view: 'ExpensesPresentationView',
    manager: 'ExpensesManager',
    select: ['paidBy', 'paymentMethod', 'receiptUrl', 'notes'],
  },
  {
    page: 'app/(dashboard)/accessories/page.tsx',
    view: 'AccessoriesPresentationView',
    manager: 'AccessoriesManager',
    select: ['receiptUrl', 'notes'],
  },
  {
    page: 'app/(dashboard)/sales/page.tsx',
    view: 'SalesPresentationView',
    manager: 'SalesManager',
    select: ['notes'],
  },
  {
    page: 'app/(dashboard)/stores/page.tsx',
    view: 'StoresPresentationView',
    manager: 'StoresManager',
    select: ['notes'],
  },
];

test('each in-scope page gates a read-only redacted branch and keeps the normal Manager', () => {
  for (const { page, view, manager } of PAGES) {
    const s = src(page);
    assert.ok(s.includes('getPresentationContext'), `${page} resolves the context`);
    assert.ok(s.includes('if (presentation.active) {'), `${page} gates the active branch`);
    assert.ok(s.includes(`<${view}`), `${page} renders ${view} when active`);
    assert.ok(s.includes(`<${manager}`), `${page} still renders ${manager} when inactive`);
  }
});

test("active branch's reduced select omits every sensitive column", () => {
  for (const { page, select } of PAGES) {
    const s = src(page);
    // Isolate the active branch (from the gate to its return) and assert the
    // reduced `select` names none of the sensitive columns.
    const start = s.indexOf('if (presentation.active) {');
    const end = s.indexOf('\n  const [', start); // start of the normal path
    const branch = end > start ? s.slice(start, end) : s.slice(start);
    const selectStart = branch.indexOf('select:');
    const selectBlock = selectStart >= 0 ? branch.slice(selectStart) : branch;
    for (const col of select) {
      assert.ok(
        !new RegExp(`\\b${col}\\s*:`).test(selectBlock),
        `${page} active select must not fetch ${col}`
      );
    }
  }
});

test('read-only presentation views emit no direct file URL or mutation link', () => {
  const views = [
    'app/(dashboard)/expenses/ExpensesPresentationView.tsx',
    'app/(dashboard)/accessories/AccessoriesPresentationView.tsx',
    'app/(dashboard)/sales/SalesPresentationView.tsx',
    'app/(dashboard)/stores/StoresPresentationView.tsx',
  ];
  for (const v of views) {
    const s = src(v);
    assert.ok(!s.includes('href='), `${v} emits no link/href`);
    assert.ok(!s.includes('receiptUrl'), `${v} references no receipt URL`);
    assert.ok(!s.includes('FileUpload'), `${v} has no upload control`);
  }
});
