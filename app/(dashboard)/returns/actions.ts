'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { recordMovement, INSUFFICIENT_STOCK } from '@/lib/stock';
import { str, num, int } from '@/lib/utils';
import { type FormState, ok, fail } from '@/lib/formState';
import { presentationWriteBlock, assertPresentationReadOnly } from '@/lib/presentation/guard';
import {
  type BucketDelta,
  type Disposition,
  transitionPlan,
  validateReturnInput,
  legacyRefundConflict,
  cumulativeReturnQtyError,
  effectiveSaleUnitCost,
} from '@/lib/returns';
import type {
  Prisma,
  ReturnChargedTo,
  ReturnRefundStatus,
  ReturnInventoryStatus,
} from '@prisma/client';

type Tx = Prisma.TransactionClient;
type SessionUser = Awaited<ReturnType<typeof requireUser>>;

const CHARGED_TO = new Set(['SELLER', 'PLATFORM', 'PENDING']);
const REFUND_STATUS = new Set(['PENDING', 'COMPLETED', 'CANCELLED']);
const INVENTORY_STATUS = new Set([
  'NOT_RECEIVED',
  'RECEIVED_PENDING_QC',
  'RESTOCKED',
  'DAMAGED',
  'LOST',
]);

/**
 * Turn one product's net bucket delta into database writes.
 *
 * Sellable stock always moves through `recordMovement` so the change lands in
 * StockMovement history; the other three buckets are plain counters. A negative
 * sellable move is guarded — if the unit has since been sold, `recordMovement`
 * throws INSUFFICIENT_STOCK rather than driving stock below zero.
 *
 * The delta itself is computed by the pure rules in lib/returns.ts, which
 * guarantee a disposition only ever touches ONE bucket.
 */
async function applyBucketDelta(
  tx: Tx,
  entry: { productId: string; storeId: string | null; delta: BucketDelta },
  reference: string,
  user: SessionUser | null
): Promise<void> {
  const { productId, storeId, delta } = entry;

  if (delta.currentStock !== 0) {
    await recordMovement(tx, {
      productId,
      storeId,
      type: 'RETURNED',
      quantity: delta.currentStock,
      reference,
      note: delta.currentStock > 0 ? 'Return restocked' : 'Return restock reversed',
      user,
      guard: delta.currentStock < 0,
    });
  }

  const data: Prisma.ProductUpdateInput = {};
  if (delta.returnedStock !== 0)
    data.returnedStock = { increment: delta.returnedStock };
  if (delta.damagedStock !== 0) data.damagedStock = { increment: delta.damagedStock };
  if (delta.lostStock !== 0) data.lostStock = { increment: delta.lostStock };
  if (Object.keys(data).length) {
    await tx.product.update({ where: { id: productId }, data });
  }
}

/** Reverse `before`, apply `after`, atomically, for every affected product. */
async function applyTransition(
  tx: Tx,
  before: Disposition | null,
  after: Disposition | null,
  reference: string,
  user: SessionUser | null
): Promise<void> {
  for (const entry of transitionPlan(before, after)) {
    await applyBucketDelta(tx, entry, reference, user);
  }
}

const asDisposition = (r: {
  productId: string | null;
  storeId: string | null;
  quantity: number;
  inventoryStatus: ReturnInventoryStatus;
}): Disposition => ({
  productId: r.productId,
  storeId: r.storeId,
  quantity: r.quantity,
  inventoryStatus: r.inventoryStatus,
});

/**
 * Audit snapshot. Deliberately omits buyerName and trackingNumber — the audit
 * log records what changed financially and physically, not customer identity.
 */
function snapshot(r: {
  id: string;
  returnDate: Date;
  receivedAt: Date | null;
  orderNumber: string | null;
  returnOrderId: string | null;
  returnItemId: string | null;
  orderItemId: string | null;
  storeId: string | null;
  productId: string | null;
  saleId: string | null;
  sellerSku: string | null;
  quantity: number;
  paidAmount: number;
  refundAmount: number;
  unitCost: number | null;
  chargedTo: ReturnChargedTo;
  refundStatus: ReturnRefundStatus;
  inventoryStatus: ReturnInventoryStatus;
  reason: string | null;
  deletedAt: Date | null;
}) {
  return {
    id: r.id,
    returnDate: r.returnDate,
    receivedAt: r.receivedAt,
    orderNumber: r.orderNumber,
    returnOrderId: r.returnOrderId,
    returnItemId: r.returnItemId,
    orderItemId: r.orderItemId,
    storeId: r.storeId,
    productId: r.productId,
    saleId: r.saleId,
    sellerSku: r.sellerSku,
    quantity: r.quantity,
    paidAmount: r.paidAmount,
    refundAmount: r.refundAmount,
    unitCost: r.unitCost,
    chargedTo: r.chargedTo,
    refundStatus: r.refundStatus,
    inventoryStatus: r.inventoryStatus,
    reason: r.reason,
    deletedAt: r.deletedAt,
  };
}

const stockMsg = (name: string, available: number) =>
  `Cannot reverse the restock of “${name}”: only ${available} unit(s) remain in sellable stock, so the returned unit appears to have been sold already. Record the sale correction first, or set the inventory status to Damaged/Lost instead.`;

// ---------------------------------------------------------------------------
// Create / update
// ---------------------------------------------------------------------------

export async function saveReturn(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const blocked = await presentationWriteBlock();
  if (blocked) return blocked;
  const user = await requireUser();
  const id = str(formData.get('id'));

  const returnDateStr = str(formData.get('returnDate'));
  const orderDateStr = str(formData.get('orderDate'));
  const receivedAtStr = str(formData.get('receivedAt'));
  const storeId = str(formData.get('storeId'));
  const productId = str(formData.get('productId'));
  const saleId = str(formData.get('saleId'));
  const buyerName = str(formData.get('buyerName'));
  const sellerSku = str(formData.get('sellerSku'));
  const orderNumber = str(formData.get('orderNumber'));
  const returnOrderId = str(formData.get('returnOrderId'));
  const returnItemId = str(formData.get('returnItemId'));
  const orderItemId = str(formData.get('orderItemId'));
  const quantity = int(formData.get('quantity'));
  const paidAmount = num(formData.get('paidAmount'));
  const refundAmount = num(formData.get('refundAmount'));
  const unitCostRaw = str(formData.get('unitCost'));
  const submittedUnitCost = unitCostRaw === null ? null : Number(unitCostRaw);
  const reason = str(formData.get('reason'));
  const status = str(formData.get('status'));
  const trackingNumber = str(formData.get('trackingNumber'));
  const logisticStatus = str(formData.get('logisticStatus'));
  const notes = str(formData.get('notes'));

  const chargedToRaw = str(formData.get('chargedTo')) ?? 'PENDING';
  const refundStatusRaw = str(formData.get('refundStatus')) ?? 'PENDING';
  const inventoryStatusRaw = str(formData.get('inventoryStatus')) ?? 'NOT_RECEIVED';
  if (!CHARGED_TO.has(chargedToRaw)) return fail('Invalid “charged to” value.');
  if (!REFUND_STATUS.has(refundStatusRaw)) return fail('Invalid refund status.');
  if (!INVENTORY_STATUS.has(inventoryStatusRaw))
    return fail('Invalid inventory status.');
  const chargedTo = chargedToRaw as ReturnChargedTo;
  const refundStatus = refundStatusRaw as ReturnRefundStatus;
  const inventoryStatus = inventoryStatusRaw as ReturnInventoryStatus;

  // --- validation (pure rules, see lib/returns.ts) -------------------------
  const returnDate = returnDateStr ? new Date(returnDateStr) : null;
  const orderDate = orderDateStr ? new Date(orderDateStr) : null;
  const receivedAt = receivedAtStr ? new Date(receivedAtStr) : null;

  const invalid = validateReturnInput({
    returnItemId,
    returnOrderId,
    orderItemId,
    returnDate,
    orderDate,
    receivedAt,
    quantity,
    paidAmount,
    refundAmount,
    unitCost: submittedUnitCost,
    inventoryStatus,
    productId,
  });
  if (invalid) return fail(invalid);

  try {
    // Product cost is needed to default the snapshot when nothing is supplied.
    let productPurchaseCost: number | null = null;
    if (productId) {
      const p = await prisma.product.findFirst({
        where: { id: productId, deletedAt: null },
        select: { id: true, purchaseCost: true },
      });
      if (!p) return fail('Selected product does not exist or has been deleted.');
      productPurchaseCost = p.purchaseCost;
    }
    if (storeId) {
      const s = await prisma.store.findFirst({
        where: { id: storeId, deletedAt: null },
        select: { id: true },
      });
      if (!s) return fail('Selected store does not exist or has been deleted.');
    }

    let linkedSale: {
      id: string;
      productId: string;
      storeId: string | null;
      returnsRefunds: number;
      quantitySold: number;
      unitCost: number | null;
    } | null = null;
    if (saleId) {
      linkedSale = await prisma.sale.findFirst({
        where: { id: saleId, deletedAt: null },
        select: {
          id: true,
          productId: true,
          storeId: true,
          returnsRefunds: true,
          quantitySold: true,
          unitCost: true,
        },
      });
      if (!linkedSale)
        return fail('Linked sale does not exist or has been deleted.');
      if (productId && linkedSale.productId !== productId) {
        return fail(
          'The linked sale is for a different product. Pick the sale that matches this product.'
        );
      }
      if (storeId && linkedSale.storeId && linkedSale.storeId !== storeId) {
        return fail(
          'The linked sale belongs to a different store. Pick the sale that matches this store.'
        );
      }
      // Defence-in-depth against double-counting a historical legacy refund.
      const clash = legacyRefundConflict({
        refundStatus,
        chargedTo,
        linkedSaleLegacyRefund: linkedSale.returnsRefunds,
      });
      if (clash) return fail(clash);

      // Cumulative returned quantity must not exceed what the sale sold. Exclude
      // THIS return (by id) so an edit isn't counted against itself.
      const otherLinked = await prisma.return.findMany({
        where: { saleId, deletedAt: null, ...(id ? { id: { not: id } } : {}) },
        select: { quantity: true },
      });
      const qtyError = cumulativeReturnQtyError({
        quantitySold: linkedSale.quantitySold,
        otherLinkedLiveQuantities: otherLinked.map((r) => r.quantity),
        thisQuantity: quantity,
      });
      if (qtyError) return fail(qtyError);
    }

    // --- cost snapshot ------------------------------------------------------
    // Operator value wins; otherwise default from the linked Sale.unitCost
    // (legacy-null falls back to product cost), else the product's cost. Frozen
    // once written — a later Product.purchaseCost change never rewrites it.
    let unitCost: number | null;
    if (submittedUnitCost !== null && !isNaN(submittedUnitCost)) {
      unitCost = submittedUnitCost;
    } else if (linkedSale) {
      unitCost = effectiveSaleUnitCost(linkedSale.unitCost, productPurchaseCost);
    } else {
      unitCost = productPurchaseCost;
    }

    const data = {
      returnDate: returnDate as Date,
      orderDate,
      receivedAt,
      storeId,
      productId,
      saleId,
      buyerName,
      sellerSku,
      orderNumber,
      returnOrderId,
      returnItemId,
      orderItemId,
      quantity,
      paidAmount,
      refundAmount,
      unitCost,
      chargedTo,
      refundStatus,
      inventoryStatus,
      reason,
      status,
      trackingNumber,
      logisticStatus,
      notes,
    };

    if (id) {
      const before = await prisma.return.findUnique({ where: { id } });
      if (!before) return fail('Return not found.');
      if (before.deletedAt)
        return fail('This return is deleted. Restore it before editing.');

      const after = await prisma.$transaction(async (tx) => {
        await tx.return.update({ where: { id }, data });
        // Reverse the old disposition and apply the new one — atomically, and
        // netted per product so an unchanged product yields a single movement.
        await applyTransition(
          tx,
          asDisposition(before),
          { productId, storeId, quantity, inventoryStatus },
          id,
          user
        );
        return tx.return.findUniqueOrThrow({ where: { id } });
      });

      await logAudit({
        user,
        action: 'UPDATE',
        module: 'Returns',
        recordId: id,
        oldValue: snapshot(before),
        newValue: snapshot(after), // final post-transaction state
      });
    } else {
      const created = await prisma.$transaction(async (tx) => {
        const r = await tx.return.create({
          data: { ...data, createdById: user.id, createdBy: user.name },
        });
        await applyTransition(
          tx,
          null,
          { productId, storeId, quantity, inventoryStatus },
          r.id,
          user
        );
        return tx.return.findUniqueOrThrow({ where: { id: r.id } });
      });

      await logAudit({
        user,
        action: 'CREATE',
        module: 'Returns',
        recordId: created.id,
        newValue: snapshot(created), // final post-transaction state
      });
    }

    revalidatePath('/returns');
    revalidatePath('/products');
    revalidatePath('/profit-loss');
    return ok();
  } catch (e) {
    return fail(translateError(e));
  }
}

function translateError(e: unknown): string {
  if (e instanceof Error) {
    if (e.message === INSUFFICIENT_STOCK) {
      return 'Cannot reverse the restock: the returned unit appears to have been sold already, so removing it would drive sellable stock negative. Correct the sale first, or use Damaged/Lost instead.';
    }
    if (e.message.includes('Unique constraint')) {
      if (e.message.includes('returnItemId')) {
        return 'A return with this Return Item ID already exists.';
      }
      if (
        e.message.includes('returnOrderId') ||
        e.message.includes('orderItemId')
      ) {
        return 'A return with this Return Order ID and Order Item ID already exists.';
      }
      return 'This return has already been recorded (duplicate identity).';
    }
    return e.message;
  }
  return 'Failed to save return.';
}

// ---------------------------------------------------------------------------
// Soft delete / restore
// ---------------------------------------------------------------------------

export async function deleteReturn(formData: FormData) {
  await assertPresentationReadOnly();
  const user = await requireUser();
  const id = str(formData.get('id'));
  if (!id) return;

  let error: string | null = null;
  const before = await prisma.return.findUnique({ where: { id } });
  if (!before || before.deletedAt) return;

  try {
    const after = await prisma.$transaction(async (tx) => {
      await tx.return.update({ where: { id }, data: { deletedAt: new Date() } });
      // Reverse its stock effect.
      await applyTransition(tx, asDisposition(before), null, id, user);
      return tx.return.findUniqueOrThrow({ where: { id } });
    });
    await logAudit({
      user,
      action: 'DELETE',
      module: 'Returns',
      recordId: id,
      oldValue: snapshot(before),
      newValue: snapshot(after),
    });
  } catch (e) {
    if (e instanceof Error && e.message === INSUFFICIENT_STOCK) {
      const p = before.productId
        ? await prisma.product.findUnique({
            where: { id: before.productId },
            select: { name: true, currentStock: true },
          })
        : null;
      error = p ? stockMsg(p.name, p.currentStock) : translateError(e);
    } else {
      error = translateError(e);
    }
  }

  if (error) redirect(`/returns?error=${encodeURIComponent(error)}`);
  revalidatePath('/returns');
  revalidatePath('/products');
  revalidatePath('/profit-loss');
}

export async function restoreReturn(formData: FormData) {
  await assertPresentationReadOnly();
  const user = await requireUser();
  const id = str(formData.get('id'));
  if (!id) return;

  let error: string | null = null;
  const before = await prisma.return.findUnique({ where: { id } });
  if (!before || !before.deletedAt) return;

  try {
    const after = await prisma.$transaction(async (tx) => {
      await tx.return.update({ where: { id }, data: { deletedAt: null } });
      // Re-apply its stock effect.
      await applyTransition(tx, null, asDisposition(before), id, user);
      return tx.return.findUniqueOrThrow({ where: { id } });
    });
    await logAudit({
      user,
      action: 'RESTORE',
      module: 'Returns',
      recordId: id,
      oldValue: snapshot(before),
      newValue: snapshot(after),
    });
  } catch (e) {
    error = translateError(e);
  }

  if (error) redirect(`/returns?error=${encodeURIComponent(error)}`);
  revalidatePath('/returns');
  revalidatePath('/products');
  revalidatePath('/profit-loss');
}
