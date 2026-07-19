'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { requireOwner } from '@/lib/auth';
import { logAudit } from '@/lib/audit';

export interface MappingResult {
  ok: boolean;
  error?: string;
  sellerSku?: string;
  productId?: string;
}

/**
 * Persist a Seller-SKU → ledger Product mapping. Owner-only, audited. Set
 * explicitly by an operator, never guessed. Many Daraz SKUs/variants MAY map to
 * the same ledger product (sellerSku is unique; productId is not). Mapping is
 * what later unblocks stock / COGS / P&L posting for that SKU on a future
 * import; this action itself changes no stock, sales, COGS or P&L.
 */
export async function saveDarazSkuMapping(
  sellerSku: string,
  productId: string
): Promise<MappingResult> {
  const user = await requireOwner();
  const sku = String(sellerSku ?? '').trim();
  const pid = String(productId ?? '').trim();
  if (!sku) return { ok: false, error: 'Seller SKU is required.' };
  if (!pid) return { ok: false, error: 'Choose a ledger product to map to.' };

  const product = await prisma.product.findFirst({
    where: { id: pid, deletedAt: null },
    select: { id: true },
  });
  if (!product) return { ok: false, error: 'That product no longer exists.' };

  const existing = await prisma.darazSkuMapping.findUnique({
    where: { sellerSku: sku },
    select: { productId: true },
  });

  await prisma.darazSkuMapping.upsert({
    where: { sellerSku: sku },
    update: { productId: pid, createdBy: user.name, createdById: user.id },
    create: { sellerSku: sku, productId: pid, createdBy: user.name, createdById: user.id },
  });

  await logAudit({
    user,
    action: 'UPDATE',
    module: 'DarazSkuMapping',
    recordId: sku,
    oldValue: existing ? { sellerSku: sku, productId: existing.productId } : null,
    newValue: { sellerSku: sku, productId: pid },
  });

  revalidatePath('/import');
  return { ok: true, sellerSku: sku, productId: pid };
}
