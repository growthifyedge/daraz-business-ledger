// Presentation Safe View — activation/exit UX tests.
//
// Source scans (consistent with the earlier phases — the repo has no React test
// runtime) proving the enter/exit controls give immediate, single-transition
// feedback without weakening security:
//   - pending: both profile buttons disable instantly, the chosen one spins, a
//     "Starting Presentation Safe View…" message + protective overlay appear;
//   - success: the server action still sets the signed cookie, audits, and
//     redirects exactly once (no duplicate refresh/navigation);
//   - failure: the action returns a retry message and the buttons re-enable;
//   - double-click: buttons are disabled while pending;
//   - exit: an equivalent pending state + overlay;
//   - inactive: the overlay only exists while a transition is in flight, and the
//     cookie stays signed + httpOnly (unchanged).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function src(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8');
}

function count(hay: string, needle: string): number {
  return hay.split(needle).length - 1;
}

// ---------------------------------------------------------------------------
// Server actions — useActionState signature, single redirect, fail-with-message
// ---------------------------------------------------------------------------

test('enable/exit actions use the useActionState signature and redirect exactly once', () => {
  const s = src('lib/presentation/actions.ts');
  assert.ok(/enablePresentationSafeView\(\s*_prev: FormState,\s*formData: FormData\s*\): Promise<FormState>/.test(s), 'enable is a form-state action');
  assert.ok(/disablePresentationSafeView\(\s*prevState: FormState,\s*formData: FormData\s*\): Promise<FormState>/.test(s), 'exit is a form-state action');
  // Exactly one navigation per action → no duplicate router refresh / navigation.
  assert.equal(count(s, "redirect('/dashboard')"), 2, 'one redirect per action');
  assert.ok(!s.includes('router.refresh'), 'no extra client refresh in the action');
  assert.ok(!s.includes("redirect('/dashboard?psv=unavailable')"), 'unavailable path no longer force-navigates');
});

test('actions return a clear retry message on failure (never throw to a boundary)', () => {
  const s = src('lib/presentation/actions.ts');
  assert.ok(s.includes('} catch {'), 'fallible work is wrapped');
  assert.ok(s.includes("return fail('Could not start Presentation Safe View. Please try again.')"), 'enable failure message');
  assert.ok(s.includes("return fail('Could not exit Presentation Safe View. Please try again.')"), 'exit failure message');
});

test('security is unchanged: signed httpOnly cookie + audit event preserved', () => {
  const actions = src('lib/presentation/actions.ts');
  assert.ok(actions.includes('setPresentationCookie'), 'enable still sets the cookie');
  assert.ok(actions.includes('clearPresentationCookie'), 'exit still clears the cookie');
  assert.ok(count(actions, 'logAudit({') === 2, 'both actions still audit the event');
  // The cookie is still signed + httpOnly (set in the context module).
  const ctx = src('lib/presentation/context.ts');
  assert.ok(ctx.includes('httpOnly: true'), 'cookie stays httpOnly');
  assert.ok(ctx.includes('signPresentationToken'), 'cookie stays signed');
});

// ---------------------------------------------------------------------------
// Enable menu — immediate pending, spinner, overlay, failure, double-click guard
// ---------------------------------------------------------------------------

test('enable menu shows an immediate pending state and blocks double submits', () => {
  const s = src('components/PresentationEnableMenu.tsx');
  assert.ok(s.includes('useActionState('), 'drives pending via useActionState');
  assert.ok(s.includes('enablePresentationSafeView'), 'bound to the enable action');
  // Both profiles in ONE form → a single action call, single transition.
  assert.equal(count(s, '<form action={formAction}'), 1, 'single form / single submit path');
  assert.ok(s.includes('value="OPERATIONS"') && s.includes('value="FINANCE"'), 'both profiles offered');
  // Immediate disable of BOTH buttons while pending (double-click prevention).
  assert.equal(count(s, 'disabled={isPending}'), 2, 'both buttons disable while pending');
  // Chosen profile spins.
  assert.ok(s.includes('animate-spin'), 'shows a spinner');
  assert.ok(s.includes("spinning('OPERATIONS')") && s.includes("spinning('FINANCE')"), 'per-button spinner');
  // Clear messages + protective overlay.
  assert.ok(s.includes('Starting Presentation Safe View…'), 'clear starting message');
  assert.ok(s.includes('Preparing protected view'), 'overlay subtitle');
  assert.ok(s.includes('<PresentationOverlay'), 'drops the protective overlay');
  assert.ok(/\{isPending && \(\s*<PresentationOverlay/.test(s), 'overlay only while pending (inactive unaffected)');
});

test('enable menu re-enables and shows a retry message on failure', () => {
  const s = src('components/PresentationEnableMenu.tsx');
  // The error only renders once pending clears, so buttons are usable again.
  assert.ok(s.includes('{state.error && !isPending && ('), 'shows the retry message after pending ends');
  assert.ok(s.includes('role="alert"'), 'retry message is announced');
});

// ---------------------------------------------------------------------------
// Exit — equivalent pending state
// ---------------------------------------------------------------------------

test('banner Exit has an equivalent pending state + overlay', () => {
  const s = src('components/PresentationBanner.tsx');
  assert.ok(s.includes('useActionState('), 'exit drives pending via useActionState');
  assert.ok(s.includes('disablePresentationSafeView'), 'bound to the exit action');
  assert.ok(s.includes('disabled={exiting}') && s.includes('aria-busy={exiting}'), 'exit button disables while pending');
  assert.ok(s.includes('Returning to normal view…'), 'clear exit message');
  assert.ok(s.includes('<PresentationOverlay'), 'exit drops the protective overlay');
  assert.ok(/\{exiting && \(\s*<PresentationOverlay/.test(s), 'overlay only while exiting');
  assert.ok(s.includes('exitState.error'), 'exit surfaces a failure message');
});

// ---------------------------------------------------------------------------
// Overlay — non-dismissible, protective, accessible
// ---------------------------------------------------------------------------

test('protective overlay is non-dismissible and blocks interaction', () => {
  const s = src('components/PresentationOverlay.tsx');
  assert.ok(s.includes('fixed inset-0'), 'covers the whole viewport');
  assert.ok(s.includes('z-[60]'), 'sits above the banner and app chrome');
  assert.ok(s.includes('aria-busy'), 'marked busy for assistive tech');
  assert.ok(s.includes('role="alert"'), 'announced');
  // No close affordance at all — cannot be dismissed by the user.
  assert.ok(!s.includes('onClick') && !s.includes('onClose'), 'no dismiss control');
});
