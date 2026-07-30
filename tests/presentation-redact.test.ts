// Presentation Safe View — Phase 2 redaction core tests.
//
// Covers every transform, both profiles (Operations / Finance), the inactive
// identity guarantee, determinism, the policy catalogue, and the hard invariant
// that an ACTIVE transform never returns the original confidential value.
//
// The redaction core is pure (no Next runtime, no env, no DB), so these run
// under `tsx --test` directly.

import test from 'node:test';
import assert from 'node:assert/strict';

import { formatMoney } from '../lib/utils';
import {
  REDACTION_POLICY,
  LABEL_PREFIX,
  treatmentFor,
  type RedactionCategory,
} from '../lib/presentation/policy';
import {
  stableLabel,
  maskId,
  maskStatementNumber,
  moneyBand,
  moneyStatus,
  moneyRatio,
  redactPersonName,
  redactSupplier,
  redactId,
  redactStatementNumber,
  redactText,
  redactFileUrl,
  redactMoney,
  redactMoneyRatio,
  redactByCategory,
} from '../lib/presentation/redact';
import type { PresentationContext } from '../lib/presentation/core';

const OPS: PresentationContext = { active: true, profile: 'OPERATIONS' };
const FIN: PresentationContext = { active: true, profile: 'FINANCE' };
const OFF: PresentationContext = { active: false, profile: null };

// ---------------------------------------------------------------------------
// Policy catalogue
// ---------------------------------------------------------------------------

test('policy: every category is catalogued for both profiles', () => {
  const categories: RedactionCategory[] = [
    'PERSON_NAME', 'SUPPLIER', 'ORDER_ID', 'TRACKING_ID', 'STATEMENT_NUMBER',
    'MONEY', 'BANK_REF', 'NOTES', 'AUDIT_DETAIL', 'FILE_URL', 'INTERNAL_CODE',
  ];
  for (const c of categories) {
    assert.ok(REDACTION_POLICY[c], `${c} present`);
    assert.ok(REDACTION_POLICY[c].operations, `${c} operations treatment`);
    assert.ok(REDACTION_POLICY[c].finance, `${c} finance treatment`);
  }
});

test('policy: money differs by profile; identity/text are the same across profiles', () => {
  assert.equal(treatmentFor('MONEY', 'OPERATIONS'), 'MONEY_STATUS');
  assert.equal(treatmentFor('MONEY', 'FINANCE'), 'MONEY_BAND');
  assert.equal(treatmentFor('PERSON_NAME', 'OPERATIONS'), 'ANONYMOUS_LABEL');
  assert.equal(treatmentFor('PERSON_NAME', 'FINANCE'), 'ANONYMOUS_LABEL');
  assert.equal(treatmentFor('NOTES', 'OPERATIONS'), 'HIDE_TEXT');
  assert.equal(treatmentFor('FILE_URL', 'FINANCE'), 'HIDE_URL');
  assert.equal(LABEL_PREFIX.PERSON_NAME, 'Customer');
  assert.equal(LABEL_PREFIX.SUPPLIER, 'Supplier');
});

// ---------------------------------------------------------------------------
// Pure primitives
// ---------------------------------------------------------------------------

test('stableLabel: deterministic, well-formed, and reveals none of the seed', () => {
  const a = stableLabel('Customer', 'Ahmed Khan');
  assert.equal(a, stableLabel('Customer', 'Ahmed Khan')); // deterministic
  assert.match(a, /^Customer [A-Z]\d{1,2}$/);
  assert.ok(!a.includes('Ahmed'));
  // Distinct seeds spread across labels (not all collapsed to one).
  const labels = new Set(
    ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((s) => stableLabel('Customer', s))
  );
  assert.ok(labels.size > 1, 'labels are not all identical');
});

test('maskId: deterministic opaque token, no source characters', () => {
  const id = maskId('114-2233445-9', 'ORD');
  assert.equal(id, maskId('114-2233445-9', 'ORD'));
  assert.match(id, /^ORD-[0-9A-F]{6}$/);
  assert.ok(!id.includes('114'));
  assert.ok(!id.includes('2233445'));
});

test('maskStatementNumber: masked, deterministic, no source', () => {
  const s = maskStatementNumber('STMT-2026-000123');
  assert.equal(s, maskStatementNumber('STMT-2026-000123'));
  assert.match(s, /^Statement ••[0-9A-F]{4}$/);
  assert.ok(!s.includes('000123'));
  assert.ok(!s.includes('2026'));
});

test('moneyBand: safe ranges, never the exact figure', () => {
  assert.equal(moneyBand(0), 'Rs 0');
  assert.equal(moneyBand(999), 'under Rs 1k');
  assert.equal(moneyBand(1_000), 'Rs 1k–2.5k');
  assert.equal(moneyBand(12_345), 'Rs 10k–25k');
  assert.equal(moneyBand(250_000), 'Rs 250k–500k');
  assert.equal(moneyBand(1_500_000), 'Rs 1m–2.5m');
  assert.equal(moneyBand(-60_000), '−Rs 50k–100k');
  assert.ok(!moneyBand(12_345).includes('12'));
});

test('moneyStatus: sign only', () => {
  assert.equal(moneyStatus(100), 'Positive');
  assert.equal(moneyStatus(-5), 'Negative');
  assert.equal(moneyStatus(0), 'Break-even');
});

test('moneyRatio: proportion only; undefined ratios render as dash', () => {
  assert.equal(moneyRatio(42, 100), '42%');
  assert.equal(moneyRatio(1, 3), '33%');
  assert.equal(moneyRatio(-50, 100), '-50%'); // Math.round keeps ASCII minus
  assert.equal(moneyRatio(5, 0), '—');
});

// ---------------------------------------------------------------------------
// Context-aware transforms — INACTIVE identity
// ---------------------------------------------------------------------------

test('inactive: identity for every context-aware transform', () => {
  assert.equal(redactPersonName('Ahmed Khan', OFF), 'Ahmed Khan');
  assert.equal(redactSupplier('Yahya Traders', OFF), 'Yahya Traders');
  assert.equal(redactId('ORD-123', OFF), 'ORD-123');
  assert.equal(redactStatementNumber('STMT-9', OFF), 'STMT-9');
  assert.equal(redactText('secret note', OFF), 'secret note');
  assert.equal(redactFileUrl('https://x/y.pdf', OFF), 'https://x/y.pdf');
  // Money identity is the exact figure, formatted exactly as today.
  assert.equal(redactMoney(12_345, OFF), formatMoney(12_345));
  assert.equal(redactMoneyRatio(40, 100, OFF), formatMoney(40));
  assert.equal(redactByCategory('PERSON_NAME', 'Ahmed', OFF), 'Ahmed');
  // Null / empty pass through unchanged in any mode.
  assert.equal(redactPersonName(null, OPS), null);
  assert.equal(redactId(undefined, FIN), undefined);
  assert.equal(redactPersonName('', OPS), '');
});

// ---------------------------------------------------------------------------
// Context-aware transforms — ACTIVE behaviour, both profiles
// ---------------------------------------------------------------------------

test('active: person + supplier become stable labels (both profiles)', () => {
  for (const ctx of [OPS, FIN]) {
    const p = redactPersonName('Ahmed Khan', ctx);
    assert.match(p as string, /^Customer [A-Z]\d{1,2}$/);
    assert.notEqual(p, 'Ahmed Khan');
    const s = redactSupplier('Yahya Traders', ctx);
    assert.match(s as string, /^Supplier [A-Z]\d{1,2}$/);
    assert.notEqual(s, 'Yahya Traders');
  }
  // Identity is profile-independent: same label in both profiles.
  assert.equal(redactPersonName('Ahmed Khan', OPS), redactPersonName('Ahmed Khan', FIN));
});

test('active: ids and statement numbers are masked (both profiles)', () => {
  for (const ctx of [OPS, FIN]) {
    assert.match(redactId('114-2233445-9', ctx, 'ORD') as string, /^ORD-[0-9A-F]{6}$/);
    assert.match(redactStatementNumber('STMT-000123', ctx) as string, /^Statement ••[0-9A-F]{4}$/);
  }
});

test('active: text, notes and file URLs are dropped entirely (both profiles)', () => {
  for (const ctx of [OPS, FIN]) {
    assert.equal(redactText('internal note', ctx), null);
    assert.equal(redactText({ old: 1, new: 2 }, ctx), null); // audit JSON
    assert.equal(redactFileUrl('https://bucket/uploads/invoice.pdf', ctx), null);
  }
});

test('active money: Operations → status, Finance → band; never the exact figure', () => {
  assert.equal(redactMoney(12_345, OPS), 'Positive');
  assert.equal(redactMoney(-12_345, OPS), 'Negative');
  assert.equal(redactMoney(12_345, FIN), 'Rs 10k–25k');
  // The exact amount never appears in either profile.
  for (const ctx of [OPS, FIN]) {
    const out = redactMoney(12_345, ctx);
    assert.ok(!out.includes('12345'));
    assert.ok(!out.includes('12,345'));
  }
});

test('active ratio: proportion only in both profiles', () => {
  assert.equal(redactMoneyRatio(40, 100, OPS), '40%');
  assert.equal(redactMoneyRatio(40, 100, FIN), '40%');
});

test('redactByCategory: dispatches string categories via the policy', () => {
  assert.match(redactByCategory('PERSON_NAME', 'Ahmed', OPS) as string, /^Customer /);
  assert.match(redactByCategory('SUPPLIER', 'Yahya', OPS) as string, /^Supplier /);
  assert.match(redactByCategory('ORDER_ID', '114-99', OPS) as string, /^ID-[0-9A-F]{6}$/);
  assert.match(redactByCategory('TRACKING_ID', 'TRK99', OPS) as string, /^TRK-[0-9A-F]{6}$/);
  assert.match(redactByCategory('STATEMENT_NUMBER', 'S-1', OPS) as string, /^Statement ••/);
  assert.match(redactByCategory('INTERNAL_CODE', 'CODE-7', OPS) as string, /^ID-[0-9A-F]{6}$/);
  assert.equal(redactByCategory('NOTES', 'hi', OPS), null);
  assert.equal(redactByCategory('BANK_REF', 'ref', OPS), null);
  assert.equal(redactByCategory('AUDIT_DETAIL', 'x', OPS), null);
  assert.equal(redactByCategory('FILE_URL', 'https://x', OPS), null);
  assert.equal(redactByCategory('PERSON_NAME', null, OPS), null);
  // Same result in both profiles for string categories.
  assert.equal(
    redactByCategory('ORDER_ID', '114-99', OPS),
    redactByCategory('ORDER_ID', '114-99', FIN)
  );
});

// ---------------------------------------------------------------------------
// Hard invariant: no active transform returns the original confidential value
// ---------------------------------------------------------------------------

test('invariant: active transforms never return the original value', () => {
  const secrets = ['Ahmed Khan', '114-2233445-9', 'STMT-2026-000123', 'https://b/invoice.pdf'];
  for (const ctx of [OPS, FIN]) {
    for (const s of secrets) {
      for (const out of [
        redactPersonName(s, ctx),
        redactSupplier(s, ctx),
        redactId(s, ctx, 'ORD'),
        redactStatementNumber(s, ctx),
      ]) {
        assert.notEqual(out, s, `must not equal original (${s})`);
        assert.ok(!(out as string).includes(s), `must not contain original (${s})`);
      }
      // Hides collapse to null.
      assert.equal(redactText(s, ctx), null);
      assert.equal(redactFileUrl(s, ctx), null);
    }
    for (const amount of [12_345, -7_800, 999_999]) {
      const out = redactMoney(amount, ctx);
      assert.ok(!out.includes(String(amount)), `money must not contain ${amount}`);
    }
  }
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

test('determinism: repeated calls yield identical output', () => {
  assert.equal(redactPersonName('Ahmed Khan', OPS), redactPersonName('Ahmed Khan', OPS));
  assert.equal(redactId('114-2233445-9', FIN, 'ORD'), redactId('114-2233445-9', FIN, 'ORD'));
  assert.equal(redactStatementNumber('STMT-9', OPS), redactStatementNumber('STMT-9', OPS));
  assert.equal(redactMoney(12_345, FIN), redactMoney(12_345, FIN));
});
