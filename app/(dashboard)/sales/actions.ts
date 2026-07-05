'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { recordMovement, INSUFFICIENT_STOCK } from '@/lib/stock';
import { str, num, int } from '@/lib/utils';
import { type FormState, ok, fail } from '@/lib/formState';

/** Format an insufficient-stock message. */
function shortMsg(name: string, available: number) {
  return `Not enough stock: only ${available} unit(s) of ${name} available.`;
}

export async function saveSale(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const user = await requireUser();
  const id = str(formData.get('id'));
  const dateStr = str(formData.get('date'));
  const storeId = str(formData.get('storeId'));
  const productId = str(formData.get('productId'));
  const quantitySold = int(formData.get('quantitySold'));
  const grossAmount = num(formData.get('grossAmount'));
  const commission = num(formData.get('commission'));
  const vat = num(formData.get('vat'));
  const otherCharges = num(formData.get('otherCharges'));
  const returnsRefunds = num(formData.get('returnsRefunds'));
  const notes = str(formData.get('notes'));

  if (!productId) return fail('Choose a product.');
  if (!dateStr) return fail('Sale date is required.');
  if (quantitySold <= 0) return fail('Quantity sold must be greater than zero.');

  const date = new Date(dateStr);
  const netAmount = grossAmount - commission - vat - otherCharges - returnsRefunds;

  try {
    if (id) {
      const before = await prisma.sale.findUnique({ where: { id } });
      if (!before) return fail('Sale not found.');

      // Pre-check stock so the user gets a clear message before we mutate.
      const target = await prisma.product.findUnique({
        where: { id: productId },
        select: { name: true, currentStock: true },
      });
      if (!target) return fail('Product not found.');
      if (before.productId === productId) {
        const additional = quantitySold - before.quantitySold; // extra units needed
        if (additional > 0 && additional > target.currentStock) {
          return fail(shortMsg(target.name, target.currentStock));
        }
      } else if (quantitySold > target.currentStock) {
        return fail(shortMsg(target.name, target.currentStock));
      }

      await prisma.$transaction(async (tx) => {
        await tx.sale.update({
          where: { id },
          data: {
            date,
            storeId,
            productId,
            quantitySold,
            grossAmount,
            commission,
            vat,
            otherCharges,
            returnsRefunds,
            netAmount,
            notes,
          },
        });
        // Adjust stock for the change (sales reduce stock).
        if (before.productId === productId) {
          const delta = -(quantitySold - before.quantitySold);
          if (delta !== 0) {
            await recordMovement(tx, {
              productId,
              storeId,
              type: 'SALE',
              quantity: delta,
              reference: id,
              note: 'Sale edited',
              user,
              guard: delta < 0, // only guard when it reduces stock
            });
          }
        } else {
          await recordMovement(tx, {
            productId: before.productId,
            type: 'SALE',
            quantity: before.quantitySold, // return old product's stock
            reference: id,
            note: 'Sale product changed',
            user,
          });
          await recordMovement(tx, {
            productId,
            storeId,
            type: 'SALE',
            quantity: -quantitySold,
            reference: id,
            note: 'Sale product changed',
            user,
            guard: true,
          });
        }
      });
      await logAudit({
        user,
        action: 'UPDATE',
        module: 'Sales',
        recordId: id,
        oldValue: before,
        newValue: { date, productId, quantitySold, grossAmount, netAmount },
      });
    } else {
      // Pre-check stock before recording a new sale.
      const target = await prisma.product.findUnique({
        where: { id: productId },
        select: { name: true, currentStock: true },
      });
      if (!target) return fail('Product not found.');
      if (quantitySold > target.currentStock) {
        return fail(shortMsg(target.name, target.currentStock));
      }

      const created = await prisma.$transaction(async (tx) => {
        const s = await tx.sale.create({
          data: {
            date,
            storeId,
            productId,
            quantitySold,
            grossAmount,
            commission,
            vat,
            otherCharges,
            returnsRefunds,
            netAmount,
            notes,
            createdById: user.id,
            createdBy: user.name,
          },
        });
        await recordMovement(tx, {
          productId,
          storeId,
          type: 'SALE',
          quantity: -quantitySold,
          reference: s.id,
          note: 'Sale (Daraz)',
          user,
          guard: true,
        });
        return s;
      });
      await logAudit({
        user,
        action: 'CREATE',
        module: 'Sales',
        recordId: created.id,
        newValue: created,
      });
    }
    revalidatePath('/sales');
    revalidatePath('/products');
    return ok();
  } catch (e) {
    if (e instanceof Error && e.message === INSUFFICIENT_STOCK) {
      return fail('Not enough stock to record this sale.');
    }
    return fail(e instanceof Error ? e.message : 'Failed to save sale.');
  }
}

export async function deleteSale(formData: FormData) {
  const user = await requireUser();
  const id = str(formData.get('id'));
  if (!id) return;
  const before = await prisma.sale.findUnique({ where: { id } });
  if (!before || before.deletedAt) return;
  await prisma.$transaction(async (tx) => {
    await tx.sale.update({ where: { id }, data: { deletedAt: new Date() } });
    // Return the stock that was sold.
    await recordMovement(tx, {
      productId: before.productId,
      type: 'SALE',
      quantity: before.quantitySold,
      reference: id,
      note: 'Sale deleted',
      user,
    });
  });
  await logAudit({
    user,
    action: 'DELETE',
    module: 'Sales',
    recordId: id,
    oldValue: before,
  });
  revalidatePath('/sales');
  revalidatePath('/products');
}
