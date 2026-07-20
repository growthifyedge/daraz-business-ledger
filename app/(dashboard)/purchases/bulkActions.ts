'use server';

import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth';
import { type FormState, fail, ok } from '@/lib/formState';
import {
  parseBulkPurchaseCsv,
  classifyBulkPurchases,
  refKeyOf,
  softKeyOf,
  BulkParseError,
  BULK_LIMITS,
  type BulkContext,
  type ClassifiedBulkRow,
  type BulkPreviewSummary,
} from '@/lib/purchaseBulk';

export interface BulkPreviewState extends FormState {
  fileName?: string;
  rows?: ClassifiedBulkRow[];
  summary?: BulkPreviewSummary;
}

/**
 * READ-ONLY preview for the Bulk Purchase Upload. Parses the CSV, validates it
 * against active products/stores and existing active purchases, and classifies
 * every row. It NEVER writes: no purchase, stock, movement or audit change.
 */
export async function previewBulkPurchases(
  _prev: BulkPreviewState,
  formData: FormData
): Promise<BulkPreviewState> {
  await requireUser(); // same gate as the rest of the Purchases module

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return fail('Choose a CSV file to preview.');
  }
  if (!/\.csv$/i.test(file.name)) {
    return fail('The bulk upload must be a .csv file from the template.');
  }
  if (file.size > BULK_LIMITS.maxBytes) {
    return fail('File is too large (max 512 KB).');
  }

  let rows;
  try {
    const text = new TextDecoder('utf-8').decode(await file.arrayBuffer());
    rows = parseBulkPurchaseCsv(text);
  } catch (e) {
    if (e instanceof BulkParseError) return fail(e.message);
    return fail('Could not read the CSV. Use the provided template.');
  }

  if (rows.length === 0) return fail('No data rows found under the header.');
  if (rows.length > BULK_LIMITS.maxRows) {
    return fail(`Too many rows (${rows.length}). The limit is ${BULK_LIMITS.maxRows}.`);
  }

  // ---- read-only context from the live DB ----
  const [products, stores, purchases] = await Promise.all([
    prisma.product.findMany({
      where: { deletedAt: null, active: true },
      select: { id: true, name: true, sku: true },
    }),
    prisma.store.findMany({ where: { deletedAt: null }, select: { id: true, name: true } }),
    prisma.purchase.findMany({
      where: { deletedAt: null },
      select: { productId: true, date: true, quantity: true, unitCost: true, bankReference: true },
    }),
  ]);

  const ctx: BulkContext = {
    productBySku: new Map(products.map((p) => [p.sku, p])),
    storeByName: new Map(stores.map((s) => [s.name.toLowerCase(), s])),
    existingRefKeys: new Set(
      purchases
        .filter((p) => p.bankReference && p.bankReference.trim())
        .map((p) => refKeyOf(p.productId, p.bankReference!))
    ),
    existingSoftKeys: new Set(
      purchases.map((p) =>
        softKeyOf(p.productId, p.date.toISOString().slice(0, 10), p.quantity, p.unitCost)
      )
    ),
  };

  const { rows: classified, summary } = classifyBulkPurchases(rows, ctx);

  return { ...ok(), fileName: file.name, rows: classified, summary };
}
