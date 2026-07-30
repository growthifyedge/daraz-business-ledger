// Presentation Safe View — redaction POLICY catalogue (Phase 2).
//
// A typed, declarative map of confidential data CATEGORIES to the safe TREATMENT
// each should receive, per profile (Operations / Finance). This is the single
// source of truth for "what happens to a customer name / an order id / a money
// figure" — no scattered per-page conditionals.
//
// This module is pure and framework-free: it imports only a TYPE from ./core, so
// it is safe in middleware, server code and unit tests. It performs no redaction
// itself (see ./redact for the transforms) and touches no data, schema, query,
// calculation or business logic. Nothing here is wired into any page in Phase 2.

import type { PresentationProfile } from './core';

/** Every category of confidential field the ERP can surface. */
export type RedactionCategory =
  | 'PERSON_NAME' // customer / buyer names, createdBy display names
  | 'SUPPLIER' // supplier / purchased-by names
  | 'ORDER_ID' // order numbers, return order/item ids, order item ids
  | 'TRACKING_ID' // courier tracking numbers
  | 'STATEMENT_NUMBER' // Daraz statement numbers
  | 'MONEY' // any exact monetary figure (cost, profit, payout, refund, net…)
  | 'BANK_REF' // bank / settlement references
  | 'NOTES' // free-text notes / reasons
  | 'AUDIT_DETAIL' // raw audit oldValue/newValue snapshots
  | 'FILE_URL' // uploaded invoice / receipt URLs (public — never surface)
  | 'INTERNAL_CODE'; // confidential internal product/codes

/**
 * How a category is rendered while active. MONEY is special: its concrete
 * treatment is profile-dependent (status vs band) and is applied by
 * `redactMoney` in ./redact — the policy records the intended treatment so the
 * catalogue stays complete and auditable.
 */
export type RedactionTreatment =
  | 'ANONYMOUS_LABEL' // stable pseudonym, e.g. "Customer A37"
  | 'MASK_ID' // deterministic opaque token revealing none of the original
  | 'MASK_STATEMENT' // masked statement number
  | 'HIDE_TEXT' // dropped entirely (returns null)
  | 'HIDE_URL' // dropped entirely (returns null)
  | 'MONEY_BAND' // safe range, e.g. "Rs 10k–25k"
  | 'MONEY_STATUS'; // qualitative label, e.g. "Positive"

interface CategoryPolicy {
  operations: RedactionTreatment;
  finance: RedactionTreatment;
}

/**
 * The catalogue. Both profiles hide identity and free text identically; they
 * differ only on MONEY — Operations shows a qualitative status, Finance shows a
 * safe band. Neither profile ever exposes an exact figure.
 */
export const REDACTION_POLICY: Record<RedactionCategory, CategoryPolicy> = {
  PERSON_NAME: { operations: 'ANONYMOUS_LABEL', finance: 'ANONYMOUS_LABEL' },
  SUPPLIER: { operations: 'ANONYMOUS_LABEL', finance: 'ANONYMOUS_LABEL' },
  ORDER_ID: { operations: 'MASK_ID', finance: 'MASK_ID' },
  TRACKING_ID: { operations: 'MASK_ID', finance: 'MASK_ID' },
  STATEMENT_NUMBER: { operations: 'MASK_STATEMENT', finance: 'MASK_STATEMENT' },
  MONEY: { operations: 'MONEY_STATUS', finance: 'MONEY_BAND' },
  BANK_REF: { operations: 'HIDE_TEXT', finance: 'HIDE_TEXT' },
  NOTES: { operations: 'HIDE_TEXT', finance: 'HIDE_TEXT' },
  AUDIT_DETAIL: { operations: 'HIDE_TEXT', finance: 'HIDE_TEXT' },
  FILE_URL: { operations: 'HIDE_URL', finance: 'HIDE_URL' },
  INTERNAL_CODE: { operations: 'MASK_ID', finance: 'MASK_ID' },
};

/** Default anonymous-label prefixes for the label categories. */
export const LABEL_PREFIX: Record<'PERSON_NAME' | 'SUPPLIER', string> = {
  PERSON_NAME: 'Customer',
  SUPPLIER: 'Supplier',
};

/** Resolve the treatment for a category under a given profile. */
export function treatmentFor(
  category: RedactionCategory,
  profile: PresentationProfile
): RedactionTreatment {
  const policy = REDACTION_POLICY[category];
  return profile === 'FINANCE' ? policy.finance : policy.operations;
}
