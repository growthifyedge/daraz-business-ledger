'use server';

import ExcelJS from 'exceljs';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { recordMovement } from '@/lib/stock';
import { type FormState, fail, ok } from '@/lib/formState';
import {
  parseBulkPurchaseCsv,
  rowsFromGrid,
  cellToString,
  classifyBulkPurchases,
  selectImportableRows,
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

interface Classified {
  error?: string;
  fileName?: string;
  rows?: ClassifiedBulkRow[];
  summary?: BulkPreviewSummary;
}

/**
 * The single source of truth: validate the uploaded file, parse it (CSV or
 * Excel), and classify every row against the LIVE database. Both the read-only
 * preview and the commit path call this, so the commit re-validates against
 * fresh data immediately before writing (idempotency + no stale classifications).
 */
async function readAndClassify(file: unknown): Promise<Classified> {
  if (!(file instanceof File) || file.size === 0) {
    return { error: 'Choose a .csv or .xlsx file.' };
  }
  const isXlsx = /\.xlsx$/i.test(file.name);
  const isCsv = /\.csv$/i.test(file.name);
  if (!isXlsx && !isCsv) return { error: 'The bulk upload must be a .csv or .xlsx file from a template.' };
  if (file.size > BULK_LIMITS.maxBytes) return { error: 'File is too large (max 512 KB).' };

  let rows: RawBulkRow[];
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    rows = isXlsx ? await readXlsxRows(buf) : parseBulkPurchaseCsv(new TextDecoder('utf-8').decode(buf));
  } catch (e) {
    if (e instanceof BulkParseError) return { error: e.message };
    return { error: 'Could not read the file. Use the provided CSV or Excel template.' };
  }

  if (rows.length === 0) return { error: 'No data rows found under the header.' };
  if (rows.length > BULK_LIMITS.maxRows) {
    return { error: `Too many rows (${rows.length}). The limit is ${BULK_LIMITS.maxRows}.` };
  }

  const [products, stores, purchases] = await Promise.all([
    prisma.product.findMany({
      where: { deletedAt: null, active: true },
      select: { id: true, name: true, sku: true },
    }),
    prisma.store.findMany({ where: { deletedAt: null }, select: { id: true, name: true } }),
    prisma.purchase.findMany({
      where: { deletedAt: null },
      select: {
        productId: true,
        storeId: true,
        date: true,
        quantity: true,
        unitCost: true,
        bankReference: true,
      },
    }),
  ]);

  const ctx: BulkContext = {
    productBySku: new Map(products.map((p) => [p.sku, p])),
    storeByName: new Map(stores.map((s) => [s.name.toLowerCase(), s])),
    existingRefKeys: new Set(
      purchases
        .filter((p) => p.bankReference && p.bankReference.trim())
        .map((p) => refKeyOf(p.productId, p.bankReference!, p.storeId))
    ),
    existingSoftKeys: new Set(
      purchases.map((p) =>
        softKeyOf(p.productId, p.date.toISOString().slice(0, 10), p.quantity, p.unitCost)
      )
    ),
  };

  const { rows: classified, summary } = classifyBulkPurchases(rows, ctx);
  return { fileName: file.name, rows: classified, summary };
}

// ---------------------------------------------------------------------------
// Preview (read-only)
// ---------------------------------------------------------------------------

export interface BulkPreviewState extends FormState {
  fileName?: string;
  rows?: ClassifiedBulkRow[];
  summary?: BulkPreviewSummary;
}

/** READ-ONLY preview. Never writes. */
export async function previewBulkPurchases(formData: FormData): Promise<BulkPreviewState> {
  await requireUser();
  const c = await readAndClassify(formData.get('file'));
  if (c.error) return fail(c.error);
  return { ...ok(), fileName: c.fileName, rows: c.rows, summary: c.summary };
}

// ---------------------------------------------------------------------------
// Commit (atomic write)
// ---------------------------------------------------------------------------

export interface BulkCommitState extends FormState {
  imported?: number;
  skipped?: number;
  fileName?: string;
}

/**
 * Import NEW rows (always) and POSSIBLE_DUPLICATE rows the operator explicitly
 * ticked "Import anyway". ERROR and DUPLICATE rows are never imported. The file
 * is re-validated against the live DB here (the server decides, not the client),
 * so re-uploading the same sheet safely writes nothing. Every purchase and its
 * PURCHASE stock movement are written in ONE transaction — if any row fails,
 * nothing is written. All rows default to RECONCILIATION_PENDING.
 */
export async function commitBulkPurchases(formData: FormData): Promise<BulkCommitState> {
  const user = await requireUser();

  const importAnyway = new Set(
    String(formData.get('importAnyway') ?? '')
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isInteger(n))
  );

  // Re-validate against fresh data immediately before writing.
  const c = await readAndClassify(formData.get('file'));
  if (c.error) return fail(c.error);
  const rows = c.rows!;

  // Server decides what is importable — never trust the client's classification.
  const toImport = selectImportableRows(rows, importAnyway);
  if (toImport.length === 0) {
    return fail(
      'Nothing to import. NEW rows import automatically; tick "Import anyway" for possible duplicates.'
    );
  }

  const created: Array<{ id: string; parsed: NonNullable<ClassifiedBulkRow['parsed']> }> = [];
  try {
    await prisma.$transaction(
      async (tx) => {
        for (const r of toImport) {
          const p = r.parsed!;
          const purchase = await tx.purchase.create({
            data: {
              date: new Date(p.dateISO),
              purchasedBy: p.purchasedBy,
              storeId: p.storeId,
              productId: p.productId,
              quantity: p.quantity,
              unitCost: p.unitCost,
              totalCost: p.totalCost,
              // Bulk imports are payment-neutral: never shown as owed or paid.
              paymentStatus: 'RECONCILIATION_PENDING',
              bankReference: p.reference || null,
              notes: p.notes || null,
              createdById: user.id,
              createdBy: user.name,
            },
          });
          // Same trusted stock logic as manual New Purchase.
          await recordMovement(tx, {
            productId: p.productId,
            storeId: p.storeId,
            type: 'PURCHASE',
            quantity: p.quantity,
            reference: purchase.id,
            note: `Bulk purchase from ${p.purchasedBy}`,
            user,
          });
          created.push({ id: purchase.id, parsed: p });
        }
      },
      { timeout: 120_000, maxWait: 20_000 }
    );
  } catch {
    // Atomic: the whole transaction rolled back — nothing was written.
    return fail('Import failed and was rolled back — no rows were written.');
  }

  // Audit each created purchase (mirrors the manual New Purchase trail).
  for (const c2 of created) {
    await logAudit({
      user,
      action: 'CREATE',
      module: 'Purchases',
      recordId: c2.id,
      newValue: {
        source: 'bulk-import',
        fileName: c.fileName,
        productId: c2.parsed.productId,
        quantity: c2.parsed.quantity,
        unitCost: c2.parsed.unitCost,
        totalCost: c2.parsed.totalCost,
        paymentStatus: 'RECONCILIATION_PENDING',
      },
    });
  }

  revalidatePath('/purchases');
  revalidatePath('/products');

  const imported = created.length;
  const skipped = rows.length - imported;
  return { ...ok(), imported, skipped, fileName: c.fileName };
}
