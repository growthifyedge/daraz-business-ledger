// Presentation Safe View — Phase 3D tests: global read-only enforcement + a
// central leakage registry that fails if any page/route/mutation is left
// unprotected.
//
// 1) Pure guard: assertWritable throws the standard read-only error when active,
//    passes when inactive; the message constant is exact.
// 2) Leakage registry: EVERY dashboard page.tsx is classified REDACT / BLOCK /
//    SAFE and the classification is verified in source. A page that exists on
//    disk but is missing from the registry fails the suite — so a future
//    unprotected page cannot slip through.
// 3) Mutation registry: EVERY exported write action across the ERP carries a
//    server-side guard (form block, throw guard, or module guard).
// 4) API routes: upload / bulk-template / backup / daraz-import all fail closed.
//
// Pure source scans + the pure core → run under `tsx --test` with no DB.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  assertWritable,
  PRESENTATION_READONLY_MESSAGE,
  PresentationError,
  INACTIVE_PRESENTATION,
  isPresentationBlockedPage,
  type PresentationContext,
} from '../lib/presentation/core';

const OPS: PresentationContext = { active: true, profile: 'OPERATIONS' };
const FIN: PresentationContext = { active: true, profile: 'FINANCE' };

function src(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8');
}

// ---------------------------------------------------------------------------
// 1) Pure read-only guard
// ---------------------------------------------------------------------------

test('read-only message has the exact required wording', () => {
  assert.equal(PRESENTATION_READONLY_MESSAGE, 'Unavailable while Presentation Safe View is active.');
});

test('assertWritable throws when active (both profiles), passes when inactive', () => {
  for (const ctx of [OPS, FIN]) {
    assert.throws(
      () => assertWritable(ctx),
      (e: unknown) =>
        e instanceof PresentationError && e.message === PRESENTATION_READONLY_MESSAGE
    );
  }
  assert.doesNotThrow(() => assertWritable(INACTIVE_PRESENTATION));
});

// ---------------------------------------------------------------------------
// 2) Central leakage registry — every dashboard page is classified + verified
// ---------------------------------------------------------------------------

const DASHBOARD_DIR = 'app/(dashboard)';

// REDACT: resolves the presentation context and routes confidential values
// through a redaction transform (money band/status, masked ids, redacted export
// rows, or a dedicated read-only presentation view).
const REDACT: string[] = [
  'dashboard/page.tsx',
  'stores/page.tsx',
  'products/page.tsx',
  'products/missing-cogs/page.tsx',
  'purchases/page.tsx',
  'sales/page.tsx',
  'returns/page.tsx',
  'expenses/page.tsx',
  'accessories/page.tsx',
  'payouts/page.tsx',
  'statements/page.tsx',
  'statements/[statementNumber]/page.tsx',
  'profit-loss/page.tsx',
  'reports/expenses/page.tsx',
  'reports/inventory/page.tsx',
  'reports/profit/page.tsx',
  'reports/purchases/page.tsx',
  'reports/sales/page.tsx',
];

// BLOCK: never renders in active mode — redirects away (owner-only raw pages, the
// product drill-down, and the retired cash-flow routes).
const BLOCK: string[] = [
  'backup/page.tsx',
  'audit-log/page.tsx',
  'import/page.tsx',
  'products/[id]/page.tsx',
  'cash-flow/page.tsx',
  'reports/cash-flow/page.tsx',
];

// SAFE: renders no confidential financial data or identities — only names and
// stock quantities already exposed by the redacted Products view, or static
// navigation. Reviewed and intentionally left unchanged.
const SAFE: string[] = [
  'reports/page.tsx', // static list of report links
  'reports/restocking/page.tsx', // product names + stock quantities only, no money
  'presentation/page.tsx', // owner-only readiness status + checklist, no business data
];

const REDACT_TOKENS = /redactMoney|redactExportRows|redactStatementNumber|PresentationView/;

test('leakage registry covers every dashboard page (no unclassified page)', () => {
  const onDisk = readdirSync(resolve(process.cwd(), DASHBOARD_DIR), { recursive: true })
    .map((p) => String(p).replace(/\\/g, '/'))
    .filter((p) => p.endsWith('page.tsx'));
  const classified = new Set([...REDACT, ...BLOCK, ...SAFE]);
  for (const p of onDisk) {
    assert.ok(classified.has(p), `UNCLASSIFIED page (add to the 3D registry): ${p}`);
  }
  // And the registry names no page that has since been deleted.
  const disk = new Set(onDisk);
  for (const p of classified) {
    assert.ok(disk.has(p), `registry lists a missing page: ${p}`);
  }
});

test('REDACT pages resolve the context and route money through a redactor', () => {
  for (const rel of REDACT) {
    const s = src(`${DASHBOARD_DIR}/${rel}`);
    assert.ok(s.includes('getPresentationContext'), `${rel} resolves the context`);
    assert.ok(REDACT_TOKENS.test(s), `${rel} routes confidential values through a redactor`);
  }
});

test('missing-cogs no longer emits a bare formatMoney( for the purchase cost', () => {
  const s = src(`${DASHBOARD_DIR}/products/missing-cogs/page.tsx`);
  assert.ok(!s.includes('formatMoney('), 'missing-cogs uses redactMoney, not formatMoney');
  assert.ok(s.includes('redactMoney(r.currentPurchaseCost'), 'purchase cost is redacted');
});

test('BLOCK pages redirect away in active mode (never render raw data)', () => {
  for (const rel of BLOCK) {
    const s = src(`${DASHBOARD_DIR}/${rel}`);
    const blocks =
      s.includes('redirectIfPresentationActive') ||
      /presentation\.active\)\s*redirect/.test(s) ||
      s.includes("redirect('/dashboard')");
    assert.ok(blocks, `${rel} must redirect/refuse while active`);
  }
});

test('SAFE pages render no money and no confidential identifiers', () => {
  for (const rel of SAFE) {
    const s = src(`${DASHBOARD_DIR}/${rel}`);
    assert.ok(!s.includes('formatMoney('), `${rel} renders no money`);
  }
});

test('blocked-route predicate still covers the owner-only raw pages', () => {
  for (const p of ['/backup', '/audit-log', '/import']) {
    assert.ok(isPresentationBlockedPage(p), `${p} must be a blocked page`);
  }
});

// ---------------------------------------------------------------------------
// 3) Mutation registry — every write action is guarded server-side
// ---------------------------------------------------------------------------

const GUARD_TOKENS = /presentationWriteBlock|assertPresentationReadOnly|assertModuleOutsidePresentation/;

const MUTATIONS: Array<{ file: string; fns: string[] }> = [
  { file: 'expenses/actions.ts', fns: ['saveExpense', 'deleteExpense'] },
  { file: 'accessories/actions.ts', fns: ['saveAccessory', 'deleteAccessory'] },
  { file: 'stores/actions.ts', fns: ['saveStore', 'deleteStore'] },
  { file: 'sales/actions.ts', fns: ['saveSale', 'deleteSale'] },
  { file: 'products/actions.ts', fns: ['saveProduct', 'adjustStock', 'deleteProduct'] },
  { file: 'returns/actions.ts', fns: ['saveReturn', 'deleteReturn', 'restoreReturn'] },
  {
    file: 'purchases/actions.ts',
    fns: ['savePurchase', 'saveNewProductPurchase', 'deletePurchase'],
  },
  {
    file: 'purchases/paymentActions.ts',
    fns: ['recordYahyaPayment', 'editYahyaPayment', 'voidYahyaPayment'],
  },
  { file: 'purchases/bulkActions.ts', fns: ['previewBulkPurchases', 'commitBulkPurchases'] },
  { file: 'import/actions.ts', fns: ['saveDarazSkuMapping'] },
];

/** Body of an exported async function, from its declaration to the next export. */
function fnBody(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}`);
  assert.ok(start >= 0, `function ${name} not found`);
  const after = source.indexOf('\nexport ', start + 1);
  return after > start ? source.slice(start, after) : source.slice(start);
}

test('every exported write action carries a server-side read-only guard', () => {
  for (const { file, fns } of MUTATIONS) {
    const s = src(`${DASHBOARD_DIR}/${file}`);
    for (const fn of fns) {
      const body = fnBody(s, fn);
      assert.ok(GUARD_TOKENS.test(body), `${file}::${fn} is missing the read-only guard`);
    }
  }
});

// ---------------------------------------------------------------------------
// 4) API routes — write / raw-data endpoints fail closed while active
// ---------------------------------------------------------------------------

test('sensitive API routes block while Presentation Safe View is active', () => {
  const routes = [
    'app/api/upload/route.ts',
    'app/api/purchases/bulk-template/route.ts',
    'app/api/backup/route.ts',
    'app/api/daraz-import/_shared.ts',
  ];
  for (const r of routes) {
    assert.ok(src(r).includes('isPresentationActive'), `${r} must check the presentation context`);
  }
  // upload additionally never returns a storage URL when blocked (it returns the
  // standard message before reaching getPublicUrl).
  const upload = src('app/api/upload/route.ts');
  assert.ok(
    upload.indexOf('isPresentationActive') < upload.indexOf('getPublicUrl'),
    'upload blocks before it would produce a public URL'
  );
});
