// Focused tests for purchase payment classification across all three statuses.
// PAID → paid to Yahya (cash out); UNPAID → owed to Yahya (payable);
// RECONCILIATION_PENDING → neither owed nor paid, no cash impact.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyPurchasePayment,
  summarizePurchasePayments,
} from '../lib/purchasePayments';

test('classify: PAID → paidToYahya', () => {
  assert.equal(classifyPurchasePayment('PAID'), 'paidToYahya');
});
test('classify: UNPAID → owedToYahya', () => {
  assert.equal(classifyPurchasePayment('UNPAID'), 'owedToYahya');
});
test('classify: RECONCILIATION_PENDING → reconciliationPending', () => {
  assert.equal(classifyPurchasePayment('RECONCILIATION_PENDING'), 'reconciliationPending');
});

test('summarize: each status sums into exactly its own bucket', () => {
  const t = summarizePurchasePayments([
    { paymentStatus: 'PAID', totalCost: 1000 },
    { paymentStatus: 'UNPAID', totalCost: 250 },
    { paymentStatus: 'RECONCILIATION_PENDING', totalCost: 39680 },
    { paymentStatus: 'PAID', totalCost: 500 },
    { paymentStatus: 'RECONCILIATION_PENDING', totalCost: 320 },
  ]);
  assert.equal(t.paidToYahya, 1500);
  assert.equal(t.owedToYahya, 250);
  assert.equal(t.reconciliationPending, 40000);
});

test('reconciliation-pending is never counted as owed or paid', () => {
  const t = summarizePurchasePayments([
    { paymentStatus: 'RECONCILIATION_PENDING', totalCost: 39680 },
  ]);
  assert.equal(t.owedToYahya, 0);
  assert.equal(t.paidToYahya, 0);
  assert.equal(t.reconciliationPending, 39680);
});

test('existing PAID/UNPAID behaviour is unchanged (no pending rows)', () => {
  const t = summarizePurchasePayments([
    { paymentStatus: 'PAID', totalCost: 800 },
    { paymentStatus: 'UNPAID', totalCost: 1200 },
  ]);
  assert.equal(t.paidToYahya, 800);
  assert.equal(t.owedToYahya, 1200);
  assert.equal(t.reconciliationPending, 0);
});
