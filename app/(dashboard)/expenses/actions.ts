'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { str, num } from '@/lib/utils';
import { type FormState, ok, fail } from '@/lib/formState';
import { presentationWriteBlock, assertPresentationReadOnly } from '@/lib/presentation/guard';

const CATEGORIES = [
  'PRODUCT_COST',
  'VAT',
  'DARAZ_COMMISSION',
  'OTHER_DARAZ_CHARGES',
  'PACKAGING',
  'FLYERS',
  'TAPE',
  'STICKERS',
  'SCISSORS',
  'STATIONERY',
  'BANK_CHARGES',
  'DELIVERY_TRANSPORT',
  'MISCELLANEOUS',
] as const;

type ExpenseCategory = (typeof CATEGORIES)[number];

export async function saveExpense(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const blocked = await presentationWriteBlock();
  if (blocked) return blocked;
  const user = await requireUser();
  const id = str(formData.get('id'));
  const dateStr = str(formData.get('date'));
  const category = str(formData.get('category')) as ExpenseCategory | null;
  const storeId = str(formData.get('storeId'));
  const amount = num(formData.get('amount'));
  const paidBy = str(formData.get('paidBy'));
  const paymentMethod = str(formData.get('paymentMethod'));
  const receiptUrl = str(formData.get('receiptUrl'));
  const notes = str(formData.get('notes'));

  if (!dateStr) return fail('Expense date is required.');
  if (!category || !CATEGORIES.includes(category))
    return fail('Choose a category.');
  if (amount <= 0) return fail('Amount must be greater than zero.');

  const date = new Date(dateStr);

  try {
    if (id) {
      const before = await prisma.expense.findUnique({ where: { id } });
      if (!before) return fail('Expense not found.');
      const updated = await prisma.expense.update({
        where: { id },
        data: {
          date,
          category,
          storeId,
          amount,
          paidBy,
          paymentMethod,
          receiptUrl,
          notes,
        },
      });
      await logAudit({
        user,
        action: 'UPDATE',
        module: 'Expenses',
        recordId: id,
        oldValue: before,
        newValue: updated,
      });
    } else {
      const created = await prisma.expense.create({
        data: {
          date,
          category,
          storeId,
          amount,
          paidBy,
          paymentMethod,
          receiptUrl,
          notes,
          createdById: user.id,
          createdBy: user.name,
        },
      });
      await logAudit({
        user,
        action: 'CREATE',
        module: 'Expenses',
        recordId: created.id,
        newValue: created,
      });
    }
    revalidatePath('/expenses');
    return ok();
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Failed to save expense.');
  }
}

export async function deleteExpense(formData: FormData) {
  await assertPresentationReadOnly();
  const user = await requireUser();
  const id = str(formData.get('id'));
  if (!id) return;
  const before = await prisma.expense.findUnique({ where: { id } });
  if (!before || before.deletedAt) return;
  await prisma.expense.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
  await logAudit({
    user,
    action: 'DELETE',
    module: 'Expenses',
    recordId: id,
    oldValue: before,
  });
  revalidatePath('/expenses');
}
