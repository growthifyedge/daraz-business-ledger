'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { str } from '@/lib/utils';
import { type FormState, ok, fail } from '@/lib/formState';
import { presentationWriteBlock, assertPresentationReadOnly } from '@/lib/presentation/guard';

export async function saveStore(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const blocked = await presentationWriteBlock();
  if (blocked) return blocked;
  const user = await requireUser();
  const id = str(formData.get('id'));
  const name = str(formData.get('name'));
  const notes = str(formData.get('notes'));
  const active = formData.get('active') === 'on';

  if (!name) return fail('Store name is required.');

  try {
    if (id) {
      const before = await prisma.store.findUnique({ where: { id } });
      const updated = await prisma.store.update({
        where: { id },
        data: { name, notes, active },
      });
      await logAudit({
        user,
        action: 'UPDATE',
        module: 'Stores',
        recordId: id,
        oldValue: before,
        newValue: updated,
      });
    } else {
      const created = await prisma.store.create({
        data: { name, notes, active },
      });
      await logAudit({
        user,
        action: 'CREATE',
        module: 'Stores',
        recordId: created.id,
        newValue: created,
      });
    }
    revalidatePath('/stores');
    return ok();
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Failed to save store.');
  }
}

export async function deleteStore(formData: FormData) {
  await assertPresentationReadOnly();
  const user = await requireUser();
  const id = str(formData.get('id'));
  if (!id) return;
  const before = await prisma.store.findUnique({ where: { id } });
  await prisma.store.update({
    where: { id },
    data: { deletedAt: new Date(), active: false },
  });
  await logAudit({
    user,
    action: 'DELETE',
    module: 'Stores',
    recordId: id,
    oldValue: before,
  });
  revalidatePath('/stores');
}
