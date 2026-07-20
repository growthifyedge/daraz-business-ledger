'use server';

import ExcelJS from 'exceljs';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth';
import { type FormState, fail, ok } from '@/lib/formState';
import {
  parseBulkPurchaseCsv,
  rowsFromGrid,
  cellToString,
  classifyBulkPurchases,
  refKeyOf,
  softKeyOf,
  BulkParseError,
  BULK_LIMITS,
  type BulkContext,
  type ClassifiedBulkRow,
  type BulkPreviewSummary,
  type RawBulkRow,
} from '@/lib/purchaseBulk';

/** Read the first worksheet of an .xlsx buffer into a raw string cell grid,
 *  then map it through the SAME rowsFromGrid used for CSV. Read-only. */
async function readXlsxRows(buf: Buffer): Promise<RawBulkRow[]> {
  const wb = new ExcelJS.Workbook();
  try {
    // exceljs bundles an older Buffer type than @types/node; the value is a real
    // Node Buffer at runtime.
    await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0]);
  } catch {
    throw new BulkParseError('Could not read the Excel workbook. Use the provided template.');
  }
  const ws = wb.worksheets[0];
  if (!ws || ws.rowCount < 1) throw new BulkParseError('The Excel file has no worksheet data.');
  const colCount = Math.max(ws.columnCount, 1);
  const grid: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    for (let c = 1; c <= colCount; c++) cells.push(cellToString(row.getCell(c).value));
    grid.push(cells);
  });
  return rowsFromGrid(grid);
}

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
    return fail('Choose a .csv or .xlsx file to preview.');
  }
  const isXlsx = /\.xlsx$/i.test(file.name);
  const isCsv = /\.csv$/i.test(file.name);
  if (!isXlsx && !isCsv) {
    return fail('The bulk upload must be a .csv or .xlsx file from a template.');
  }
  if (file.size > BULK_LIMITS.maxBytes) {
    return fail('File is too large (max 512 KB).');
  }

  let rows;
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    if (isXlsx) {
      rows = await readXlsxRows(buf);
    } else {
      rows = parseBulkPurchaseCsv(new TextDecoder('utf-8').decode(buf));
    }
  } catch (e) {
    if (e instanceof BulkParseError) return fail(e.message);
    return fail('Could not read the file. Use the provided CSV or Excel template.');
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
