// Tests for the pure return-domain rules in lib/returns.ts.
//
// Run: npm test   (tsx --test, Node's built-in test runner — no extra framework)
//
// These exercise the SAME functions the server actions call, so they test real
// production logic. Nothing here touches a database, the network, or the clock.

import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  ReturnChargedTo,
  ReturnInventoryStatus,
  ReturnRefundStatus,
} from '@prisma/client';
import {
  addDelta,
  cumulativeReturnQtyError,
  dispositionBucket,
  dispositionDelta,
  effectiveSaleUnitCost,
  isEligibleForPnl,
  isZeroDelta,
  legacyRefundConflict,
  recoversCogs,
  returnRecoveredCogs,
  saleCogs,
  sellerLossOf,
  transitionPlan,
  validateReturnInput,
  wouldDriveSellableNegative,
  zeroDelta,
  type BucketDelta,
  type Disposition,
  type ReturnValidationInput,
} from '../lib/returns';

const REFUND_STATUSES: ReturnRefundStatus[] = ['PENDING', 'COMPLETED', 'CANCELLED'];
const CHARGED: ReturnChargedTo[] = ['SELLER', 'PLATFORM', 'PENDING'];
const INVENTORY: ReturnInventoryStatus[] = [
  'NOT_RECEIVED',
  'RECEIVED_PENDING_QC',
  'RESTOCKED',
  'DAMAGED',
  'LOST',
];
const BUCKETS: (keyof BucketDelta)[] = [
  'currentStock',
  'returnedStock',
  'damagedStock',
  'lostStock',
];
const DELETED = new Date('2026-07-01T00:00:00Z');

const delta = (p: Partial<BucketDelta> = {}): BucketDelta => ({ ...zeroDelta(), ...p });

// ===========================================================================
// 1. Financial eligibility
// ===========================================================================

test('eligibility: only live COMPLETED + SELLER reduces P&L (all 18 combinations)', () => {
  let eligible = 0;
  for (const refundStatus of REFUND_STATUSES) {
    for (const chargedTo of CHARGED) {
      for (const deletedAt of [null, DELETED]) {
        const expected =
          refundStatus === 'COMPLETED' && chargedTo === 'SELLER' && deletedAt === null;
        const actual = isEligibleForPnl({ refundStatus, chargedTo, deletedAt });
        assert.equal(
          actual,
          expected,
          `${refundStatus} / ${chargedTo} / ${deletedAt ? 'deleted' : 'live'} => expected ${expected}`
        );
        if (actual) eligible++;
      }
    }
  }
  // Exactly one of the 18 combinations may reduce profit.
  assert.equal(eligible, 1);
});

test('eligibility: pending refunds are never a loss', () => {
  for (const chargedTo of CHARGED) {
    assert.equal(
      isEligibleForPnl({ refundStatus: 'PENDING', chargedTo, deletedAt: null }),
      false
    );
  }
});

test('eligibility: cancelled refunds are never a loss', () => {
  for (const chargedTo of CHARGED) {
    assert.equal(
      isEligibleForPnl({ refundStatus: 'CANCELLED', chargedTo, deletedAt: null }),
      false
    );
  }
});

test('eligibility: platform-charged refunds never reduce seller profit', () => {
  for (const refundStatus of REFUND_STATUSES) {
    assert.equal(
      isEligibleForPnl({ refundStatus, chargedTo: 'PLATFORM', deletedAt: null }),
      false
    );
  }
});

test('eligibility: soft-deleting removes a previously eligible refund', () => {
  const base = { refundStatus: 'COMPLETED', chargedTo: 'SELLER' } as const;
  assert.equal(isEligibleForPnl({ ...base, deletedAt: null }), true);
  assert.equal(isEligibleForPnl({ ...base, deletedAt: DELETED }), false);
});

test('sellerLossOf: returns the refund only when eligible, else 0', () => {
  assert.equal(
    sellerLossOf({
      refundStatus: 'COMPLETED',
      chargedTo: 'SELLER',
      deletedAt: null,
      refundAmount: 549,
    }),
    549
  );
  assert.equal(
    sellerLossOf({
      refundStatus: 'COMPLETED',
      chargedTo: 'PLATFORM',
      deletedAt: null,
      refundAmount: 549,
    }),
    0
  );
  assert.equal(
    sellerLossOf({
      refundStatus: 'PENDING',
      chargedTo: 'SELLER',
      deletedAt: null,
      refundAmount: 549,
    }),
    0
  );
  assert.equal(
    sellerLossOf({
      refundStatus: 'COMPLETED',
      chargedTo: 'SELLER',
      deletedAt: DELETED,
      refundAmount: 549,
    }),
    0
  );
});

// ===========================================================================
// 2. Inventory disposition
// ===========================================================================

test('disposition: exact deltas for every inventory status', () => {
  assert.deepEqual(dispositionDelta('NOT_RECEIVED', 5), delta());
  assert.deepEqual(dispositionDelta('RECEIVED_PENDING_QC', 5), delta({ returnedStock: 5 }));
  assert.deepEqual(dispositionDelta('RESTOCKED', 5), delta({ currentStock: 5 }));
  assert.deepEqual(dispositionDelta('DAMAGED', 5), delta({ damagedStock: 5 }));
  assert.deepEqual(dispositionDelta('LOST', 5), delta({ lostStock: 5 }));
});

test('disposition: reversal negates exactly the same bucket', () => {
  assert.deepEqual(dispositionDelta('NOT_RECEIVED', 5, -1), delta());
  assert.deepEqual(
    dispositionDelta('RECEIVED_PENDING_QC', 5, -1),
    delta({ returnedStock: -5 })
  );
  assert.deepEqual(dispositionDelta('RESTOCKED', 5, -1), delta({ currentStock: -5 }));
  assert.deepEqual(dispositionDelta('DAMAGED', 5, -1), delta({ damagedStock: -5 }));
  assert.deepEqual(dispositionDelta('LOST', 5, -1), delta({ lostStock: -5 }));
});

test('disposition: a unit lands in exactly ONE bucket — never two', () => {
  for (const status of INVENTORY) {
    const d = dispositionDelta(status, 7);
    const touched = BUCKETS.filter((b) => d[b] !== 0);
    if (status === 'NOT_RECEIVED') {
      assert.equal(touched.length, 0, 'NOT_RECEIVED must touch no bucket');
    } else {
      assert.equal(touched.length, 1, `${status} touched ${touched.join(', ')}`);
      assert.equal(touched[0], dispositionBucket(status));
      assert.equal(d[touched[0]], 7);
    }
  }
});

test('disposition: RECEIVED_PENDING_QC never adds to sellable stock', () => {
  const d = dispositionDelta('RECEIVED_PENDING_QC', 3);
  assert.equal(d.currentStock, 0);
  assert.equal(d.returnedStock, 3);
});

test('disposition: RESTOCKED does not also bump returnedStock (no double bucket)', () => {
  const d = dispositionDelta('RESTOCKED', 3);
  assert.equal(d.currentStock, 3);
  assert.equal(d.returnedStock, 0);
});

test('disposition: NOT_RECEIVED (incl. "Return Shipped") has zero stock effect', () => {
  assert.ok(isZeroDelta(dispositionDelta('NOT_RECEIVED', 99)));
});

test('disposition: non-positive or fractional quantity yields no effect', () => {
  for (const status of INVENTORY) {
    assert.ok(isZeroDelta(dispositionDelta(status, 0)));
    assert.ok(isZeroDelta(dispositionDelta(status, -4)));
    assert.ok(isZeroDelta(dispositionDelta(status, 2.5)));
  }
});

// ===========================================================================
// 3. Transitions
// ===========================================================================

const disp = (
  inventoryStatus: ReturnInventoryStatus,
  quantity = 4,
  productId: string | null = 'p1',
  storeId: string | null = 's1'
): Disposition => ({ productId, storeId, inventoryStatus, quantity });

test('transition: create applies the new disposition only', () => {
  for (const status of INVENTORY) {
    const plan = transitionPlan(null, disp(status, 4));
    if (status === 'NOT_RECEIVED') {
      assert.equal(plan.length, 0);
    } else {
      assert.equal(plan.length, 1);
      assert.deepEqual(plan[0].delta, dispositionDelta(status, 4));
    }
  }
});

test('transition: every status -> every status nets correctly (25 combinations)', () => {
  for (const from of INVENTORY) {
    for (const to of INVENTORY) {
      const plan = transitionPlan(disp(from, 4), disp(to, 4));
      const expected = addDelta(dispositionDelta(from, 4, -1), dispositionDelta(to, 4, 1));
      const actual = plan[0]?.delta ?? zeroDelta();
      assert.deepEqual(actual, expected, `${from} -> ${to}`);

      if (from === to) {
        // Same disposition in and out cancels to nothing.
        assert.equal(plan.length, 0, `${from} -> ${to} should be a no-op`);
      } else if (from === 'NOT_RECEIVED' || to === 'NOT_RECEIVED') {
        // One side has no effect: exactly one bucket moves.
        const touched = BUCKETS.filter((b) => actual[b] !== 0);
        assert.equal(touched.length, 1, `${from} -> ${to}`);
      } else {
        // Two different real buckets: one drains, the other fills.
        const touched = BUCKETS.filter((b) => actual[b] !== 0);
        assert.equal(touched.length, 2, `${from} -> ${to}`);
        assert.equal(actual[dispositionBucket(from)!], -4);
        assert.equal(actual[dispositionBucket(to)!], 4);
      }
    }
  }
});

test('transition: QC outcome moves the unit out of returnedStock into its final bucket', () => {
  const toRestocked = transitionPlan(disp('RECEIVED_PENDING_QC', 2), disp('RESTOCKED', 2));
  assert.deepEqual(toRestocked[0].delta, delta({ returnedStock: -2, currentStock: 2 }));

  const toDamaged = transitionPlan(disp('RECEIVED_PENDING_QC', 2), disp('DAMAGED', 2));
  assert.deepEqual(toDamaged[0].delta, delta({ returnedStock: -2, damagedStock: 2 }));

  const toLost = transitionPlan(disp('RECEIVED_PENDING_QC', 2), disp('LOST', 2));
  assert.deepEqual(toLost[0].delta, delta({ returnedStock: -2, lostStock: 2 }));
});

test('transition: quantity change on the same status nets to the difference', () => {
  assert.deepEqual(
    transitionPlan(disp('RESTOCKED', 5), disp('RESTOCKED', 3))[0].delta,
    delta({ currentStock: -2 })
  );
  assert.deepEqual(
    transitionPlan(disp('RESTOCKED', 3), disp('RESTOCKED', 5))[0].delta,
    delta({ currentStock: 2 })
  );
  assert.deepEqual(
    transitionPlan(disp('DAMAGED', 1), disp('DAMAGED', 10))[0].delta,
    delta({ damagedStock: 9 })
  );
  // Equal quantities cancel entirely.
  assert.equal(transitionPlan(disp('RESTOCKED', 5), disp('RESTOCKED', 5)).length, 0);
});

test('transition: product change reverses on the old product and applies to the new', () => {
  const plan = transitionPlan(
    disp('RESTOCKED', 4, 'old-product'),
    disp('RESTOCKED', 4, 'new-product')
  );
  assert.equal(plan.length, 2);
  const old = plan.find((p) => p.productId === 'old-product')!;
  const fresh = plan.find((p) => p.productId === 'new-product')!;
  assert.deepEqual(old.delta, delta({ currentStock: -4 }));
  assert.deepEqual(fresh.delta, delta({ currentStock: 4 }));
});

test('transition: product change with different statuses and quantities', () => {
  const plan = transitionPlan(
    disp('RECEIVED_PENDING_QC', 3, 'A'),
    disp('DAMAGED', 5, 'B')
  );
  assert.equal(plan.length, 2);
  assert.deepEqual(
    plan.find((p) => p.productId === 'A')!.delta,
    delta({ returnedStock: -3 })
  );
  assert.deepEqual(
    plan.find((p) => p.productId === 'B')!.delta,
    delta({ damagedStock: 5 })
  );
});

test('transition: store change alone does not move stock', () => {
  const plan = transitionPlan(
    disp('RESTOCKED', 4, 'p1', 'store-A'),
    disp('RESTOCKED', 4, 'p1', 'store-B')
  );
  assert.equal(plan.length, 0);
});

test('transition: an unknown product produces no stock effect', () => {
  assert.equal(transitionPlan(null, disp('RESTOCKED', 4, null)).length, 0);
  assert.equal(transitionPlan(disp('RESTOCKED', 4, null), null).length, 0);
});

test('transition: soft delete reverses whatever the disposition was', () => {
  for (const status of INVENTORY) {
    const plan = transitionPlan(disp(status, 6), null);
    if (status === 'NOT_RECEIVED') {
      assert.equal(plan.length, 0);
    } else {
      assert.deepEqual(plan[0].delta, dispositionDelta(status, 6, -1));
    }
  }
});

test('transition: restore re-applies exactly what delete reversed', () => {
  for (const status of INVENTORY) {
    const d = disp(status, 6);
    const del = transitionPlan(d, null)[0]?.delta ?? zeroDelta();
    const res = transitionPlan(null, d)[0]?.delta ?? zeroDelta();
    // delete + restore must be a round trip back to zero.
    assert.ok(isZeroDelta(addDelta(del, res)), `${status} delete+restore must cancel`);
  }
});

test('transition: negative sellable stock is detected when reversing a RESTOCKED unit', () => {
  const del = transitionPlan(disp('RESTOCKED', 5), null)[0].delta;
  assert.equal(del.currentStock, -5);

  // Unit still on the shelf — reversal is fine.
  assert.equal(wouldDriveSellableNegative(del, 5), false);
  assert.equal(wouldDriveSellableNegative(del, 12), false);
  // Unit was sold — reversal would drive stock negative and must be rejected.
  assert.equal(wouldDriveSellableNegative(del, 4), true);
  assert.equal(wouldDriveSellableNegative(del, 0), true);
});

test('transition: reversing non-sellable buckets never trips the sellable guard', () => {
  for (const status of ['RECEIVED_PENDING_QC', 'DAMAGED', 'LOST'] as const) {
    const del = transitionPlan(disp(status, 5), null)[0].delta;
    assert.equal(del.currentStock, 0);
    assert.equal(wouldDriveSellableNegative(del, 0), false);
  }
});

// ===========================================================================
// 4. Validation
// ===========================================================================

const validInput = (o: Partial<ReturnValidationInput> = {}): ReturnValidationInput => ({
  returnItemId: 'RI-1',
  returnOrderId: null,
  orderItemId: null,
  returnDate: new Date('2026-07-11T00:00:00Z'),
  orderDate: null,
  receivedAt: null,
  quantity: 1,
  paidAmount: 549,
  refundAmount: 549,
  unitCost: null,
  inventoryStatus: 'NOT_RECEIVED',
  productId: 'p1',
  ...o,
});

test('validation: a well-formed input passes', () => {
  assert.equal(validateReturnInput(validInput()), null);
});

test('validation: identity requires returnItemId OR (returnOrderId AND orderItemId)', () => {
  // returnItemId alone — ok
  assert.equal(validateReturnInput(validInput({ returnItemId: 'RI-1' })), null);
  // both order-level ids — ok
  assert.equal(
    validateReturnInput(
      validInput({ returnItemId: null, returnOrderId: 'RO-1', orderItemId: 'OI-1' })
    ),
    null
  );
  // nothing — rejected
  assert.match(
    validateReturnInput(
      validInput({ returnItemId: null, returnOrderId: null, orderItemId: null })
    )!,
    /Return Item ID/
  );
  // only returnOrderId — rejected
  assert.match(
    validateReturnInput(
      validInput({ returnItemId: null, returnOrderId: 'RO-1', orderItemId: null })
    )!,
    /Return Item ID/
  );
  // only orderItemId — rejected
  assert.match(
    validateReturnInput(
      validInput({ returnItemId: null, returnOrderId: null, orderItemId: 'OI-1' })
    )!,
    /Return Item ID/
  );
});

test('validation: receivedAt is required for received / restocked / damaged', () => {
  for (const inventoryStatus of ['RECEIVED_PENDING_QC', 'RESTOCKED', 'DAMAGED'] as const) {
    assert.match(
      validateReturnInput(validInput({ inventoryStatus, receivedAt: null }))!,
      /received date is required/i,
      inventoryStatus
    );
    assert.equal(
      validateReturnInput(
        validInput({ inventoryStatus, receivedAt: new Date('2026-07-12T00:00:00Z') })
      ),
      null,
      inventoryStatus
    );
  }
});

test('validation: LOST does not require a received date (it never arrived)', () => {
  assert.equal(
    validateReturnInput(validInput({ inventoryStatus: 'LOST', receivedAt: null })),
    null
  );
});

test('validation: NOT_RECEIVED must not carry a received date', () => {
  assert.match(
    validateReturnInput(
      validInput({
        inventoryStatus: 'NOT_RECEIVED',
        receivedAt: new Date('2026-07-12T00:00:00Z'),
      })
    )!,
    /cannot be “not received” and have a received date/
  );
});

test('validation: quantity must be a positive integer', () => {
  for (const quantity of [0, -1, -10, 1.5, NaN]) {
    assert.match(
      validateReturnInput(validInput({ quantity }))!,
      /whole number greater than zero/,
      `quantity=${quantity}`
    );
  }
  assert.equal(validateReturnInput(validInput({ quantity: 1 })), null);
  assert.equal(validateReturnInput(validInput({ quantity: 25 })), null);
});

test('validation: monetary amounts must be non-negative', () => {
  assert.match(validateReturnInput(validInput({ paidAmount: -1 }))!, /Paid amount/);
  assert.match(validateReturnInput(validInput({ refundAmount: -0.5 }))!, /Refund amount/);
  // Zero is allowed — a return can exist before the refund amount is known.
  assert.equal(validateReturnInput(validInput({ paidAmount: 0, refundAmount: 0 })), null);
});

test('validation: dates must be real dates', () => {
  assert.match(validateReturnInput(validInput({ returnDate: null }))!, /required/);
  assert.match(
    validateReturnInput(validInput({ returnDate: new Date('nope') }))!,
    /not a valid date/
  );
  assert.match(
    validateReturnInput(validInput({ orderDate: new Date('nope') }))!,
    /Order date is not a valid date/
  );
  assert.match(
    validateReturnInput(
      validInput({ inventoryStatus: 'DAMAGED', receivedAt: new Date('nope') })
    )!,
    /Received date is not a valid date/
  );
});

test('validation: a physical inventory status requires a known product', () => {
  for (const inventoryStatus of [
    'RECEIVED_PENDING_QC',
    'RESTOCKED',
    'DAMAGED',
    'LOST',
  ] as const) {
    assert.match(
      validateReturnInput(
        validInput({
          inventoryStatus,
          productId: null,
          receivedAt: new Date('2026-07-12T00:00:00Z'),
        })
      )!,
      /Select the product/,
      inventoryStatus
    );
  }
  // NOT_RECEIVED may legitimately have an unknown product.
  assert.equal(
    validateReturnInput(validInput({ inventoryStatus: 'NOT_RECEIVED', productId: null })),
    null
  );
});

// ===========================================================================
// 5. Legacy refund double-count defence
// ===========================================================================

test('legacy conflict: blocks a COMPLETED + SELLER return on a sale with a legacy refund', () => {
  const msg = legacyRefundConflict({
    refundStatus: 'COMPLETED',
    chargedTo: 'SELLER',
    linkedSaleLegacyRefund: 549,
  });
  assert.ok(msg);
  assert.match(msg!, /counted twice/);
  assert.match(msg!, /549\.00/);
});

test('legacy conflict: allows non-eligible returns even on a sale with a legacy refund', () => {
  // Not completed → not counted in P&L → cannot double-count.
  assert.equal(
    legacyRefundConflict({
      refundStatus: 'PENDING',
      chargedTo: 'SELLER',
      linkedSaleLegacyRefund: 549,
    }),
    null
  );
  assert.equal(
    legacyRefundConflict({
      refundStatus: 'CANCELLED',
      chargedTo: 'SELLER',
      linkedSaleLegacyRefund: 549,
    }),
    null
  );
  // Platform-charged → not our loss → cannot double-count.
  assert.equal(
    legacyRefundConflict({
      refundStatus: 'COMPLETED',
      chargedTo: 'PLATFORM',
      linkedSaleLegacyRefund: 549,
    }),
    null
  );
});

test('legacy conflict: no conflict when the sale has no legacy refund', () => {
  assert.equal(
    legacyRefundConflict({
      refundStatus: 'COMPLETED',
      chargedTo: 'SELLER',
      linkedSaleLegacyRefund: 0,
    }),
    null
  );
});

test('legacy conflict: unlinked returns cannot be checked (null) — safety comes from the locked field', () => {
  assert.equal(
    legacyRefundConflict({
      refundStatus: 'COMPLETED',
      chargedTo: 'SELLER',
      linkedSaleLegacyRefund: null,
    }),
    null
  );
});

// ===========================================================================
// 6. P&L composition — the summed formula
// ===========================================================================

test('validation: unit cost cannot be negative', () => {
  assert.match(validateReturnInput(validInput({ unitCost: -1 }))!, /Cost per unit/);
  assert.equal(validateReturnInput(validInput({ unitCost: 0 })), null);
  assert.equal(validateReturnInput(validInput({ unitCost: 170 })), null);
  assert.equal(validateReturnInput(validInput({ unitCost: null })), null);
});

// ===========================================================================
// 7. Sale cost snapshot stability
// ===========================================================================

test('sale COGS: snapshot is stable when Product.purchaseCost later changes', () => {
  // Sold 3 units at a snapshotted cost of 170.
  const sale = { quantitySold: 3, unitCost: 170 };
  // The product's purchaseCost drifts to 250 afterward — COGS must not move.
  assert.equal(saleCogs({ ...sale, productPurchaseCost: 250 }), 510);
  assert.equal(saleCogs({ ...sale, productPurchaseCost: 999 }), 510);
  assert.equal(saleCogs({ ...sale, productPurchaseCost: 0 }), 510);
});

test('sale COGS: legacy null snapshot falls back to current product cost', () => {
  assert.equal(saleCogs({ quantitySold: 4, unitCost: null, productPurchaseCost: 60 }), 240);
  // And a later cost change DOES move a legacy row (that is the fallback's nature).
  assert.equal(saleCogs({ quantitySold: 4, unitCost: null, productPurchaseCost: 90 }), 360);
  // Missing product cost too → 0, never NaN.
  assert.equal(saleCogs({ quantitySold: 4, unitCost: null, productPurchaseCost: null }), 0);
});

test('effectiveSaleUnitCost: snapshot wins, else product cost, else 0', () => {
  assert.equal(effectiveSaleUnitCost(170, 250), 170); // snapshot wins
  assert.equal(effectiveSaleUnitCost(0, 250), 0); // zero snapshot is a real value, not "missing"
  assert.equal(effectiveSaleUnitCost(null, 250), 250); // fallback
  assert.equal(effectiveSaleUnitCost(null, null), 0); // last resort
});

// ===========================================================================
// 8. COGS recovery
// ===========================================================================

test('recovery: only RESTOCKED recovers COGS; the other four recover zero', () => {
  const base = { deletedAt: null, quantity: 2, unitCost: 170 };
  assert.equal(returnRecoveredCogs({ ...base, inventoryStatus: 'RESTOCKED' }), 340);
  for (const inventoryStatus of [
    'NOT_RECEIVED',
    'RECEIVED_PENDING_QC',
    'DAMAGED',
    'LOST',
  ] as const) {
    assert.equal(
      returnRecoveredCogs({ ...base, inventoryStatus }),
      0,
      `${inventoryStatus} must recover 0`
    );
    assert.equal(recoversCogs({ inventoryStatus, deletedAt: null }), false);
  }
  assert.equal(recoversCogs({ inventoryStatus: 'RESTOCKED', deletedAt: null }), true);
});

test('recovery: soft-deleted restocked returns recover zero', () => {
  assert.equal(
    returnRecoveredCogs({
      inventoryStatus: 'RESTOCKED',
      deletedAt: DELETED,
      quantity: 2,
      unitCost: 170,
    }),
    0
  );
  assert.equal(recoversCogs({ inventoryStatus: 'RESTOCKED', deletedAt: DELETED }), false);
});

test('recovery: delete removes it and restore reinstates it (financial round trip)', () => {
  const live = {
    inventoryStatus: 'RESTOCKED' as const,
    quantity: 3,
    unitCost: 170,
    deletedAt: null as Date | null,
  };
  const recovered = returnRecoveredCogs(live);
  assert.equal(recovered, 510);
  // Soft delete → recovery drops to 0.
  assert.equal(returnRecoveredCogs({ ...live, deletedAt: DELETED }), 0);
  // Restore → deletedAt back to null → recovery reinstated.
  assert.equal(returnRecoveredCogs({ ...live, deletedAt: null }), recovered);
});

test('recovery: uses the snapshotted unitCost, stable against product cost change', () => {
  assert.equal(
    returnRecoveredCogs({
      inventoryStatus: 'RESTOCKED',
      deletedAt: null,
      quantity: 2,
      unitCost: 170,
      productPurchaseCost: 999, // drifted — must be ignored
    }),
    340
  );
});

test('recovery: legacy null unitCost falls back to product cost', () => {
  assert.equal(
    returnRecoveredCogs({
      inventoryStatus: 'RESTOCKED',
      deletedAt: null,
      quantity: 2,
      unitCost: null,
      productPurchaseCost: 140,
    }),
    280
  );
});

test('recovery: refund eligibility and COGS recovery are independent', () => {
  // A restocked unit whose refund is PLATFORM-charged recovers COGS...
  const platformRestock = {
    inventoryStatus: 'RESTOCKED' as const,
    deletedAt: null,
    quantity: 1,
    unitCost: 200,
  };
  assert.equal(returnRecoveredCogs(platformRestock), 200);
  // ...even though it is NOT a seller loss.
  assert.equal(
    isEligibleForPnl({ refundStatus: 'COMPLETED', chargedTo: 'PLATFORM', deletedAt: null }),
    false
  );
  // Conversely: a seller-charged, completed refund that is DAMAGED (not restocked)
  // reduces profit but recovers NO COGS.
  assert.equal(
    isEligibleForPnl({ refundStatus: 'COMPLETED', chargedTo: 'SELLER', deletedAt: null }),
    true
  );
  assert.equal(
    returnRecoveredCogs({
      inventoryStatus: 'DAMAGED',
      deletedAt: null,
      quantity: 1,
      unitCost: 200,
    }),
    0
  );
});

test('P&L: netProductCost = salesCOGS − recoveredCOGS (period-consistent)', () => {
  const sales = [
    { quantitySold: 3, unitCost: 170 }, // 510
    { quantitySold: 2, unitCost: 140 }, // 280
  ];
  const salesCOGS = sales.reduce((s, x) => s + saleCogs(x), 0);
  assert.equal(salesCOGS, 790);

  const returns = [
    { inventoryStatus: 'RESTOCKED', deletedAt: null, quantity: 1, unitCost: 170 }, // 170
    { inventoryStatus: 'DAMAGED', deletedAt: null, quantity: 1, unitCost: 170 }, // 0
    { inventoryStatus: 'RESTOCKED', deletedAt: DELETED, quantity: 1, unitCost: 170 }, // 0
  ] as const;
  const recoveredCOGS = returns.reduce((s, r) => s + returnRecoveredCogs(r), 0);
  assert.equal(recoveredCOGS, 170);

  assert.equal(salesCOGS - recoveredCOGS, 620); // netProductCost
});

// ===========================================================================
// 9. Cumulative linked return quantity
// ===========================================================================

test('cumulative: a single return within the sold quantity is allowed', () => {
  assert.equal(
    cumulativeReturnQtyError({
      quantitySold: 5,
      otherLinkedLiveQuantities: [],
      thisQuantity: 3,
    }),
    null
  );
  // Exactly equal is allowed (all units returned).
  assert.equal(
    cumulativeReturnQtyError({
      quantitySold: 5,
      otherLinkedLiveQuantities: [],
      thisQuantity: 5,
    }),
    null
  );
});

test('cumulative: total returned quantity cannot exceed quantity sold', () => {
  const msg = cumulativeReturnQtyError({
    quantitySold: 5,
    otherLinkedLiveQuantities: [3],
    thisQuantity: 3, // 3 + 3 = 6 > 5
  });
  assert.ok(msg);
  assert.match(msg!, /only 5 unit/);
  assert.match(msg!, /already returned on this sale: 3/);
});

test('cumulative: existing linked returns accumulate', () => {
  // 2 + 1 already returned, adding 2 → 5 == sold 5, allowed.
  assert.equal(
    cumulativeReturnQtyError({
      quantitySold: 5,
      otherLinkedLiveQuantities: [2, 1],
      thisQuantity: 2,
    }),
    null
  );
  // ...adding 3 → 6 > 5, rejected.
  assert.ok(
    cumulativeReturnQtyError({
      quantitySold: 5,
      otherLinkedLiveQuantities: [2, 1],
      thisQuantity: 3,
    })
  );
});

test('cumulative: editing excludes the current return from the total', () => {
  // Sale sold 3. This return already counts 3. On edit, the caller passes the
  // OTHER live returns (excluding this one) — so 0 others + 3 = 3 is fine.
  assert.equal(
    cumulativeReturnQtyError({
      quantitySold: 3,
      otherLinkedLiveQuantities: [], // current return excluded by the caller
      thisQuantity: 3,
    }),
    null
  );
  // If it were NOT excluded (3 others + 3), it would wrongly fail — proving the
  // exclusion matters.
  assert.ok(
    cumulativeReturnQtyError({
      quantitySold: 3,
      otherLinkedLiveQuantities: [3],
      thisQuantity: 3,
    })
  );
});

test('P&L: total = legacy sale refunds + eligible return refunds only', () => {
  const returns = [
    { refundStatus: 'COMPLETED', chargedTo: 'SELLER', deletedAt: null, refundAmount: 448 },
    { refundStatus: 'COMPLETED', chargedTo: 'SELLER', deletedAt: null, refundAmount: 378 },
    { refundStatus: 'COMPLETED', chargedTo: 'PLATFORM', deletedAt: null, refundAmount: 500 },
    { refundStatus: 'PENDING', chargedTo: 'SELLER', deletedAt: null, refundAmount: 549 },
    { refundStatus: 'CANCELLED', chargedTo: 'SELLER', deletedAt: null, refundAmount: 999 },
    { refundStatus: 'COMPLETED', chargedTo: 'SELLER', deletedAt: DELETED, refundAmount: 700 },
  ] as const;

  const eligible = returns.reduce((sum, r) => sum + sellerLossOf(r), 0);
  assert.equal(eligible, 448 + 378); // 826 — platform/pending/cancelled/deleted excluded

  const legacySaleRefunds = 0; // production currently has none
  assert.equal(legacySaleRefunds + eligible, 826);
});
