'use server';

import { prisma } from '@/lib/prisma';
import { requireOwner } from '@/lib/auth';
import { type FormState, ok, fail } from '@/lib/formState';
import { parseIncomeCsv, buildIncomeLines, normaliseOrderRows } from '@/lib/daraz/parse';
import { computeDryRun, type DryRunResult, type LedgerProduct } from '@/lib/daraz/dryrun';
import { sha256Hex, batchFingerprint } from '@/lib/daraz/fingerprint';
import {
  validateUpload,
  readOrdersWorkbook,
  LIMITS,
  UploadError,
} from '@/lib/daraz/xlsx';

export interface PreviewState extends FormState {
  result?: DryRunResult;
  meta?: {
    ordersFileName: string;
    incomeFileName: string;
    fingerprint: string;
    ordersRows: number;
    incomeFeeRows: number;
  };
}

/**
 * DRY-RUN ONLY. Reads the uploaded Orders (.xlsx) and Income (.csv) files, joins
 * them, and returns the full preview. It NEVER writes to the database — no
 * import, no SKU-mapping persistence. Owner-only.
 */
export async function previewImport(
  _prev: PreviewState,
  formData: FormData
): Promise<PreviewState> {
  await requireOwner(); // owner/admin gate — customer data is confidential

  const ordersFile = formData.get('ordersFile');
  const incomeFile = formData.get('incomeFile');

  try {
    // --- validate uploads (size / extension / MIME) before any parsing ---
    validateUpload(ordersFile, 'orders');
    validateUpload(incomeFile, 'income');

    // --- Orders .xlsx -> row objects (exceljs; read-only, capped) ---
    const ordersBuf = Buffer.from(await ordersFile.arrayBuffer());
    const orderRows = await readOrdersWorkbook(ordersBuf);
    const orders = normaliseOrderRows(orderRows);

    // --- Income .csv (semicolon long format) ---
    const incomeText = new TextDecoder('utf-8').decode(await incomeFile.arrayBuffer());
    const incomeFeeRows = parseIncomeCsv(incomeText);
    if (incomeFeeRows.length > LIMITS.maxRows) {
      return fail('Income file exceeds the supported row limit.');
    }
    const incomeLines = buildIncomeLines(incomeFeeRows);

    if (orders.length === 0) return fail('No order rows found — is this the All Orders export?');
    if (incomeLines.length === 0)
      return fail('No income lines found — is this the Income Order Details CSV?');

    // --- idempotency inputs (read-only) ---
    const ordersHash = sha256Hex(ordersBuf);
    const incomeHash = sha256Hex(incomeText);
    const fingerprint = batchFingerprint(ordersHash, incomeHash);
    const existingBatch = await prisma.darazImportBatch.findUnique({
      where: { fingerprint },
      select: { id: true },
    });
    const importedRows = await prisma.darazIncomeLine.findMany({
      select: { orderItemId: true },
    });
    const alreadyImported = new Set(importedRows.map((r) => r.orderItemId));

    // --- ledger context: products + persisted SKU mappings ---
    const products = await prisma.product.findMany({
      where: { deletedAt: null },
      select: { id: true, sku: true, name: true, currentStock: true, purchaseCost: true },
    });
    const mappings = await prisma.darazSkuMapping.findMany({
      select: { sellerSku: true, productId: true },
    });

    const result = computeDryRun({
      incomeLines,
      orders,
      skuMappings: mappings,
      products: products as LedgerProduct[],
      alreadyImported,
      batchAlreadyImported: !!existingBatch,
    });

    return {
      ...ok(),
      result,
      meta: {
        ordersFileName: ordersFile.name,
        incomeFileName: incomeFile.name,
        fingerprint,
        ordersRows: orders.length,
        incomeFeeRows: incomeFeeRows.length,
      },
    };
  } catch (err) {
    // UploadError messages are safe (validation only — no file contents / PII).
    // Anything else is reported generically so we never leak customer data.
    if (err instanceof UploadError) return fail(err.message);
    return fail('Could not parse the uploaded files. Check they are the verified Daraz exports.');
  }
}

/**
 * The actual write path is intentionally NOT implemented in this task. Import is
 * disabled; only the dry-run above is available.
 */
export async function runImport(): Promise<FormState> {
  await requireOwner();
  return fail('Import is disabled. This build supports dry-run preview only.');
}
