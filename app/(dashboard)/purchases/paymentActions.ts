'use server';

import { revalidatePath } from 'next/cache';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { str, num } from '@/lib/utils';
import { type FormState, ok, fail } from '@/lib/formState';
import { presentationWriteBlock, assertPresentationReadOnly } from '@/lib/presentation/guard';
import { allocateFifo, planStatusUpdates, round2, type FifoPurchase } from '@/lib/yahyaPayments';

type Tx = Prisma.TransactionClient;

/**
 * Recompute and persist paymentStatus for the given purchases from their
 * non-voided allocations. RECONCILIATION_PENDING purchases are never touched.
 *
 * Bulk: one `findMany` for all purchases, then at most one `updateMany` per
 * target status — a constant number of round-trips regardless of how many
 * purchases a payment spans (the old per-purchase loop did 2×N round-trips,
 * which timed out over the remote pooler for multi-purchase FIFO payments).
 */
async function recomputePurchaseStatuses(tx: Tx, purchaseIds: string[]) {
  const ids = [...new Set(purchaseIds)];
  if (ids.length === 0) return;

  // Select ALL allocation rows (with their payment's voided flag) so we can
  // tell a legacy PAID purchase (no allocations ever) from one that was paid via
  // allocations and later voided (rows exist but now total 0).
  const purchases = await tx.purchase.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      totalCost: true,
      paymentStatus: true,
      paymentAllocations: { select: { amount: true, payment: { select: { voided: true } } } },
    },
  });

  const updates = planStatusUpdates(
    purchases.map((p) => ({
      id: p.id,
      paymentStatus: p.paymentStatus,
      totalCost: p.totalCost,
      allocatedAmount: p.paymentAllocations
        .filter((a) => !a.payment.voided)
        .reduce((s, a) => s + a.amount, 0),
      hasAllocations: p.paymentAllocations.length > 0,
    }))
  );

  for (const u of updates) {
    await tx.purchase.updateMany({ where: { id: { in: u.ids } }, data: { paymentStatus: u.status } });
  }
}


/**
 * Record one real bank transfer to Yahya. The user enters only the payment
 * details (date, amount, bank, reference, notes); the amount is allocated
 * automatically FIFO across the oldest eligible UNPAID / PARTIALLY_PAID
 * purchases in the background — no purchase selection. A payment greater than
 * the total payable is rejected. RECONCILIATION_PENDING and PAID purchases are
 * never allocated. Atomic: payment + allocations + status recompute commit
 * together, or nothing does. Payment and its automatic allocations are audited.
 */
export async function recordYahyaPayment(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const blocked = await presentationWriteBlock();
  if (blocked) return blocked;
  const user = await requireUser();

  const dateStr = str(formData.get('date'));
  const amount = round2(num(formData.get('amount')));
  const bankAccount = str(formData.get('bankAccount'));
  const bankReference = str(formData.get('bankReference'));
  const notes = str(formData.get('notes'));

  if (!dateStr) return fail('Payment date is required.');
  if (!(amount > 0)) return fail('Payment amount must be greater than zero.');

  // Eligible purchases, oldest first. UNPAID, PARTIALLY_PAID and
  // RECONCILIATION_PENDING are all part of the debt and can be settled; only
  // PAID is excluded. Remaining is computed from non-voided allocations, so an
  // untouched RECONCILIATION_PENDING purchase offers its full totalCost.
  const eligible = await prisma.purchase.findMany({
    where: {
      deletedAt: null,
      paymentStatus: { in: ['UNPAID', 'PARTIALLY_PAID', 'RECONCILIATION_PENDING'] },
    },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      totalCost: true,
      paymentAllocations: { where: { payment: { voided: false } }, select: { amount: true } },
    },
  });
  const fifoPurchases: FifoPurchase[] = eligible
    .map((p) => ({
      purchaseId: p.id,
      remaining: round2(Math.max(0, p.totalCost - p.paymentAllocations.reduce((s, a) => s + a.amount, 0))),
    }))
    .filter((p) => p.remaining > 0);

  const fifo = allocateFifo(amount, fifoPurchases);
  if (!fifo.ok) return fail(fifo.error!);

  // Defence in depth: the exact-allocation invariant must hold before writing.
  const allocTotal = round2(fifo.allocations.reduce((s, a) => s + a.amount, 0));
  if (allocTotal !== amount || fifo.allocations.length === 0) {
    return fail('Automatic allocation failed to balance — nothing was written.');
  }
  const ids = fifo.allocations.map((a) => a.purchaseId);

  try {
    const paymentId = await prisma.$transaction(async (tx) => {
      const payment = await tx.yahyaPayment.create({
        data: {
          date: new Date(dateStr),
          amount,
          bankAccount: bankAccount || null,
          bankReference: bankReference || null,
          notes: notes || null,
          createdById: user.id,
          createdBy: user.name,
        },
      });
      await tx.yahyaPaymentAllocation.createMany({
        data: fifo.allocations.map((a) => ({
          paymentId: payment.id,
          purchaseId: a.purchaseId,
          amount: a.amount,
        })),
      });
      await recomputePurchaseStatuses(tx, ids);
      return payment.id;
      // Generous limits: the remote pooler has high per-round-trip latency, and
      // the default 5s interactive-transaction timeout is too small.
    }, { timeout: 120_000, maxWait: 20_000 });

    await logAudit({
      user,
      action: 'CREATE',
      module: 'YahyaPayment',
      recordId: paymentId,
      newValue: {
        date: dateStr,
        amount,
        bankReference: bankReference || null,
        method: 'FIFO-auto',
        allocations: fifo.allocations.map((a) => ({ purchaseId: a.purchaseId, amount: a.amount })),
        affectedPurchaseIds: ids,
      },
    });
    revalidatePath('/purchases');
    return ok('Payment recorded and auto-allocated (FIFO).');
  } catch (e) {
    // Surface the real error to server logs instead of swallowing it.
    console.error('[recordYahyaPayment] failed', e);
    return fail('Could not record the payment — nothing was written.');
  }
}

/** Edit a payment's metadata only (date / bank / reference / notes). Amount and
 *  allocations are immutable — to change them, void and re-record. */
export async function editYahyaPayment(_prev: FormState, formData: FormData): Promise<FormState> {
  const blocked = await presentationWriteBlock();
  if (blocked) return blocked;
  const user = await requireUser();
  const id = str(formData.get('id'));
  if (!id) return fail('Missing payment id.');

  const before = await prisma.yahyaPayment.findUnique({ where: { id } });
  if (!before) return fail('Payment not found.');
  if (before.voided) return fail('A voided payment cannot be edited.');

  const dateStr = str(formData.get('date'));
  const bankAccount = str(formData.get('bankAccount'));
  const bankReference = str(formData.get('bankReference'));
  const notes = str(formData.get('notes'));
  if (!dateStr) return fail('Payment date is required.');

  await prisma.yahyaPayment.update({
    where: { id },
    data: {
      date: new Date(dateStr),
      bankAccount: bankAccount || null,
      bankReference: bankReference || null,
      notes: notes || null,
    },
  });
  await logAudit({
    user,
    action: 'UPDATE',
    module: 'YahyaPayment',
    recordId: id,
    oldValue: { date: before.date, bankReference: before.bankReference, notes: before.notes },
    newValue: { date: dateStr, bankReference: bankReference || null, notes: notes || null },
  });
  revalidatePath('/purchases');
  return ok('Payment updated.');
}

/** Void a payment: it stops counting, and every purchase it touched has its
 *  status recomputed (reverting toward UNPAID / PARTIALLY_PAID). Never deletes. */
export async function voidYahyaPayment(formData: FormData) {
  await assertPresentationReadOnly();
  const user = await requireUser();
  const id = str(formData.get('id'));
  const voidReason = str(formData.get('voidReason'));
  if (!id) return;

  const payment = await prisma.yahyaPayment.findUnique({
    where: { id },
    select: { id: true, voided: true, amount: true, allocations: { select: { purchaseId: true } } },
  });
  if (!payment || payment.voided) return;
  const affected = payment.allocations.map((a) => a.purchaseId);

  await prisma.$transaction(
    async (tx) => {
      await tx.yahyaPayment.update({
        where: { id },
        data: { voided: true, voidedAt: new Date(), voidReason: voidReason || null },
      });
      await recomputePurchaseStatuses(tx, affected);
    },
    { timeout: 120_000, maxWait: 20_000 }
  );

  await logAudit({
    user,
    action: 'UPDATE',
    module: 'YahyaPayment',
    recordId: id,
    oldValue: { voided: false, amount: payment.amount },
    newValue: { voided: true, voidReason: voidReason || null, affectedPurchaseIds: affected },
  });
  revalidatePath('/purchases');
}
