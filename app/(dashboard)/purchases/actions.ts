'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { recordMovement } from '@/lib/stock';
import { str, num, int } from '@/lib/utils';
import { type FormState, ok, fail } from '@/lib/formState';

export async function savePurchase(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const user = await requireUser();
  const id = str(formData.get('id'));
  const dateStr = str(formData.get('date'));
  const purchasedBy = str(formData.get('purchasedBy')) ?? 'Yahya';
  const storeId = str(formData.get('storeId'));
  const productId = str(formData.get('productId'));
  const quantity = int(formData.get('quantity'));
  const unitCost = num(formData.get('unitCost'));
  const paymentStatus = (str(formData.get('paymentStatus')) ?? 'UNPAID') as
    | 'PAID'
    | 'UNPAID'
    | 'RECONCILIATION_PENDING';
  const reimbursementDate = str(formData.get('reimbursementDate'));
  const bankReference = str(formData.get('bankReference'));
  const invoiceUrl = str(formData.get('invoiceUrl'));
  const notes = str(formData.get('notes'));

  if (!productId) return fail('Choose a product.');
  if (!dateStr) return fail('Purchase date is required.');
  if (quantity <= 0) return fail('Quantity must be greater than zero.');

  const date = new Date(dateStr);
  const totalCost = quantity * unitCost;

  try {
    if (id) {
      const before = await prisma.purchase.findUnique({ where: { id } });
      if (!before) return fail('Purchase not found.');
      await prisma.$transaction(async (tx) => {
        const updated = await tx.purchase.update({
          where: { id },
          data: {
            date,
            purchasedBy,
            storeId,
            productId,
            quantity,
            unitCost,
            totalCost,
            paymentStatus,
            reimbursementDate: reimbursementDate ? new Date(reimbursementDate) : null,
            bankReference,
            invoiceUrl,
            notes,
          },
        });
        // Reverse the old stock effect, apply the new one.
        if (before.productId === productId) {
          const delta = quantity - before.quantity;
          if (delta !== 0) {
            await recordMovement(tx, {
              productId,
              storeId,
              type: 'PURCHASE',
              quantity: delta,
              reference: id,
              note: 'Purchase edited',
              user,
            });
          }
        } else {
          await recordMovement(tx, {
            productId: before.productId,
            type: 'PURCHASE',
            quantity: -before.quantity,
            reference: id,
            note: 'Purchase product changed',
            user,
          });
          await recordMovement(tx, {
            productId,
            storeId,
            type: 'PURCHASE',
            quantity,
            reference: id,
            note: 'Purchase product changed',
            user,
          });
        }
        return updated;
      });
      await logAudit({
        user,
        action: 'UPDATE',
        module: 'Purchases',
        recordId: id,
        oldValue: before,
        newValue: { date, productId, quantity, unitCost, totalCost, paymentStatus },
      });
    } else {
      const created = await prisma.$transaction(async (tx) => {
        const p = await tx.purchase.create({
          data: {
            date,
            purchasedBy,
            storeId,
            productId,
            quantity,
            unitCost,
            totalCost,
            paymentStatus,
            reimbursementDate: reimbursementDate ? new Date(reimbursementDate) : null,
            bankReference,
            invoiceUrl,
            notes,
            createdById: user.id,
            createdBy: user.name,
          },
        });
        await recordMovement(tx, {
          productId,
          storeId,
          type: 'PURCHASE',
          quantity,
          reference: p.id,
          note: `Purchase from ${purchasedBy}`,
          user,
        });
        return p;
      });
      await logAudit({
        user,
        action: 'CREATE',
        module: 'Purchases',
        recordId: created.id,
        newValue: created,
      });
    }
    revalidatePath('/purchases');
    revalidatePath('/products');
    return ok();
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Failed to save purchase.');
  }
}

export async function deletePurchase(formData: FormData) {
  const user = await requireUser();
  const id = str(formData.get('id'));
  if (!id) return;
  const before = await prisma.purchase.findUnique({ where: { id } });
  if (!before || before.deletedAt) return;
  await prisma.$transaction(async (tx) => {
    await tx.purchase.update({ where: { id }, data: { deletedAt: new Date() } });
    // Reverse the stock that was added.
    await recordMovement(tx, {
      productId: before.productId,
      type: 'PURCHASE',
      quantity: -before.quantity,
      reference: id,
      note: 'Purchase deleted',
      user,
    });
  });
  await logAudit({
    user,
    action: 'DELETE',
    module: 'Purchases',
    recordId: id,
    oldValue: before,
  });
  revalidatePath('/purchases');
  revalidatePath('/products');
}
