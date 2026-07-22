// Focused tests for Yahya payment balances, derived status, total payable and
// allocation validation. Pure — no DB.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  paidToDate,
  remainingBalance,
  deriveStatus,
  isPayable,
  totalPayable,
  validateAllocations,
  combineYahyaCash,
  round2,
  transferPaidForScope,
  type PurchasePaidInput,
  type AllocationTarget,
  type YahyaCashAggregates,
} from '../lib/yahyaPayments';

const P = (over: Partial<PurchasePaidInput> = {}): PurchasePaidInput => ({
  paymentStatus: 'UNPAID',
  totalCost: 1000,
  allocatedAmount: 0,
  ...over,
});

// --- paidToDate / remaining / status ---

test('paidToDate: sums allocations; legacy PAID with none falls back to totalCost', () => {
  assert.equal(paidToDate(P({ allocatedAmount: 400 })), 400);
  assert.equal(paidToDate(P({ paymentStatus: 'PAID', allocatedAmount: 0 })), 1000); // legacy
  assert.equal(paidToDate(P({ allocatedAmount: 0 })), 0);
});

test('remainingBalance: never negative; reflects allocations', () => {
  assert.equal(remainingBalance(P({ allocatedAmount: 400 })), 600);
  assert.equal(remainingBalance(P({ allocatedAmount: 1000 })), 0);
  assert.equal(remainingBalance(P({ allocatedAmount: 1200 })), 0);
});

test('deriveStatus: UNPAID / PARTIALLY_PAID / PAID from allocations', () => {
  assert.equal(deriveStatus(P({ allocatedAmount: 0 })), 'UNPAID');
  assert.equal(deriveStatus(P({ allocatedAmount: 400 })), 'PARTIALLY_PAID');
  assert.equal(deriveStatus(P({ allocatedAmount: 1000 })), 'PAID');
});

test('deriveStatus: RECONCILIATION_PENDING is never recomputed', () => {
  assert.equal(
    deriveStatus(P({ paymentStatus: 'RECONCILIATION_PENDING', allocatedAmount: 500 })),
    'RECONCILIATION_PENDING'
  );
  assert.equal(isPayable('RECONCILIATION_PENDING'), false);
  assert.equal(isPayable('PAID'), false);
  assert.equal(isPayable('UNPAID'), true);
  assert.equal(isPayable('PARTIALLY_PAID'), true);
});

test('totalPayable: sums remaining over UNPAID/PARTIALLY_PAID; excludes PAID & pending', () => {
  const total = totalPayable([
    P({ totalCost: 1000, allocatedAmount: 400 }), // remaining 600
    P({ totalCost: 500, allocatedAmount: 0 }), // remaining 500
    P({ paymentStatus: 'PAID', totalCost: 800, allocatedAmount: 0 }), // excluded
    P({ paymentStatus: 'RECONCILIATION_PENDING', totalCost: 900, allocatedAmount: 0 }), // excluded
  ]);
  assert.equal(total, 1100);
});

// --- allocation validation ---

const targets: AllocationTarget[] = [
  { purchaseId: 'a', status: 'UNPAID', remaining: 1000 },
  { purchaseId: 'b', status: 'PARTIALLY_PAID', remaining: 300 },
  { purchaseId: 'c', status: 'PAID', remaining: 0 },
  { purchaseId: 'd', status: 'RECONCILIATION_PENDING', remaining: 900 },
];

test('validate: exact full allocation across multiple purchases passes', () => {
  const r = validateAllocations(
    1300,
    [
      { purchaseId: 'a', amount: 1000 },
      { purchaseId: 'b', amount: 300 },
    ],
    targets
  );
  assert.equal(r.ok, true);
});

test('validate: partial payment of one purchase passes', () => {
  const r = validateAllocations(250, [{ purchaseId: 'a', amount: 250 }], targets);
  assert.equal(r.ok, true);
});

test('validate: under-allocation (advance/remainder) is rejected', () => {
  const r = validateAllocations(1000, [{ purchaseId: 'a', amount: 600 }], targets);
  assert.equal(r.ok, false);
  assert.match(r.error!, /must equal the payment amount/);
});

test('validate: over-allocation beyond payment amount is rejected', () => {
  const r = validateAllocations(
    900,
    [
      { purchaseId: 'a', amount: 700 },
      { purchaseId: 'b', amount: 300 },
    ],
    targets
  );
  assert.equal(r.ok, false);
});

test('validate: allocation exceeding a purchase remaining is rejected', () => {
  const r = validateAllocations(500, [{ purchaseId: 'b', amount: 500 }], targets);
  assert.equal(r.ok, false);
  assert.match(r.error!, /remaining balance/);
});

test('validate: PAID or RECONCILIATION_PENDING targets are rejected', () => {
  assert.equal(validateAllocations(0, [], targets).ok, false);
  const paid = validateAllocations(100, [{ purchaseId: 'c', amount: 100 }], targets);
  assert.equal(paid.ok, false);
  const pend = validateAllocations(100, [{ purchaseId: 'd', amount: 100 }], targets);
  assert.equal(pend.ok, false);
  assert.match(pend.error!, /RECONCILIATION_PENDING/);
});

// --- shared cash summary (combineYahyaCash): one source, no double-count ---

const AGG = (o: Partial<YahyaCashAggregates> = {}): YahyaCashAggregates => ({
  payableTotalCost: 0,
  payableAllocated: 0,
  paidTotalCost: 0,
  paidAllocated: 0,
  reconciliationPendingTotalCost: 0,
  nonVoidedTransferTotal: 0,
  ...o,
});

test('cash: FULL payment — purchase 1000 fully paid via a 1000 transfer', () => {
  // Purchase is PAID with allocations == totalCost; transfer counted once.
  const s = combineYahyaCash(
    AGG({ paidTotalCost: 1000, paidAllocated: 1000, nonVoidedTransferTotal: 1000 })
  );
  assert.equal(s.actualPaidToYahya, 1000); // not 2000 — no double count
  assert.equal(s.payableToYahya, 0);
});

test('cash: PARTIAL payment — purchase 1000, 400 paid', () => {
  const s = combineYahyaCash(
    AGG({ payableTotalCost: 1000, payableAllocated: 400, nonVoidedTransferTotal: 400 })
  );
  assert.equal(s.payableToYahya, 600);
  assert.equal(s.actualPaidToYahya, 400);
});

test('cash: ONE transfer split across purchases (A 1000 partial 300, B 500 full)', () => {
  // A PARTIALLY_PAID (payable), B PAID (allocated). One 800 transfer.
  const s = combineYahyaCash(
    AGG({
      payableTotalCost: 1000, // A
      payableAllocated: 300,
      paidTotalCost: 500, // B
      paidAllocated: 500,
      nonVoidedTransferTotal: 800, // the single transfer, counted once
    })
  );
  assert.equal(s.payableToYahya, 700); // A remaining
  assert.equal(s.actualPaidToYahya, 800); // 300 + 500, the transfer once; legacy term 0
});

test('cash: VOIDED payment — its transfer and allocations drop out', () => {
  // After void, A & B revert to UNPAID with no allocations; transfer excluded.
  const s = combineYahyaCash(AGG({ payableTotalCost: 1500, payableAllocated: 0, nonVoidedTransferTotal: 0 }));
  assert.equal(s.payableToYahya, 1500);
  assert.equal(s.actualPaidToYahya, 0);
});

test('cash: LEGACY PAID fallback — PAID purchase with no allocations counts once', () => {
  const s = combineYahyaCash(AGG({ paidTotalCost: 1000, paidAllocated: 0, nonVoidedTransferTotal: 0 }));
  assert.equal(s.actualPaidToYahya, 1000); // legacy term
  assert.equal(s.payableToYahya, 0);
});

test('cash: RECONCILIATION_PENDING is separate — not owed, not paid, not in net', () => {
  const s = combineYahyaCash(
    AGG({
      payableTotalCost: 600,
      payableAllocated: 100,
      paidTotalCost: 500,
      paidAllocated: 500,
      nonVoidedTransferTotal: 500,
      reconciliationPendingTotalCost: 900,
    })
  );
  assert.equal(s.reconciliationPending, 900);
  assert.equal(s.payableToYahya, 500); // 600 − 100 (pending 900 excluded)
  assert.equal(s.actualPaidToYahya, 500); // transfer only; pending excluded
});

// --- store-scoped "Paid to Yahya": one transfer split across two stores ---

test('paid by scope: one 800 transfer split Ashu 300 + GrowthifyEdge 500', () => {
  // A single bank transfer of 800 allocated to purchases in two stores.
  const allocations = [
    { storeId: 'ashu', amount: 300, voided: false },
    { storeId: 'ge', amount: 500, voided: false },
  ];
  const allStoresTransferTotal = 800; // the transfer, counted once

  const all = transferPaidForScope(null, allStoresTransferTotal, allocations);
  const ashu = transferPaidForScope('ashu', allStoresTransferTotal, allocations);
  const ge = transferPaidForScope('ge', allStoresTransferTotal, allocations);

  assert.equal(ashu, 300); // Ashu report shows only its share
  assert.equal(ge, 500); // GrowthifyEdge shows only its share — not the whole 800
  assert.equal(all, 800); // All Stores counts the transfer once
  assert.equal(round2(ashu + ge), all); // shares reconcile exactly to the transfer

  // Fed into the shared summary, each scope reports only its paid share.
  assert.equal(combineYahyaCash({ ...AGG(), nonVoidedTransferTotal: ashu }).actualPaidToYahya, 300);
  assert.equal(combineYahyaCash({ ...AGG(), nonVoidedTransferTotal: ge }).actualPaidToYahya, 500);
  assert.equal(combineYahyaCash({ ...AGG(), nonVoidedTransferTotal: all }).actualPaidToYahya, 800);
});

test('paid by scope: voided allocations are excluded from a store share', () => {
  const allocations = [
    { storeId: 'ashu', amount: 300, voided: false },
    { storeId: 'ashu', amount: 200, voided: true }, // voided → excluded
  ];
  assert.equal(transferPaidForScope('ashu', 300, allocations), 300);
});

test('validate: duplicate purchase and zero/negative amounts are rejected', () => {
  const dup = validateAllocations(
    600,
    [
      { purchaseId: 'a', amount: 300 },
      { purchaseId: 'a', amount: 300 },
    ],
    targets
  );
  assert.equal(dup.ok, false);
  assert.match(dup.error!, /more than once/);
  assert.equal(validateAllocations(100, [{ purchaseId: 'a', amount: 0 }], targets).ok, false);
});
