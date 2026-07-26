'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { requireOwner } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { normalizeSellerSku } from '@/lib/daraz/fees';

export interface MappingResult {
  ok: boolean;
  error?: string;
  sellerSku?: string;
  productId?: string;
  storeId?: string;
}

/**
 * Persist a Seller-SKU → ledger Product mapping, scoped to a store. Owner-only,
 * audited. Set explicitly by an operator, never guessed — the caller must supply
 * the store; there is no default. A Seller SKU is unique PER STORE
 * (@@unique([storeId, sellerSku])), so the same SKU may be mapped by both
 * stores, and many SKUs/variants MAY still map to the same ledger product.
 * Mapping is what later unblocks stock / COGS / P&L posting for that SKU on a
 * future import; this action itself changes no stock, sales, COGS or P&L.
 */
export async function saveDarazSkuMapping(
  sellerSku: string,
  productId: string,
  storeId: string
): Promise<MappingResult> {
  const user = await requireOwner();
  const sku = normalizeSellerSku(sellerSku);
  const pid = String(productId ?? '').trim();
  const sid = String(storeId ?? '').trim();
  if (!sid) return { ok: false, error: 'Select a store for this mapping.' };
  if (!sku) return { ok: false, error: 'Seller SKU is required.' };
  if (!pid) return { ok: false, error: 'Choose a ledger product to map to.' };

  const store = await prisma.store.findFirst({
    where: { id: sid, deletedAt: null },
    select: { id: true },
  });
  if (!store) return { ok: false, error: 'That store no longer exists.' };

  const product = await prisma.product.findFirst({
    where: { id: pid, deletedAt: null },
    select: { id: true },
  });
  if (!product) return { ok: false, error: 'That product no longer exists.' };

  // Identity is the (storeId, sellerSku) compound unique.
  const existing = await prisma.darazSkuMapping.findUnique({
    where: { storeId_sellerSku: { storeId: sid, sellerSku: sku } },
    select: { productId: true },
  });

  await prisma.darazSkuMapping.upsert({
    where: { storeId_sellerSku: { storeId: sid, sellerSku: sku } },
    update: { productId: pid, createdBy: user.name, createdById: user.id },
    create: { storeId: sid, sellerSku: sku, productId: pid, createdBy: user.name, createdById: user.id },
  });

  await logAudit({
    user,
    action: 'UPDATE',
    module: 'DarazSkuMapping',
    recordId: `${sid}:${sku}`,
    oldValue: existing ? { storeId: sid, sellerSku: sku, productId: existing.productId } : null,
    newValue: { storeId: sid, sellerSku: sku, productId: pid },
  });

  revalidatePath('/import');
  return { ok: true, sellerSku: sku, productId: pid, storeId: sid };
}
