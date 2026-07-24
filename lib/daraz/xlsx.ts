// Server-only workbook/CSV intake: validation + a safe .xlsx reader built on
// exceljs (the unmaintained `xlsx`/SheetJS package was removed — it carried
// unpatched Prototype-Pollution + ReDoS advisories). This module reads only; it
// never evaluates formulas or writes. All limits reject malformed or oversized
// uploads before any parsing work is done.

import ExcelJS from 'exceljs';
import { validateRawOrderHeaders, permittedOrderField, type OrderField } from './sanitize';

// --- upload limits -----------------------------------------------------------
// Sized for the real exports (Orders ~320 KB, Income ~810 KB, combined ~1.13 MB)
// and kept WELL under the Vercel/Next.js request-body ceiling (~4.5 MB). We do
// not claim more than the platform can actually accept.
export const LIMITS = {
  ordersMaxBytes: 3 * 1024 * 1024, // 3 MB
  incomeMaxBytes: 3 * 1024 * 1024, // 3 MB
  combinedMaxBytes: 4 * 1024 * 1024, // 4 MB total request guard (Vercel-safe)
  maxRows: 50_000, // orders sheet hard row cap
  maxColumns: 200, // header-count sanity cap
} as const;

const XLSX_EXT = /\.xlsx$/i;
const CSV_EXT = /\.csv$/i;

// Browsers are inconsistent about spreadsheet MIME types; accept the known set
// plus the generic/empty fallbacks, and rely on extension + structural checks.
const XLSX_MIME = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
  'application/zip',
  '',
]);
const CSV_MIME = new Set([
  'text/csv',
  'application/vnd.ms-excel',
  'application/octet-stream',
  'text/plain',
  '',
]);

export class UploadError extends Error {}

/** Validate an uploaded file's presence, extension, MIME and size. */
export function validateUpload(
  file: unknown,
  kind: 'orders' | 'income'
): asserts file is File {
  if (!(file instanceof File) || file.size === 0) {
    throw new UploadError(
      kind === 'orders'
        ? 'Upload the official Daraz All Orders Excel export (.xlsx). Customer data is discarded automatically.'
        : 'Upload the Daraz Income Order Details CSV.'
    );
  }
  if (kind === 'orders') {
    if (!XLSX_EXT.test(file.name)) throw new UploadError('Orders file must be a .xlsx workbook.');
    if (!XLSX_MIME.has(file.type)) throw new UploadError('Unexpected Orders file type.');
    if (file.size > LIMITS.ordersMaxBytes)
      throw new UploadError('Orders file is too large (max 3 MB).');
  } else {
    if (!CSV_EXT.test(file.name)) throw new UploadError('Income file must be a .csv export.');
    if (!CSV_MIME.has(file.type)) throw new UploadError('Unexpected Income file type.');
    if (file.size > LIMITS.incomeMaxBytes)
      throw new UploadError('Income file is too large (max 3 MB).');
  }
}

/**
 * Read the first worksheet of an Orders .xlsx into header-keyed row objects.
 * Uses row 1 as the header. Enforces worksheet presence, column and row caps.
 * Throws UploadError on a malformed / unexpected workbook.
 */
export async function readOrdersWorkbook(buf: Buffer): Promise<Record<string, unknown>[]> {
  const wb = new ExcelJS.Workbook();
  try {
    // exceljs bundles an older Buffer type than @types/node 20; the value is a
    // real Node Buffer at runtime, so cast to exceljs's expected parameter type.
    await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0]);
  } catch {
    throw new UploadError('The Orders workbook could not be read as a valid .xlsx file.');
  }

  const ws = wb.worksheets[0];
  if (!ws || ws.rowCount < 2) {
    throw new UploadError('The Orders workbook has no data worksheet.');
  }
  if (ws.rowCount - 1 > LIMITS.maxRows) {
    throw new UploadError(`Orders workbook exceeds the ${LIMITS.maxRows}-row limit.`);
  }

  // Header row (row 1). Automatic discard: we build a column map ONLY for the
  // permitted order fields; every other raw column (customer, phone, address,
  // national-ID, billing, shipping, tracking, carrier, prices, notes, …) is
  // dropped here and its values are never even read into memory.
  const headerRow = ws.getRow(1);
  const allHeaderNames: string[] = [];
  const kept: Record<number, OrderField> = {}; // colNumber → permitted field
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const name = cell.value == null ? '' : String(cell.value).trim();
    if (!name) return;
    allHeaderNames.push(name);
    const field = permittedOrderField(name);
    if (field) kept[colNumber] = field;
  });
  if (allHeaderNames.length === 0) throw new UploadError('The Orders workbook has no header row.');
  if (allHeaderNames.length > LIMITS.maxColumns) {
    throw new UploadError('The Orders workbook has an unexpected number of columns.');
  }

  // Accept any real Daraz Orders export; only require the permitted identifier
  // columns to be present. Extra/PII columns are allowed and discarded.
  const headerCheck = validateRawOrderHeaders(allHeaderNames);
  if (!headerCheck.ok) {
    throw new UploadError(headerCheck.error ?? 'The Orders file is not a recognised Daraz export.');
  }

  const rows: Record<string, unknown>[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const obj: Record<string, unknown> = {};
    let any = false;
    // Read ONLY the kept (permitted) columns — PII columns are never accessed.
    for (const [colStr, field] of Object.entries(kept)) {
      const cell = row.getCell(Number(colStr));
      let v: unknown = cell.value;
      // Flatten exceljs rich-text / hyperlink cell objects to their text.
      if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>;
        v = ('text' in o ? o.text : 'result' in o ? o.result : 'richText' in o
          ? (o.richText as { text: string }[]).map((t) => t.text).join('')
          : '') as unknown;
      }
      if (v != null && v !== '') any = true;
      obj[field] = v ?? '';
    }
    if (any) rows.push(obj);
  }
  return rows;
}
