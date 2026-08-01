// Presentation Safe View — Phase 4 tests: presentation UX polish.
//
// Source scans (consistent with the earlier phases) proving the demo-facing
// controls are wired: the global banner is sticky and states profile / read-only
// / expiry / Exit; the blocked-redirect notice explains blocked + unavailable in
// plain language and clears its URL marker; the enable menu offers both profiles
// and links to the readiness checklist; and the app shell keeps the banner and
// header both visible. No redaction/guard logic is touched here — those remain
// covered by the Phase 1–3D suites.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function src(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8');
}

// ---------------------------------------------------------------------------
// Global banner — always visible, states everything a presenter needs
// ---------------------------------------------------------------------------

test('presentation banner is sticky and states profile, read-only, expiry and Exit', () => {
  const s = src('components/PresentationBanner.tsx');
  assert.ok(/sticky\s+top-0/.test(s), 'banner pins to the top (always visible)');
  assert.ok(s.includes('z-50'), 'banner sits above the app header');
  assert.ok(s.includes('Read-only'), 'banner states the app is read-only');
  assert.ok(s.includes('PRESENTATION_PROFILE_LABEL'), 'banner shows the active profile');
  assert.ok(s.includes('Exits in') || s.includes('timeLeft'), 'banner shows time remaining');
  assert.ok(s.includes('disablePresentationSafeView'), 'banner keeps the Exit action');
  assert.ok(s.includes('href="/presentation"'), 'banner links to the readiness page');
  // Only renders when active — normal mode is visually unchanged.
  assert.ok(s.includes('if (!presentation.active) return null'), 'renders nothing when inactive');
});

// ---------------------------------------------------------------------------
// Blocked / unavailable redirect notice — plain-language explanation
// ---------------------------------------------------------------------------

test('presentation notice explains both blocked and unavailable redirects', () => {
  const s = src('components/PresentationNotice.tsx');
  assert.ok(s.includes('blocked:'), 'handles the blocked redirect');
  assert.ok(s.includes('unavailable:'), 'handles the unavailable redirect');
  // Non-technical wording (no raw codes / stack detail in the copy).
  assert.ok(/hidden during a presentation/i.test(s), 'blocked copy is plain-language');
  // Reads and then clears the marker so it does not survive a refresh / shared link.
  assert.ok(s.includes("params.get('psv')"), 'reads the psv marker');
  assert.ok(s.includes("next.delete('psv')") && s.includes('router.replace'), 'clears the marker from the URL');
  // Nothing renders without a marker → normal mode unaffected.
  assert.ok(s.includes('if (!msg') && s.includes('return null'), 'renders nothing without a marker');
});

// ---------------------------------------------------------------------------
// Enable menu — both profiles + readiness link + guidance
// ---------------------------------------------------------------------------

test('enable menu offers both profiles and links to the readiness checklist', () => {
  const s = src('components/PresentationEnableMenu.tsx');
  assert.ok(s.includes('value="OPERATIONS"'), 'offers the Operations profile');
  assert.ok(s.includes('value="FINANCE"'), 'offers the Finance profile');
  assert.ok(s.includes('href="/presentation"'), 'links to the readiness / pre-demo checklist');
  assert.ok(/read-only/i.test(s), 'explains the mode is read-only');
});

// ---------------------------------------------------------------------------
// App shell — banner + header both stay visible; notice is wired
// ---------------------------------------------------------------------------

test('app shell keeps banner and header visible and renders the notice', () => {
  const s = src('components/AppShell.tsx');
  assert.ok(s.includes('<PresentationBanner'), 'renders the banner');
  assert.ok(s.includes('<PresentationNotice'), 'renders the blocked/unavailable notice');
  assert.ok(s.includes('Suspense'), 'wraps the search-param notice in Suspense');
  // Header is offset below the banner only while active; normal mode stays top-0.
  assert.ok(s.includes("psv.active ? 'top-10' : 'top-0'"), 'header pins below the banner when active');
});
