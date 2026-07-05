'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { str, num } from '@/lib/utils';
import { type FormState, ok, fail } from '@/lib/formState';

export async function saveSettlement(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const user = await requireUser();
  const id = str(formData.get('id'));
  const dateStr = str(formData.get('date'));
  const storeId = str(formData.get('storeId'));
  const grossAmount = num(formData.get('grossAmount'));
  const vat = num(formData.get('vat'));
  const commission = num(formData.get('commission'));
  const otherCharges = num(formData.get('otherCharges'));
  const deductions = num(formData.get('deductions'));
  const bankReference = str(formData.get('bankReference'));
  const notes = str(formData.get('notes'));

  if (!dateStr) return fail('Settlement date is required.');
  if (grossAmount <= 0) return fail('Gross amount must be greater than zero.');

  const date = new Date(dateStr);
  const netAmount = grossAmount - vat - commission - otherCharges - deductions;

  try {
    if (id) {
      const before = await prisma.settlement.findUnique({ where: { id } });
      if (!before) return fail('Settlement not found.');
      await prisma.settlement.update({
        where: { id },
        data: {
          date,
          storeId,
          grossAmount,
          vat,
          commission,
          otherCharges,
          deductions,
          netAmount,
          bankReference,
          notes,
        },
      });
      await logAudit({
        user,
        action: 'UPDATE',
        module: 'Settlements',
        recordId: id,
        oldValue: before,
        newValue: { date, storeId, grossAmount, netAmount },
      });
    } else {
      const created = await prisma.settlement.create({
        data: {
          date,
          storeId,
          grossAmount,
          vat,
          commission,
          otherCharges,
          deductions,
          netAmount,
          bankReference,
          notes,
          createdById: user.id,
          createdBy: user.name,
        },
      });
      await logAudit({
        user,
        action: 'CREATE',
        module: 'Settlements',
        recordId: created.id,
        newValue: created,
      });
    }
    revalidatePath('/settlements');
    return ok();
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Failed to save settlement.');
  }
}

export async function deleteSettlement(formData: FormData) {
  const user = await requireUser();
  const id = str(formData.get('id'));
  if (!id) return;
  const before = await prisma.settlement.findUnique({ where: { id } });
  if (!before || before.deletedAt) return;
  await prisma.settlement.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
  await logAudit({
    user,
    action: 'DELETE',
    module: 'Settlements',
    recordId: id,
    oldValue: before,
  });
  revalidatePath('/settlements');
}
