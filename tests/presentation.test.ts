// Presentation Safe View — Phase 1 tests.
//
// Exercises the pure core: the kill switch, signed-token round-trip, expiry,
// tamper rejection, the OWNER-only toggle guard, the blocked-route predicate,
// and the module-block enforcement guard. Also asserts the inactive-mode
// regression: with no token (or the switch off) the context is exactly INACTIVE,
// so normal operation is unchanged.
//
// The core imports no Next runtime, so these run under `tsx --test` directly.

import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';

import {
  signPresentationToken,
  verifyPresentationToken,
  presentationKillSwitchEnabled,
  isPresentationBlockedPage,
  assertOwnerCanToggle,
  assertModuleAllowed,
  PresentationError,
  INACTIVE_PRESENTATION,
  PRESENTATION_MAX_AGE,
  type PresentationContext,
} from '../lib/presentation/core';

const SECRET = 'test-secret-value-for-presentation-safe-view-unit-tests';

// Deterministic env for the whole file: a real signing secret + kill switch ON.
// Individual tests toggle the kill switch where they need it.
process.env.AUTH_SECRET = SECRET;
process.env.PRESENTATION_SAFE_VIEW_ENABLED = 'true';

function withKillSwitch(value: string | undefined, fn: () => Promise<void>) {
  return async () => {
    const prev = process.env.PRESENTATION_SAFE_VIEW_ENABLED;
    if (value === undefined) delete process.env.PRESENTATION_SAFE_VIEW_ENABLED;
    else process.env.PRESENTATION_SAFE_VIEW_ENABLED = value;
    try {
      await fn();
    } finally {
      process.env.PRESENTATION_SAFE_VIEW_ENABLED = prev;
    }
  };
}

// --- Kill switch -----------------------------------------------------------

test('kill switch: only the exact string "true" enables the feature', () => {
  process.env.PRESENTATION_SAFE_VIEW_ENABLED = 'true';
  assert.equal(presentationKillSwitchEnabled(), true);
  for (const v of ['false', 'TRUE', '1', 'yes', '']) {
    process.env.PRESENTATION_SAFE_VIEW_ENABLED = v;
    assert.equal(presentationKillSwitchEnabled(), false, `"${v}" must not enable`);
  }
  process.env.PRESENTATION_SAFE_VIEW_ENABLED = 'true';
});

test(
  'kill switch OFF: a valid token is inert (context INACTIVE)',
  withKillSwitch('false', async () => {
    // Sign while forcing the switch on, then verify with it off.
    process.env.PRESENTATION_SAFE_VIEW_ENABLED = 'true';
    const token = await signPresentationToken({ profile: 'FINANCE', enabledByName: 'Owner' });
    process.env.PRESENTATION_SAFE_VIEW_ENABLED = 'false';
    const ctx = await verifyPresentationToken(token);
    assert.deepEqual(ctx, INACTIVE_PRESENTATION);
  })
);

test(
  'kill switch UNSET defaults to OFF',
  withKillSwitch(undefined, async () => {
    assert.equal(presentationKillSwitchEnabled(), false);
    const ctx = await verifyPresentationToken('anything');
    assert.equal(ctx.active, false);
  })
);

// --- Signed context round-trip --------------------------------------------

test('sign + verify: OPERATIONS profile round-trips with metadata', async () => {
  process.env.PRESENTATION_SAFE_VIEW_ENABLED = 'true';
  const token = await signPresentationToken({
    profile: 'OPERATIONS',
    enabledByName: 'Ada Owner',
    enabledById: 'user_123',
  });
  const ctx = await verifyPresentationToken(token);
  assert.equal(ctx.active, true);
  assert.equal(ctx.profile, 'OPERATIONS');
  assert.equal(ctx.enabledByName, 'Ada Owner');
  assert.ok(ctx.enabledAt, 'enabledAt is present');
  assert.ok(ctx.expiresAt, 'expiresAt is present');
  // Expiry is ~4h after issue.
  const span = new Date(ctx.expiresAt!).getTime() - new Date(ctx.enabledAt!).getTime();
  assert.equal(Math.round(span / 1000), PRESENTATION_MAX_AGE);
});

test('sign + verify: FINANCE profile round-trips', async () => {
  process.env.PRESENTATION_SAFE_VIEW_ENABLED = 'true';
  const token = await signPresentationToken({ profile: 'FINANCE', enabledByName: 'Owner' });
  const ctx = await verifyPresentationToken(token);
  assert.equal(ctx.active, true);
  assert.equal(ctx.profile, 'FINANCE');
});

// --- Expiry + tampering + malformed ---------------------------------------

test('verify: an expired token is rejected (INACTIVE)', async () => {
  process.env.PRESENTATION_SAFE_VIEW_ENABLED = 'true';
  const secret = new TextEncoder().encode(SECRET);
  const nowSec = Math.floor(Date.now() / 1000);
  const expired = await new SignJWT({ psv: true, profile: 'OPERATIONS' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(nowSec - 10_000)
    .setExpirationTime(nowSec - 10) // already expired
    .sign(secret);
  const ctx = await verifyPresentationToken(expired);
  assert.equal(ctx.active, false);
});

test('verify: a tampered token is rejected (INACTIVE)', async () => {
  process.env.PRESENTATION_SAFE_VIEW_ENABLED = 'true';
  const token = await signPresentationToken({ profile: 'OPERATIONS', enabledByName: 'Owner' });
  const tampered = token.slice(0, -2) + (token.endsWith('a') ? 'bb' : 'aa');
  const ctx = await verifyPresentationToken(tampered);
  assert.equal(ctx.active, false);
});

test('verify: a token signed with the WRONG secret is rejected', async () => {
  process.env.PRESENTATION_SAFE_VIEW_ENABLED = 'true';
  const wrong = new TextEncoder().encode('a-completely-different-secret-value-xyz');
  const nowSec = Math.floor(Date.now() / 1000);
  const forged = await new SignJWT({ psv: true, profile: 'FINANCE' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(nowSec)
    .setExpirationTime(nowSec + PRESENTATION_MAX_AGE)
    .sign(wrong);
  const ctx = await verifyPresentationToken(forged);
  assert.equal(ctx.active, false);
});

test('verify: a well-signed token WITHOUT the psv marker is rejected', async () => {
  process.env.PRESENTATION_SAFE_VIEW_ENABLED = 'true';
  const secret = new TextEncoder().encode(SECRET);
  const nowSec = Math.floor(Date.now() / 1000);
  const noMarker = await new SignJWT({ profile: 'OPERATIONS' }) // no psv:true
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(nowSec)
    .setExpirationTime(nowSec + PRESENTATION_MAX_AGE)
    .sign(secret);
  const ctx = await verifyPresentationToken(noMarker);
  assert.equal(ctx.active, false);
});

test('verify: missing/empty token is INACTIVE', async () => {
  process.env.PRESENTATION_SAFE_VIEW_ENABLED = 'true';
  assert.equal((await verifyPresentationToken(undefined)).active, false);
  assert.equal((await verifyPresentationToken('')).active, false);
});

// --- OWNER-only toggle guard ----------------------------------------------

test('assertOwnerCanToggle: OWNER passes, ADMIN throws', () => {
  assert.doesNotThrow(() => assertOwnerCanToggle('OWNER'));
  assert.throws(() => assertOwnerCanToggle('ADMIN'), PresentationError);
});

// --- Blocked-route predicate ----------------------------------------------

test('isPresentationBlockedPage: blocks the three owner-only areas + subpaths', () => {
  for (const p of ['/backup', '/audit-log', '/import', '/import/anything', '/audit-log/x']) {
    assert.equal(isPresentationBlockedPage(p), true, `${p} must be blocked`);
  }
});

test('isPresentationBlockedPage: does NOT block normal or look-alike paths', () => {
  for (const p of ['/dashboard', '/products', '/importer', '/backups', '/', '/reports/sales']) {
    assert.equal(isPresentationBlockedPage(p), false, `${p} must NOT be blocked`);
  }
});

// --- Module-block enforcement (route handlers / actions) -------------------

test('assertModuleAllowed: throws when active, passes when inactive', () => {
  const active: PresentationContext = { active: true, profile: 'OPERATIONS' };
  assert.throws(() => assertModuleAllowed(active, 'Backup & Export'), PresentationError);
  assert.doesNotThrow(() => assertModuleAllowed(INACTIVE_PRESENTATION, 'Backup & Export'));
});

// --- Inactive-mode regression ---------------------------------------------

test('regression: INACTIVE constant is the exact off-state shape', () => {
  assert.deepEqual(INACTIVE_PRESENTATION, { active: false, profile: null });
});
