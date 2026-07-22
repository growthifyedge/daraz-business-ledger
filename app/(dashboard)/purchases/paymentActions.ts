'use server';

import { revalidatePath } from 'next/cache';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { str, num } from '@/lib/utils';
import { type FormState, ok, fail } from '@/lib/formState';
import {
  validateAllocations,
  deriveStatus,
  round2,
  type AllocationInput,
  type AllocationTarget,
} from '@/lib/yahyaPayments';

type Tx = Prisma.TransactionClient;

/** Recompute and persist paymentStatus for the given purchases from their
 *  non-voided allocations. RECONCILIATION_PENDING purchases are never touched. */
async function recomputePurchaseStatuses(tx: Tx, purchaseIds: string[]) {
  for (const id of [...new Set(purchaseIds)]) {
    const p = await tx.purchase.findUnique({
      where: { id },
      select: {
        id: true,
        totalCost: true,
        paymentStatus: true,
        paymentAllocations: {
          where: { payment: { voided: false } },
          select: { amount: true },
        },
      },
    });
    if (!p || p.paymentStatus === 'RECONCILIATION_PENDING') continue;
    const allocatedAmount = p.paymentAllocations.reduce((s, a) => s + a.amount, 0);
    const next = deriveStatus({
      paymentStatus: p.paymentStatus,
      totalCost: p.totalCost,
      allocatedAmount,
    });
    if (next !== p.paymentStatus) {
      await tx.purchase.update({ where: { id }, data: { paymentStatus: next } });
    }
  }
}

function parseAllocations(raw: string): AllocationInput[] | null {
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return null;
    return arr.map((a) => ({ purchaseId: String(a.purchaseId), amount: round2(Number(a.amount)) }));
  } catch {
    return null;
  }
}

/**
 * Record one real bank transfer to Yahya and allocate it across one or more
 * UNPAID / PARTIALLY_PAID purchases. The payment MUST be fully allocated
 * (Σ allocations == amount). Atomic: payment + allocations + status recompute
 * all commit together, or nothing does. RECONCILIATION_PENDING and PAID
 * purchases can never be targeted.
 */
export async function recordYahyaPayment(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const user = await requireUser();

  const dateStr = str(formData.get('date'));
  const amount = round2(num(formData.get('amount')));
  const bankAccount = str(formData.get('bankAccount'));
  const bankReference = str(formData.get('bankReference'));
  const notes = str(formData.get('notes'));
  const allocations = parseAllocations(str(formData.get('allocations')) ?? '[]');

  if (!dateStr) return fail('Payment date is required.');
  if (!(amount > 0)) return fail('Payment amount must be greater than zero.');
  if (!allocations) return fail('Could not read the allocations.');

  // Load the targeted purchases and their CURRENT remaining balances.
  const ids = allocations.map((a) => a.purchaseId);
  const purchases = await prisma.purchase.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: {
      id: true,
      totalCost: true,
      paymentStatus: true,
      paymentAllocations: { where: { payment: { voided: false } }, select: { amount: true } },
    },
  });
  const targets: AllocationTarget[] = purchases.map((p) => {
    const allocated = p.paymentAllocations.reduce((s, a) => s + a.amount, 0);
    return {
      purchaseId: p.id,
      status: p.paymentStatus,
      remaining: round2(Math.max(0, p.totalCost - (allocated > 0 ? allocated : p.paymentStatus === 'PAID' ? p.totalCost : 0))),
    };
  });

  const v = validateAllocations(amount, allocations, targets);
  if (!v.ok) return fail(v.error!);

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
        data: allocations.map((a) => ({
          paymentId: payment.id,
          purchaseId: a.purchaseId,
          amount: a.amount,
        })),
      });
      await recomputePurchaseStatuses(tx, ids);
      return payment.id;
    });

    await logAudit({
      user,
      action: 'CREATE',
      module: 'YahyaPayment',
      recordId: paymentId,
      newValue: {
        date: dateStr,
        amount,
        bankReference: bankReference || null,
        allocations: allocations.map((a) => ({ purchaseId: a.purchaseId, amount: a.amount })),
        affectedPurchaseIds: ids,
      },
    });
    revalidatePath('/purchases');
    return ok('Payment recorded and allocated.');
  } catch {
    return fail('Could not record the payment — nothing was written.');
  }
}

/** Edit a payment's metadata only (date / bank / reference / notes). Amount and
 *  allocations are immutable — to change them, void and re-record. */
export async function editYahyaPayment(_prev: FormState, formData: FormData): Promise<FormState> {
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

  await prisma.$transaction(async (tx) => {
    await tx.yahyaPayment.update({
      where: { id },
      data: { voided: true, voidedAt: new Date(), voidReason: voidReason || null },
    });
    await recomputePurchaseStatuses(tx, affected);
  });

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
