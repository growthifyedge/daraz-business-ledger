'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { str, num } from '@/lib/utils';
import { type FormState, ok, fail } from '@/lib/formState';

// ---------------------------------------------------------------------------
// Owner Investments
// ---------------------------------------------------------------------------

export async function saveInvestment(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const user = await requireUser();
  const id = str(formData.get('id'));
  const dateStr = str(formData.get('date'));
  const amount = num(formData.get('amount'));
  const note = str(formData.get('note'));

  if (!dateStr) return fail('Investment date is required.');
  if (amount <= 0) return fail('Amount must be greater than zero.');

  const date = new Date(dateStr);

  try {
    if (id) {
      const before = await prisma.investment.findUnique({ where: { id } });
      if (!before) return fail('Investment not found.');
      const updated = await prisma.investment.update({
        where: { id },
        data: { date, amount, note },
      });
      await logAudit({
        user,
        action: 'UPDATE',
        module: 'Investment',
        recordId: id,
        oldValue: before,
        newValue: updated,
      });
    } else {
      const created = await prisma.investment.create({
        data: {
          date,
          amount,
          note,
          createdById: user.id,
          createdBy: user.name,
        },
      });
      await logAudit({
        user,
        action: 'CREATE',
        module: 'Investment',
        recordId: created.id,
        newValue: created,
      });
    }
    revalidatePath('/cash-flow');
    revalidatePath('/dashboard');
    return ok();
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Failed to save investment.');
  }
}

export async function deleteInvestment(formData: FormData) {
  const user = await requireUser();
  const id = str(formData.get('id'));
  if (!id) return;
  const before = await prisma.investment.findUnique({ where: { id } });
  await prisma.investment.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
  await logAudit({
    user,
    action: 'DELETE',
    module: 'Investment',
    recordId: id,
    oldValue: before,
  });
  revalidatePath('/cash-flow');
  revalidatePath('/dashboard');
}

// ---------------------------------------------------------------------------
// Profit-share Payouts
// ---------------------------------------------------------------------------

export async function savePayout(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const user = await requireUser();
  const id = str(formData.get('id'));
  const dateStr = str(formData.get('date'));
  const party = str(formData.get('party'));
  const amount = num(formData.get('amount'));
  const note = str(formData.get('note'));

  if (!dateStr) return fail('Payout date is required.');
  if (party !== 'YAHYA' && party !== 'OWNER') return fail('Select a party.');
  if (amount <= 0) return fail('Amount must be greater than zero.');

  const date = new Date(dateStr);

  try {
    if (id) {
      const before = await prisma.payout.findUnique({ where: { id } });
      if (!before) return fail('Payout not found.');
      const updated = await prisma.payout.update({
        where: { id },
        data: { date, party, amount, note },
      });
      await logAudit({
        user,
        action: 'UPDATE',
        module: 'Payout',
        recordId: id,
        oldValue: before,
        newValue: updated,
      });
    } else {
      const created = await prisma.payout.create({
        data: {
          date,
          party,
          amount,
          note,
          createdById: user.id,
          createdBy: user.name,
        },
      });
      await logAudit({
        user,
        action: 'CREATE',
        module: 'Payout',
        recordId: created.id,
        newValue: created,
      });
    }
    revalidatePath('/cash-flow');
    revalidatePath('/dashboard');
    return ok();
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Failed to save payout.');
  }
}

export async function deletePayout(formData: FormData) {
  const user = await requireUser();
  const id = str(formData.get('id'));
  if (!id) return;
  const before = await prisma.payout.findUnique({ where: { id } });
  await prisma.payout.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
  await logAudit({
    user,
    action: 'DELETE',
    module: 'Payout',
    recordId: id,
    oldValue: before,
  });
  revalidatePath('/cash-flow');
  revalidatePath('/dashboard');
}
