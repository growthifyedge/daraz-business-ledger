'use server';

import type { Prisma } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { requireUser, type SessionUser } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { recordMovement } from '@/lib/stock';
import { str, num, int } from '@/lib/utils';
import { PRODUCT_CATEGORY } from '@/lib/config';
import { type FormState, ok, fail } from '@/lib/formState';
import { presentationWriteBlock, assertPresentationReadOnly } from '@/lib/presentation/guard';
import {
  normalizeSellerSku,
  shouldMapDaraz,
  decideSkuMapping,
  duplicateMappingMessage,
} from '@/lib/daraz/mapping';

/** Audit payload for a mapping created inside a purchase transaction. */
interface MappingAudit {
  storeId: string;
  sellerSku: string;
  productId: string;
}

/**
 * Create the store-scoped DarazSkuMapping for (storeId, sellerSku) → productId
 * inside an existing transaction, so it commits atomically with the purchase.
 *
 * - No store or no SKU → returns null (a plain restock maps nothing).
 * - Already mapped to THIS product → idempotent no-op (returns null).
 * - Already mapped to a DIFFERENT product → throws a clear error; the caller's
 *   transaction rolls back. We never overwrite another product's mapping.
 *
 * Returns the audit payload to log after commit, or null when nothing was
 * written. Uses the exact same SKU normalization as Daraz Import and COGS.
 */
async function linkSkuMapping(
  tx: Prisma.TransactionClient,
  args: { storeId: string | null; sellerSku: string | null; productId: string; user: SessionUser | null }
): Promise<MappingAudit | null> {
  const sid = (args.storeId ?? '').trim();
  const sku = normalizeSellerSku(args.sellerSku);
  if (!shouldMapDaraz(sid, sku)) return null;

  const store = await tx.store.findFirst({ where: { id: sid, deletedAt: null }, select: { name: true } });
  if (!store) throw new Error('That store no longer exists — pick a valid store for the Daraz SKU.');

  const existing = await tx.darazSkuMapping.findUnique({
    where: { storeId_sellerSku: { storeId: sid, sellerSku: sku } },
    select: { productId: true },
  });
  const decision = decideSkuMapping(existing, args.productId);
  if (decision.action === 'noop') return null; // already mapped to this product
  if (decision.action === 'conflict') throw new Error(duplicateMappingMessage(sku, store.name));

  await tx.darazSkuMapping.create({
    data: {
      storeId: sid,
      sellerSku: sku,
      productId: args.productId,
      createdBy: args.user?.name ?? null,
      createdById: args.user?.id ?? null,
    },
  });
  return { storeId: sid, sellerSku: sku, productId: args.productId };
}

export async function savePurchase(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const blocked = await presentationWriteBlock();
  if (blocked) return blocked;
  const user = await requireUser();
  const id = str(formData.get('id'));
  const dateStr = str(formData.get('date'));
  const purchasedBy = str(formData.get('purchasedBy')) ?? 'Yahya';
  const storeId = str(formData.get('storeId'));
  const productId = str(formData.get('productId'));
  const quantity = int(formData.get('quantity'));
  const unitCost = num(formData.get('unitCost'));
  const paymentStatus = (str(formData.get('paymentStatus')) ?? 'UNPAID') as
    | 'PAID'
    | 'UNPAID'
    | 'RECONCILIATION_PENDING';
  const reimbursementDate = str(formData.get('reimbursementDate'));
  const bankReference = str(formData.get('bankReference'));
  const invoiceUrl = str(formData.get('invoiceUrl'));
  const notes = str(formData.get('notes'));
  // Optional "Daraz listing details" — maps this Seller SKU to the product for a
  // store, so nobody has to open Daraz Import later. Empty = plain restock.
  const mapStoreId = str(formData.get('mapStoreId'));
  const mapSellerSku = normalizeSellerSku(str(formData.get('mapSellerSku')));

  if (!productId) return fail('Choose a product.');
  if (!dateStr) return fail('Purchase date is required.');
  if (quantity <= 0) return fail('Quantity must be greater than zero.');
  // If one Daraz field is filled, the other is required (avoid half a mapping).
  if ((mapStoreId && !mapSellerSku) || (!mapStoreId && mapSellerSku)) {
    return fail('For Daraz mapping, set BOTH a store and a Seller SKU (or leave both empty).');
  }

  const date = new Date(dateStr);
  const totalCost = quantity * unitCost;

  try {
    if (id) {
      const before = await prisma.purchase.findUnique({ where: { id } });
      if (!before) return fail('Purchase not found.');
      const { mappingAudit } = await prisma.$transaction(async (tx) => {
        const updated = await tx.purchase.update({
          where: { id },
          data: {
            date,
            purchasedBy,
            storeId,
            productId,
            quantity,
            unitCost,
            totalCost,
            paymentStatus,
            reimbursementDate: reimbursementDate ? new Date(reimbursementDate) : null,
            bankReference,
            invoiceUrl,
            notes,
          },
        });
        // Reverse the old stock effect, apply the new one.
        if (before.productId === productId) {
          const delta = quantity - before.quantity;
          if (delta !== 0) {
            await recordMovement(tx, {
              productId,
              storeId,
              type: 'PURCHASE',
              quantity: delta,
              reference: id,
              note: 'Purchase edited',
              user,
            });
          }
        } else {
          await recordMovement(tx, {
            productId: before.productId,
            type: 'PURCHASE',
            quantity: -before.quantity,
            reference: id,
            note: 'Purchase product changed',
            user,
          });
          await recordMovement(tx, {
            productId,
            storeId,
            type: 'PURCHASE',
            quantity,
            reference: id,
            note: 'Purchase product changed',
            user,
          });
        }
        // Same transaction: create the store-scoped Daraz SKU mapping if asked.
        const mappingAudit = await linkSkuMapping(tx, {
          storeId: mapStoreId,
          sellerSku: mapSellerSku,
          productId,
          user,
        });
        return { updated, mappingAudit };
      });
      await logAudit({
        user,
        action: 'UPDATE',
        module: 'Purchases',
        recordId: id,
        oldValue: before,
        newValue: { date, productId, quantity, unitCost, totalCost, paymentStatus },
      });
      if (mappingAudit) {
        await logAudit({
          user,
          action: 'CREATE',
          module: 'DarazSkuMapping',
          recordId: `${mappingAudit.storeId}:${mappingAudit.sellerSku}`,
          newValue: mappingAudit,
        });
      }
    } else {
      const { created, mappingAudit } = await prisma.$transaction(async (tx) => {
        const p = await tx.purchase.create({
          data: {
            date,
            purchasedBy,
            storeId,
            productId,
            quantity,
            unitCost,
            totalCost,
            paymentStatus,
            reimbursementDate: reimbursementDate ? new Date(reimbursementDate) : null,
            bankReference,
            invoiceUrl,
            notes,
            createdById: user.id,
            createdBy: user.name,
          },
        });
        await recordMovement(tx, {
          productId,
          storeId,
          type: 'PURCHASE',
          quantity,
          reference: p.id,
          note: `Purchase from ${purchasedBy}`,
          user,
        });
        // Same transaction: create the store-scoped Daraz SKU mapping if asked.
        const mappingAudit = await linkSkuMapping(tx, {
          storeId: mapStoreId,
          sellerSku: mapSellerSku,
          productId,
          user,
        });
        return { created: p, mappingAudit };
      });
      await logAudit({
        user,
        action: 'CREATE',
        module: 'Purchases',
        recordId: created.id,
        newValue: created,
      });
      if (mappingAudit) {
        await logAudit({
          user,
          action: 'CREATE',
          module: 'DarazSkuMapping',
          recordId: `${mappingAudit.storeId}:${mappingAudit.sellerSku}`,
          newValue: mappingAudit,
        });
      }
    }
    revalidatePath('/purchases');
    revalidatePath('/products');
    return ok();
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Failed to save purchase.');
  }
}

/**
 * Create a brand-new ledger product AND record its first purchase in ONE atomic
 * transaction: Product + Purchase + PURCHASE stock movement + store-scoped Daraz
 * SKU mapping. Lets Yahya onboard a new Daraz listing entirely from the Purchase
 * form — no separate product creation, no Daraz Import mapping step later. If the
 * Seller SKU is already mapped to a different product in that store, the whole
 * transaction rolls back (nothing is created) and a clear error is returned.
 */
export async function saveNewProductPurchase(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const blocked = await presentationWriteBlock();
  if (blocked) return blocked;
  const user = await requireUser();
  const dateStr = str(formData.get('date'));
  const purchasedBy = str(formData.get('purchasedBy')) ?? 'Yahya';
  const productName = str(formData.get('productName'));
  const productCodeRaw = str(formData.get('productCode'));
  const quantity = int(formData.get('quantity'));
  const unitCost = num(formData.get('unitCost'));
  const paymentStatus = (str(formData.get('paymentStatus')) ?? 'UNPAID') as
    | 'PAID'
    | 'UNPAID'
    | 'RECONCILIATION_PENDING';
  const reimbursementDate = str(formData.get('reimbursementDate'));
  const bankReference = str(formData.get('bankReference'));
  const invoiceUrl = str(formData.get('invoiceUrl'));
  const notes = str(formData.get('notes'));
  const mapStoreId = str(formData.get('mapStoreId'));
  const mapSellerSku = normalizeSellerSku(str(formData.get('mapSellerSku')));

  if (!productName) return fail('New product name is required.');
  if (!dateStr) return fail('Purchase date is required.');
  if (quantity <= 0) return fail('Quantity must be greater than zero.');
  if (unitCost < 0) return fail('Unit cost cannot be negative.');
  // This flow exists to auto-map a Daraz listing, so both are required here.
  if (!mapStoreId || !mapSellerSku) {
    return fail('Select a store and enter the Daraz Seller SKU for the new product.');
  }

  const date = new Date(dateStr);
  const totalCost = quantity * unitCost;
  // Internal product code is optional — generate a unique one when blank. The
  // Product.sku column is the internal code (unique), NOT the Daraz Seller SKU.
  const productCode =
    productCodeRaw && productCodeRaw.trim()
      ? productCodeRaw.trim()
      : `NP-${date.getFullYear()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          name: productName,
          sku: productCode,
          category: PRODUCT_CATEGORY,
          // The unit purchase cost becomes the product's cost — this is what
          // Estimated Daraz COGS uses for delivered units of this SKU.
          purchaseCost: unitCost,
          sellingPrice: 0,
          currentStock: 0, // the PURCHASE movement below is the only stock-in
          active: true,
          notes,
        },
      });
      const purchase = await tx.purchase.create({
        data: {
          date,
          purchasedBy,
          productId: product.id,
          quantity,
          unitCost,
          totalCost,
          paymentStatus,
          reimbursementDate: reimbursementDate ? new Date(reimbursementDate) : null,
          bankReference,
          invoiceUrl,
          notes,
          createdById: user.id,
          createdBy: user.name,
        },
      });
      await recordMovement(tx, {
        productId: product.id,
        type: 'PURCHASE',
        quantity,
        reference: purchase.id,
        note: `New product purchase from ${purchasedBy}`,
        user,
      });
      const mappingAudit = await linkSkuMapping(tx, {
        storeId: mapStoreId,
        sellerSku: mapSellerSku,
        productId: product.id,
        user,
      });
      return { product, purchase, mappingAudit };
    });

    await logAudit({ user, action: 'CREATE', module: 'Products', recordId: result.product.id, newValue: result.product });
    await logAudit({ user, action: 'CREATE', module: 'Purchases', recordId: result.purchase.id, newValue: result.purchase });
    if (result.mappingAudit) {
      await logAudit({
        user,
        action: 'CREATE',
        module: 'DarazSkuMapping',
        recordId: `${result.mappingAudit.storeId}:${result.mappingAudit.sellerSku}`,
        newValue: result.mappingAudit,
      });
    }
    revalidatePath('/purchases');
    revalidatePath('/products');
    return ok();
  } catch (e) {
    if (e instanceof Error && e.message.includes('Unique constraint')) {
      return fail('That internal product code is already used. Leave it blank or pick another.');
    }
    return fail(e instanceof Error ? e.message : 'Failed to create product and purchase.');
  }
}

export async function deletePurchase(formData: FormData) {
  await assertPresentationReadOnly();
  const user = await requireUser();
  const id = str(formData.get('id'));
  if (!id) return;
  const before = await prisma.purchase.findUnique({ where: { id } });
  if (!before || before.deletedAt) return;
  await prisma.$transaction(async (tx) => {
    await tx.purchase.update({ where: { id }, data: { deletedAt: new Date() } });
    // Reverse the stock that was added.
    await recordMovement(tx, {
      productId: before.productId,
      type: 'PURCHASE',
      quantity: -before.quantity,
      reference: id,
      note: 'Purchase deleted',
      user,
    });
  });
  await logAudit({
    user,
    action: 'DELETE',
    module: 'Purchases',
    recordId: id,
    oldValue: before,
  });
  revalidatePath('/purchases');
  revalidatePath('/products');
}
