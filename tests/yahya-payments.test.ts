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
  allocateFifo,
  planStatusUpdates,
  round2,
  transferPaidForScope,
  type FifoPurchase,
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

test('paidToDate/deriveStatus: legacy PAID (no allocations) vs voided PAID (allocations exist)', () => {
  // Legacy PAID, never had allocations → stays fully paid.
  assert.equal(paidToDate(P({ paymentStatus: 'PAID', allocatedAmount: 0, hasAllocations: false })), 1000);
  assert.equal(deriveStatus(P({ paymentStatus: 'PAID', allocatedAmount: 0, hasAllocations: false })), 'PAID');
  // Was paid via allocations, now voided (rows exist, non-voided total 0) → reverts.
  assert.equal(paidToDate(P({ paymentStatus: 'PAID', allocatedAmount: 0, hasAllocations: true })), 0);
  assert.equal(deriveStatus(P({ paymentStatus: 'PAID', allocatedAmount: 0, hasAllocations: true })), 'UNPAID');
  // One allocation left after a partial void → PARTIALLY_PAID.
  assert.equal(
    deriveStatus(P({ paymentStatus: 'PAID', totalCost: 1000, allocatedAmount: 300, hasAllocations: true })),
    'PARTIALLY_PAID'
  );
});

test('deriveStatus: RECONCILIATION_PENDING settles once a payment is allocated', () => {
  // Untouched (nothing paid) → stays pending.
  assert.equal(
    deriveStatus(P({ paymentStatus: 'RECONCILIATION_PENDING', allocatedAmount: 0 })),
    'RECONCILIATION_PENDING'
  );
  // Partly paid via allocation → PARTIALLY_PAID.
  assert.equal(
    deriveStatus(
      P({ paymentStatus: 'RECONCILIATION_PENDING', totalCost: 1000, allocatedAmount: 500, hasAllocations: true })
    ),
    'PARTIALLY_PAID'
  );
  // Fully paid via allocation → PAID.
  assert.equal(
    deriveStatus(
      P({ paymentStatus: 'RECONCILIATION_PENDING', totalCost: 1000, allocatedAmount: 1000, hasAllocations: true })
    ),
    'PAID'
  );
  // Now eligible for allocation alongside UNPAID / PARTIALLY_PAID; PAID excluded.
  assert.equal(isPayable('RECONCILIATION_PENDING'), true);
  assert.equal(isPayable('PAID'), false);
  assert.equal(isPayable('UNPAID'), true);
  assert.equal(isPayable('PARTIALLY_PAID'), true);
});

test('totalPayable: sums remaining over UNPAID/PARTIALLY_PAID/RECONCILIATION_PENDING; excludes PAID', () => {
  const total = totalPayable([
    P({ totalCost: 1000, allocatedAmount: 400 }), // remaining 600
    P({ totalCost: 500, allocatedAmount: 0 }), // remaining 500
    P({ paymentStatus: 'PAID', totalCost: 800, allocatedAmount: 0 }), // excluded (legacy paid)
    P({ paymentStatus: 'RECONCILIATION_PENDING', totalCost: 900, allocatedAmount: 0 }), // now included: 900
  ]);
  assert.equal(total, 2000);
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

test('validate: PAID targets are rejected; RECONCILIATION_PENDING is now allowed', () => {
  assert.equal(validateAllocations(0, [], targets).ok, false);
  const paid = validateAllocations(100, [{ purchaseId: 'c', amount: 100 }], targets);
  assert.equal(paid.ok, false); // PAID still cannot receive an allocation
  const pend = validateAllocations(100, [{ purchaseId: 'd', amount: 100 }], targets);
  assert.equal(pend.ok, true); // RECONCILIATION_PENDING is part of the debt — eligible
});

// --- FIFO automatic allocation ---

// Oldest first. Only PAID is excluded by the caller's query; UNPAID,
// PARTIALLY_PAID and RECONCILIATION_PENDING purchases can all appear here.
const fifo = (): FifoPurchase[] => [
  { purchaseId: 'a', remaining: 1000 }, // oldest
  { purchaseId: 'b', remaining: 500 },
  { purchaseId: 'c', remaining: 300 }, // newest
];

test('fifo: partial payment fills only the oldest purchase', () => {
  const r = allocateFifo(300, fifo());
  assert.equal(r.ok, true);
  assert.deepEqual(r.allocations, [{ purchaseId: 'a', amount: 300 }]);
});

test('fifo: one payment spills across purchases oldest-first', () => {
  const r = allocateFifo(1200, fifo());
  assert.equal(r.ok, true);
  assert.deepEqual(r.allocations, [
    { purchaseId: 'a', amount: 1000 },
    { purchaseId: 'b', amount: 200 },
  ]);
  assert.equal(round2(r.allocations.reduce((s, a) => s + a.amount, 0)), 1200); // exact
});

test('fifo: exactly the total payable allocates every purchase in full', () => {
  const r = allocateFifo(1800, fifo()); // 1000+500+300
  assert.equal(r.ok, true);
  assert.deepEqual(r.allocations, [
    { purchaseId: 'a', amount: 1000 },
    { purchaseId: 'b', amount: 500 },
    { purchaseId: 'c', amount: 300 },
  ]);
});

test('fifo: a payment greater than total payable is rejected', () => {
  const r = allocateFifo(1801, fifo());
  assert.equal(r.ok, false);
  assert.match(r.error!, /exceeds the total payable/);
  assert.equal(r.allocations.length, 0);
});

test('fifo: zero/negative amount and empty payable are rejected', () => {
  assert.equal(allocateFifo(0, fifo()).ok, false);
  assert.equal(allocateFifo(-5, fifo()).ok, false);
  assert.equal(allocateFifo(100, []).ok, false);
  assert.equal(allocateFifo(100, [{ purchaseId: 'x', remaining: 0 }]).ok, false);
});

test('fifo: ordering is honoured — the given oldest-first order drives allocation', () => {
  // Same purchases in a different (newest-first) order → newest gets filled first.
  const r = allocateFifo(600, [
    { purchaseId: 'c', remaining: 300 },
    { purchaseId: 'b', remaining: 500 },
  ]);
  assert.deepEqual(r.allocations, [
    { purchaseId: 'c', amount: 300 },
    { purchaseId: 'b', amount: 300 },
  ]);
});

test('fifo: fractional amounts stay balanced to the payment (no rounding drift)', () => {
  const r = allocateFifo(333.33, [
    { purchaseId: 'a', remaining: 200 },
    { purchaseId: 'b', remaining: 200 },
  ]);
  assert.deepEqual(r.allocations, [
    { purchaseId: 'a', amount: 200 },
    { purchaseId: 'b', amount: 133.33 },
  ]);
  assert.equal(round2(r.allocations.reduce((s, a) => s + a.amount, 0)), 333.33);
});

// --- bulk status recompute planning ---

test('planStatusUpdates: groups changed purchases by target status', () => {
  const plan = planStatusUpdates([
    { id: 'a', paymentStatus: 'UNPAID', totalCost: 1000, allocatedAmount: 1000, hasAllocations: true }, // → PAID
    { id: 'b', paymentStatus: 'UNPAID', totalCost: 1000, allocatedAmount: 400, hasAllocations: true }, // → PARTIALLY_PAID
    { id: 'c', paymentStatus: 'PARTIALLY_PAID', totalCost: 500, allocatedAmount: 500, hasAllocations: true }, // → PAID
  ]);
  const byStatus = Object.fromEntries(plan.map((u) => [u.status, u.ids.sort()]));
  assert.deepEqual(byStatus.PAID, ['a', 'c']);
  assert.deepEqual(byStatus.PARTIALLY_PAID, ['b']);
});

test('planStatusUpdates: skips already-correct and untouched RECONCILIATION_PENDING', () => {
  const plan = planStatusUpdates([
    { id: 'a', paymentStatus: 'PARTIALLY_PAID', totalCost: 1000, allocatedAmount: 400, hasAllocations: true },
    { id: 'b', paymentStatus: 'UNPAID', totalCost: 1000, allocatedAmount: 0, hasAllocations: false },
    { id: 'c', paymentStatus: 'PAID', totalCost: 1000, allocatedAmount: 1000, hasAllocations: true },
    // Untouched pending (nothing allocated) → stays pending, no update.
    { id: 'd', paymentStatus: 'RECONCILIATION_PENDING', totalCost: 900, allocatedAmount: 0, hasAllocations: false },
  ]);
  assert.equal(plan.length, 0);
});

test('planStatusUpdates: an allocated RECONCILIATION_PENDING purchase settles (PARTIALLY_PAID / PAID)', () => {
  const plan = planStatusUpdates([
    { id: 'p1', paymentStatus: 'RECONCILIATION_PENDING', totalCost: 900, allocatedAmount: 900, hasAllocations: true }, // → PAID
    { id: 'p2', paymentStatus: 'RECONCILIATION_PENDING', totalCost: 900, allocatedAmount: 300, hasAllocations: true }, // → PARTIALLY_PAID
  ]);
  const byStatus = Object.fromEntries(plan.map((u) => [u.status, u.ids.sort()]));
  assert.deepEqual(byStatus.PAID, ['p1']);
  assert.deepEqual(byStatus.PARTIALLY_PAID, ['p2']);
});

test('planStatusUpdates: voiding a FIFO payment reverts its purchases; legacy PAID stays PAID', () => {
  const plan = planStatusUpdates([
    // Was PAID via allocations, now all voided (rows exist, non-voided total 0) → UNPAID.
    { id: 'a', paymentStatus: 'PAID', totalCost: 1000, allocatedAmount: 0, hasAllocations: true },
    // Was PAID via allocations, one voided leaving 300 → PARTIALLY_PAID.
    { id: 'b', paymentStatus: 'PAID', totalCost: 1000, allocatedAmount: 300, hasAllocations: true },
    // Legacy PAID with NO allocations ever → stays PAID (unchanged, not in plan).
    { id: 'c', paymentStatus: 'PAID', totalCost: 1000, allocatedAmount: 0, hasAllocations: false },
  ]);
  const byStatus = Object.fromEntries(plan.map((u) => [u.status, u.ids]));
  assert.deepEqual(byStatus.UNPAID, ['a']); // reverted
  assert.deepEqual(byStatus.PARTIALLY_PAID, ['b']); // reverted
  assert.equal(plan.some((u) => u.ids.includes('c')), false); // legacy stays PAID
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

test('cash: RECONCILIATION_PENDING is part of the debt (Total Purchased − Paid)', () => {
  // A partial (100 of 600) + a full paid purchase (500) → one 600 transfer.
  // A 900 reconciliation-pending purchase is untouched (not yet paid).
  const s = combineYahyaCash(
    AGG({
      payableTotalCost: 600,
      payableAllocated: 100,
      paidTotalCost: 500,
      paidAllocated: 500,
      nonVoidedTransferTotal: 600, // 100 + 500, the transfers
      reconciliationPendingTotalCost: 900,
    })
  );
  // Total Purchased = 600 + 500 + 900 = 2000; Paid = 600 → Debt = 1400.
  assert.equal(s.reconciliationPending, 900); // still surfaced for the badge
  assert.equal(s.payableToYahya, 1400); // includes the 900 pending until paid
  assert.equal(s.actualPaidToYahya, 600);
});

test('cash: production screenshot — Total 101440 − Paid 18690 = Debt 82750', () => {
  // 64,260 payable (18,690 of it paid via transfers) + 37,180 pending, no legacy
  // PAID. Total Purchased 101,440; Paid to Yahya 18,690; Yahya Debt 82,750.
  const s = combineYahyaCash(
    AGG({
      payableTotalCost: 64260,
      payableAllocated: 18690,
      paidTotalCost: 0,
      paidAllocated: 0,
      reconciliationPendingTotalCost: 37180,
      nonVoidedTransferTotal: 18690,
    })
  );
  const totalPurchased = 64260 + 0 + 37180;
  assert.equal(totalPurchased, 101440);
  assert.equal(s.actualPaidToYahya, 18690);
  assert.equal(s.payableToYahya, 82750); // 101440 − 18690, pending no longer excluded
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
