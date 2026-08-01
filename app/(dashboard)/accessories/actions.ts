'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { str, num, int } from '@/lib/utils';
import { type FormState, ok, fail } from '@/lib/formState';
import { presentationWriteBlock, assertPresentationReadOnly } from '@/lib/presentation/guard';

export async function saveAccessory(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const blocked = await presentationWriteBlock();
  if (blocked) return blocked;
  const user = await requireUser();
  const id = str(formData.get('id'));
  const name = str(formData.get('name'));
  const quantityPurchased = int(formData.get('quantityPurchased'));
  const quantityUsed = int(formData.get('quantityUsed'));
  const unitCost = num(formData.get('unitCost'));
  const purchaseDateStr = str(formData.get('purchaseDate'));
  const receiptUrl = str(formData.get('receiptUrl'));
  const notes = str(formData.get('notes'));

  if (!name) return fail('Item name is required.');
  if (quantityPurchased < 0) return fail('Quantity purchased cannot be negative.');
  if (unitCost < 0) return fail('Unit cost cannot be negative.');

  const purchaseDate = purchaseDateStr ? new Date(purchaseDateStr) : null;
  const totalCost = quantityPurchased * unitCost;

  try {
    if (id) {
      const before = await prisma.accessory.findUnique({ where: { id } });
      if (!before) return fail('Accessory not found.');
      const updated = await prisma.accessory.update({
        where: { id },
        data: {
          name,
          quantityPurchased,
          quantityUsed,
          unitCost,
          totalCost,
          purchaseDate,
          receiptUrl,
          notes,
        },
      });
      await logAudit({
        user,
        action: 'UPDATE',
        module: 'Accessories',
        recordId: id,
        oldValue: before,
        newValue: updated,
      });
    } else {
      const created = await prisma.accessory.create({
        data: {
          name,
          quantityPurchased,
          quantityUsed,
          unitCost,
          totalCost,
          purchaseDate,
          receiptUrl,
          notes,
          createdById: user.id,
          createdBy: user.name,
        },
      });
      await logAudit({
        user,
        action: 'CREATE',
        module: 'Accessories',
        recordId: created.id,
        newValue: created,
      });
    }
    revalidatePath('/accessories');
    return ok();
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Failed to save accessory.');
  }
}

export async function deleteAccessory(formData: FormData) {
  await assertPresentationReadOnly();
  const user = await requireUser();
  const id = str(formData.get('id'));
  if (!id) return;
  const before = await prisma.accessory.findUnique({ where: { id } });
  if (!before || before.deletedAt) return;
  await prisma.accessory.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
  await logAudit({
    user,
    action: 'DELETE',
    module: 'Accessories',
    recordId: id,
    oldValue: before,
  });
  revalidatePath('/accessories');
}
