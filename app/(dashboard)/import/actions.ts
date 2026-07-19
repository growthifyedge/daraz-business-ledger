'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { requireOwner } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { type FormState, ok, fail } from '@/lib/formState';

/**
 * Persist a Seller-SKU → ledger Product mapping. Set explicitly by an operator,
 * never guessed. Mapping is what later unblocks stock / COGS / P&L posting for
 * that SKU; import itself does not wait for it.
 */
export async function saveSkuMapping(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const user = await requireOwner();
  const sellerSku = String(formData.get('sellerSku') ?? '').trim();
  const productId = String(formData.get('productId') ?? '').trim();
  if (!sellerSku) return fail('Seller SKU is required.');
  if (!productId) return fail('Choose a ledger product to map to.');

  const product = await prisma.product.findFirst({
    where: { id: productId, deletedAt: null },
    select: { id: true },
  });
  if (!product) return fail('That product no longer exists.');

  await prisma.darazSkuMapping.upsert({
    where: { sellerSku },
    update: { productId, createdBy: user.name, createdById: user.id },
    create: { sellerSku, productId, createdBy: user.name, createdById: user.id },
  });

  await logAudit({
    user,
    action: 'UPDATE',
    module: 'DarazSkuMapping',
    recordId: sellerSku,
    newValue: { sellerSku, productId },
  });

  revalidatePath('/import');
  return ok('SKU mapped. Stock/COGS/P&L will post for this SKU on the next import.');
}
