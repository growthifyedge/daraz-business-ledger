// Presentation Safe View — Demo Interaction Layer tests (Phase 5A).
//
// 1) Behavioural: illustrative demo returns are redacted by the active profile
//    exactly like real rows — no exact sample money, anonymised customer, masked
//    ids — so the demo cannot leak even from built-in sample data.
// 2) Isolation: every demo component is client/in-memory only — it never imports
//    a real server action, never hits a real API route, and never fetches. The
//    real mutation guards are untouched (regression).
// 3) Wiring/gating: the demo affordances are wired into the active-mode views and
//    the dashboard gates the demo-import entry on presentation.active, so normal
//    mode renders none of it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { PresentationContext } from '../lib/presentation/core';
import { toReturnsPresentationRows } from '../lib/presentation/viewmodels/returns';
import { DEMO_RETURN_SOURCE } from '../lib/presentation/demo/samples';

const OPS: PresentationContext = { active: true, profile: 'OPERATIONS' };
const FIN: PresentationContext = { active: true, profile: 'FINANCE' };

function src(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8');
}

const DEMO_NOTICE = 'Demo simulation — no live records changed.';

// ---------------------------------------------------------------------------
// 1) Illustrative demo data is redacted by the active profile
// ---------------------------------------------------------------------------

const SAMPLE_SECRETS = ['2499', '2,499', '5980', '5,980', '1450', '1,450', 'DEMO-ORD-0001', 'DEMO-RO-0001', 'DEMO-TRK-0001'];

test('illustrative demo returns are redacted like real rows (both profiles)', () => {
  for (const ctx of [OPS, FIN]) {
    const rows = toReturnsPresentationRows(DEMO_RETURN_SOURCE, ctx);
    assert.equal(rows.length, 3, 'renders the sample rows');
    const blob = JSON.stringify(rows);
    for (const s of SAMPLE_SECRETS) assert.ok(!blob.includes(s), `demo data leaked ${s}`);
    for (const r of rows) {
      assert.match(r.customer, /^Customer [A-Z]\d{1,2}$/, 'customer anonymised');
      assert.match(r.orderNumber, /^ORD-[0-9A-F]{6}$/, 'order id masked');
      assert.match(r.returnId, /^RET-[0-9A-F]{6}$/, 'return id masked');
    }
  }
});

test('illustrative demo money is status (Operations) vs band (Finance), never exact', () => {
  assert.equal(toReturnsPresentationRows(DEMO_RETURN_SOURCE, OPS)[0].refund, 'Positive');
  assert.match(toReturnsPresentationRows(DEMO_RETURN_SOURCE, FIN)[0].refund, /^Rs .*k/);
});

// ---------------------------------------------------------------------------
// 2) Demo components are isolated — no real mutation / route / network
// ---------------------------------------------------------------------------

const DEMO_FILES = [
  'app/(dashboard)/purchases/DemoRecordPurchase.tsx',
  'app/(dashboard)/products/DemoProductPreview.tsx',
  'app/(dashboard)/returns/DemoReturnDetail.tsx',
  'app/(dashboard)/import/DemoImport.tsx',
  'lib/presentation/demo/useDemoSimulation.ts',
  'lib/presentation/demo/samples.ts',
];

test('demo components never call a real mutation, import route, or network', () => {
  const forbidden = [
    'fetch(',
    "from './actions'",
    'savePurchase',
    'commitImport',
    '/api/daraz-import',
    '/api/upload',
    'previewBulkPurchases',
    '@/lib/prisma',
    'revalidatePath',
  ];
  for (const f of DEMO_FILES) {
    const s = src(f);
    for (const bad of forbidden) {
      assert.ok(!s.includes(bad), `${f} must not reference ${bad}`);
    }
  }
});

test('real mutation guards are untouched (regression)', () => {
  // The demo layer adds affordances but does not weaken any server-side control.
  const purchases = src('app/(dashboard)/purchases/actions.ts');
  assert.ok(purchases.includes('presentationWriteBlock'), 'real savePurchase still guarded');
  const upload = src('app/api/upload/route.ts');
  assert.ok(upload.includes('isPresentationActive'), 'real upload route still blocks');
});

// ---------------------------------------------------------------------------
// 3) Wiring + gating + the single demo notice
// ---------------------------------------------------------------------------

test('demo affordances are wired into the active-mode views', () => {
  assert.ok(src('app/(dashboard)/purchases/PurchasesPresentationView.tsx').includes('<DemoRecordPurchase'), 'purchases: Record Purchase');
  assert.ok(src('app/(dashboard)/products/ProductsPresentationView.tsx').includes('<DemoProductPreview'), 'products: Preview');
  const returnsView = src('app/(dashboard)/returns/ReturnsPresentationView.tsx');
  assert.ok(returnsView.includes('<DemoReturnDetail'), 'returns: detail drawer');
  assert.ok(returnsView.includes('illustrative'), 'returns: illustrative marker');
  assert.ok(src('app/(dashboard)/returns/page.tsx').includes('DEMO_RETURN_SOURCE'), 'returns page seeds illustrative rows when empty');
});

test('demo-import entry is gated on active presentation mode only', () => {
  const dash = src('app/(dashboard)/dashboard/page.tsx');
  assert.ok(dash.includes('presentation.active && <DemoImport'), 'dashboard renders DemoImport only when active');
});

test('every simulated result carries the exact demo notice', () => {
  assert.ok(src('components/demo/DemoBadge.tsx').includes(DEMO_NOTICE), 'DemoBadge states the notice');
  // Demo success/preview flows use the badge, and the redacted exports are marked.
  for (const f of [
    'app/(dashboard)/products/ProductsPresentationView.tsx',
    'app/(dashboard)/purchases/PurchasesPresentationView.tsx',
    'app/(dashboard)/returns/ReturnsPresentationView.tsx',
  ]) {
    assert.ok(src(f).includes('Demo simulation — no live records changed.'), `${f} marks its export as demo`);
  }
});
