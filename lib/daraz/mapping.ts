// Pure decision logic for creating a store-scoped Daraz Seller-SKU → ledger
// Product mapping from the Purchase flow. NO I/O, NO Prisma — the caller reads
// the existing mapping (if any) and applies whatever this decides inside its own
// transaction. Kept pure so every rule below is unit-testable without a DB.
//
// Rules encoded here:
//   • A Seller SKU is unique PER STORE — (storeId, sellerSku) is the identity.
//     The same physical product may carry a different SKU in each store, and the
//     same SKU string in two different stores is two independent mappings.
//   • A SKU already mapped to the SAME product is a no-op (idempotent re-entry).
//   • A SKU already mapped to a DIFFERENT product is a CONFLICT — never overwrite
//     another product's mapping. The caller rejects and rolls back.

import { normalizeSellerSku } from './fees';

export { normalizeSellerSku };

/** Store-scoped identity key for a mapping. Mirrors COGS / dry-run resolution. */
export function skuMappingKey(
  storeId: string | null | undefined,
  sellerSku: string | null | undefined
): string {
  return `${storeId ?? ''}||${normalizeSellerSku(sellerSku)}`;
}

/**
 * Whether the Purchase flow should attempt a Daraz mapping at all. A plain
 * restock (no store or no SKU) maps nothing — the purchase saves exactly as
 * today. Both must be present after normalization.
 */
export function shouldMapDaraz(
  storeId: string | null | undefined,
  sellerSku: string | null | undefined
): boolean {
  return Boolean((storeId ?? '').trim()) && Boolean(normalizeSellerSku(sellerSku));
}

export type SkuMappingDecision =
  | { action: 'create' } // no mapping exists for (store, sku) → create it
  | { action: 'noop' } // already mapped to this exact product → nothing to do
  | { action: 'conflict'; existingProductId: string }; // mapped elsewhere → reject

/**
 * Decide what to do for one (store, sku) given the mapping that already exists
 * (or null). `targetProductId` is the product the purchase is for.
 */
export function decideSkuMapping(
  existing: { productId: string } | null | undefined,
  targetProductId: string
): SkuMappingDecision {
  if (!existing) return { action: 'create' };
  if (existing.productId === targetProductId) return { action: 'noop' };
  return { action: 'conflict', existingProductId: existing.productId };
}

/** A clear, user-facing message for a duplicate-mapping rejection. */
export function duplicateMappingMessage(sellerSku: string, storeName?: string | null): string {
  const where = storeName ? ` in ${storeName}` : ' in this store';
  return `Seller SKU “${normalizeSellerSku(sellerSku)}” is already mapped to a different product${where}. Unmap it in Daraz Import first, or use the SKU that belongs to this product.`;
}
