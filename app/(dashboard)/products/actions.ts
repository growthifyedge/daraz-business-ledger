'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { recordMovement, INSUFFICIENT_STOCK } from '@/lib/stock';
import { str, num, int } from '@/lib/utils';
import { PRODUCT_CATEGORY } from '@/lib/config';
import { type FormState, ok, fail } from '@/lib/formState';
import { presentationWriteBlock, assertPresentationReadOnly } from '@/lib/presentation/guard';

export async function saveProduct(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const blocked = await presentationWriteBlock();
  if (blocked) return blocked;
  const user = await requireUser();
  const id = str(formData.get('id'));
  const name = str(formData.get('name'));
  const sku = str(formData.get('sku'));
  const purchaseCost = num(formData.get('purchaseCost'));
  const sellingPrice = num(formData.get('sellingPrice'));
  const minStockLevel = int(formData.get('minStockLevel'));
  const openingStock = int(formData.get('openingStock'));
  const active = formData.get('active') === 'on';
  const notes = str(formData.get('notes'));
  const storeIds = formData.getAll('storeIds').map(String).filter(Boolean);

  if (!name) return fail('Product name is required.');
  if (!sku) return fail('SKU / internal code is required.');

  try {
    if (id) {
      const before = await prisma.product.findUnique({ where: { id } });
      const updated = await prisma.$transaction(async (tx) => {
        const p = await tx.product.update({
          where: { id },
          data: {
            name,
            sku,
            purchaseCost,
            sellingPrice,
            minStockLevel,
            active,
            notes,
            category: PRODUCT_CATEGORY,
          },
        });
        await tx.productStore.deleteMany({ where: { productId: id } });
        if (storeIds.length) {
          await tx.productStore.createMany({
            data: storeIds.map((storeId) => ({ productId: id, storeId })),
          });
        }
        return p;
      });
      await logAudit({
        user,
        action: 'UPDATE',
        module: 'Products',
        recordId: id,
        oldValue: before,
        newValue: updated,
      });
    } else {
      const created = await prisma.$transaction(async (tx) => {
        const p = await tx.product.create({
          data: {
            name,
            sku,
            purchaseCost,
            sellingPrice,
            minStockLevel,
            // Starts at zero: the ADD movement below is the only thing that
            // raises stock, so setting openingStock here would count it twice.
            currentStock: 0,
            active,
            notes,
            category: PRODUCT_CATEGORY,
          },
        });
        if (storeIds.length) {
          await tx.productStore.createMany({
            data: storeIds.map((storeId) => ({ productId: p.id, storeId })),
          });
        }
        if (openingStock > 0) {
          await recordMovement(tx, {
            productId: p.id,
            type: 'ADD',
            quantity: openingStock,
            note: 'Opening stock',
            user,
          });
        }
        // Re-read after the movement so the audit log gets the final stock,
        // not the zero the row was created with.
        return tx.product.findUniqueOrThrow({ where: { id: p.id } });
      });
      await logAudit({
        user,
        action: 'CREATE',
        module: 'Products',
        recordId: created.id,
        newValue: created,
      });
    }
    revalidatePath('/products');
    return ok();
  } catch (e) {
    if (e instanceof Error && e.message.includes('Unique constraint')) {
      return fail('That SKU is already used by another product.');
    }
    return fail(e instanceof Error ? e.message : 'Failed to save product.');
  }
}

export async function deleteProduct(formData: FormData) {
  await assertPresentationReadOnly();
  const user = await requireUser();
  const id = str(formData.get('id'));
  if (!id) return;
  const before = await prisma.product.findUnique({ where: { id } });
  await prisma.product.update({
    where: { id },
    data: { deletedAt: new Date(), active: false },
  });
  await logAudit({
    user,
    action: 'DELETE',
    module: 'Products',
    recordId: id,
    oldValue: before,
  });
  revalidatePath('/products');
}

export async function adjustStock(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const blocked = await presentationWriteBlock();
  if (blocked) return blocked;
  const user = await requireUser();
  const productId = str(formData.get('productId'));
  const type = str(formData.get('type')) as
    | 'ADD'
    | 'REDUCE'
    | 'ADJUST'
    | 'DAMAGED'
    | 'LOST'
    | 'RETURNED'
    | 'TRANSFER'
    | null;
  const qty = int(formData.get('quantity'));
  const storeId = str(formData.get('storeId'));
  const toStoreId = str(formData.get('toStoreId'));
  const note = str(formData.get('note'));

  if (!productId || !type) return fail('Choose a product and an action.');
  if (qty <= 0 && type !== 'ADJUST') return fail('Enter a quantity greater than zero.');

  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) return fail('Product not found.');

  // Pre-check: outflow actions cannot exceed available stock.
  if (
    (type === 'REDUCE' || type === 'DAMAGED' || type === 'LOST') &&
    qty > product.currentStock
  ) {
    return fail(
      `Not enough stock: only ${product.currentStock} unit(s) of ${product.name} available.`
    );
  }

  try {
    await prisma.$transaction(async (tx) => {
      switch (type) {
        case 'ADD':
          await recordMovement(tx, { productId, storeId, type, quantity: qty, note, user });
          break;
        case 'REDUCE':
          await recordMovement(tx, { productId, storeId, type, quantity: -qty, note, user, guard: true });
          break;
        case 'ADJUST': {
          const delta = qty - product.currentStock; // qty = target absolute stock
          await recordMovement(tx, {
            productId,
            storeId,
            type,
            quantity: delta,
            note: note ?? `Adjusted to ${qty}`,
            user,
          });
          break;
        }
        case 'DAMAGED':
          await tx.product.update({
            where: { id: productId },
            data: { damagedStock: { increment: qty } },
          });
          await recordMovement(tx, { productId, storeId, type, quantity: -qty, note, user, guard: true });
          break;
        case 'LOST':
          await tx.product.update({
            where: { id: productId },
            data: { lostStock: { increment: qty } },
          });
          await recordMovement(tx, { productId, storeId, type, quantity: -qty, note, user, guard: true });
          break;
        case 'RETURNED':
          await tx.product.update({
            where: { id: productId },
            data: { returnedStock: { increment: qty } },
          });
          await recordMovement(tx, { productId, storeId, type, quantity: qty, note, user });
          break;
        case 'TRANSFER':
          // Stock is tracked per product (not per store); record as informational.
          await recordMovement(tx, {
            productId,
            storeId,
            toStoreId,
            type,
            quantity: 0,
            note: note ?? `Transferred ${qty} unit(s) between stores`,
            user,
          });
          break;
      }
    });
    await logAudit({
      user,
      action: 'UPDATE',
      module: 'Inventory',
      recordId: productId,
      newValue: { type, quantity: qty, note },
    });
    revalidatePath('/products');
    return ok();
  } catch (e) {
    if (e instanceof Error && e.message === INSUFFICIENT_STOCK) {
      return fail('Not enough stock for this action.');
    }
    return fail(e instanceof Error ? e.message : 'Failed to adjust stock.');
  }
}
