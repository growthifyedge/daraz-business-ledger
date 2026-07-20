// Pure parsing + validation + duplicate classification for the Bulk Purchase
// Upload PREVIEW. No Prisma, no I/O, no writes - safe to unit-test directly.
// The server action supplies a BulkContext built from the live DB; this module
// only decides how each row should be classified.

export const BULK_PURCHASE_HEADERS = [
  'date',
  'productSku',
  'quantity',
  'unitCost',
  'reference',
  'store',
  'purchasedBy',
  'notes',
] as const;

export type BulkHeader = (typeof BULK_PURCHASE_HEADERS)[number];

export const BULK_LIMITS = {
  maxBytes: 512 * 1024, // 512 KB
  maxRows: 1000,
} as const;

export type BulkRowStatus = 'NEW' | 'DUPLICATE' | 'POSSIBLE_DUPLICATE' | 'ERROR';

export interface RawBulkRow {
  date: string;
  productSku: string;
  quantity: string;
  unitCost: string;
  reference: string;
  store: string;
  purchasedBy: string;
  notes: string;
}

export interface ParsedBulkRow {
  dateISO: string; // yyyy-mm-dd
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  storeId: string | null;
  storeName: string | null;
  purchasedBy: string;
  reference: string;
  notes: string;
}

export interface ClassifiedBulkRow {
  line: number; // 1-based data row number (excludes header)
  input: RawBulkRow;
  status: BulkRowStatus;
  messages: string[];
  parsed?: ParsedBulkRow;
}

export interface BulkContext {
  /** Active products keyed by EXACT sku (case-sensitive). */
  productBySku: Map<string, { id: string; name: string; sku: string }>;
  /** Non-deleted stores keyed by lower-cased name. */
  storeByName: Map<string, { id: string; name: string }>;
  /** refKeyOf(productId, reference) for active purchases that have a reference. */
  existingRefKeys: Set<string>;
  /** softKeyOf(productId, dateISO, qty, unitCost) for active purchases. */
  existingSoftKeys: Set<string>;
}

export interface BulkPreviewSummary {
  total: number;
  new: number;
  duplicate: number;
  possibleDuplicate: number;
  error: number;
}

// ---------------------------------------------------------------------------
// CSV parsing (RFC-style: quoted fields, escaped quotes, CRLF/LF)
// ---------------------------------------------------------------------------

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\r') {
      // ignore; handled by \n
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export class BulkParseError extends Error {}

/**
 * Map a raw cell grid (header row first) into header-keyed rows. Shared by the
 * CSV and the Excel paths so both use IDENTICAL columns and validation. Column
 * order is irrelevant — columns are matched by header name. Throws on a bad header.
 */
export function rowsFromGrid(rawGrid: string[][]): RawBulkRow[] {
  const grid = rawGrid.filter((r) => r.some((c) => (c ?? '').trim() !== ''));
  if (grid.length === 0) throw new BulkParseError('The file is empty.');
  const header = grid[0].map((h) => (h ?? '').trim());
  const idx: Partial<Record<BulkHeader, number>> = {};
  for (const h of BULK_PURCHASE_HEADERS) {
    const at = header.findIndex((x) => x.toLowerCase() === h.toLowerCase());
    if (at === -1) {
      throw new BulkParseError(`Missing required column: "${h}". Use the provided template.`);
    }
    idx[h] = at;
  }
  const get = (cells: string[], h: BulkHeader) => (cells[idx[h]!] ?? '').trim();
  const out: RawBulkRow[] = [];
  for (let i = 1; i < grid.length; i++) {
    const c = grid[i];
    out.push({
      date: get(c, 'date'),
      productSku: get(c, 'productSku'),
      quantity: get(c, 'quantity'),
      unitCost: get(c, 'unitCost'),
      reference: get(c, 'reference'),
      store: get(c, 'store'),
      purchasedBy: get(c, 'purchasedBy'),
      notes: get(c, 'notes'),
    });
  }
  return out;
}

/** Parse CSV text into header-keyed raw rows. Throws BulkParseError on a bad header. */
export function parseBulkPurchaseCsv(text: string): RawBulkRow[] {
  return rowsFromGrid(parseCsv(text));
}

/**
 * Normalise a spreadsheet cell value to a trimmed string that the validators
 * understand. Pure (operates on `unknown`) so it needs no Excel library and is
 * unit-testable: Date → ISO, number → string (so a numeric SKU like 1008 still
 * matches), rich-text/formula → their text/result.
 */
export function cellToString(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.text === 'string') return o.text;
    if ('result' in o) return o.result == null ? '' : String(o.result);
    if (Array.isArray(o.richText)) {
      return (o.richText as Array<{ text?: string }>).map((t) => t.text ?? '').join('');
    }
    return '';
  }
  return String(v);
}

// ---------------------------------------------------------------------------
// Value + key helpers
// ---------------------------------------------------------------------------

function parseDateISO(v: string): string | null {
  const s = v.trim();
  if (!s) return null;
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString().slice(0, 10);
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

const SEP = '|';

/** Duplicate key: reference is unique per product. Exported so the server action
 *  builds the SAME keys when scanning existing purchases. */
export function refKeyOf(productId: string, reference: string): string {
  return [productId, reference.trim().toLowerCase()].join(SEP);
}
export function softKeyOf(
  productId: string,
  dateISO: string,
  qty: number,
  unitCost: number
): string {
  return [productId, dateISO, qty, round2(unitCost)].join(SEP);
}
/** Full-row signature for detecting identical repeated rows within one file. */
function fileSignature(p: ParsedBulkRow): string {
  return [
    p.productId,
    p.dateISO,
    p.quantity,
    round2(p.unitCost),
    p.reference.trim().toLowerCase(),
    p.storeId ?? '',
    p.purchasedBy.toLowerCase(),
    p.notes.trim().toLowerCase(),
  ].join(SEP);
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export function classifyBulkPurchases(
  rows: RawBulkRow[],
  ctx: BulkContext
): { rows: ClassifiedBulkRow[]; summary: BulkPreviewSummary } {
  const seenInFile = new Set<string>();
  const classified: ClassifiedBulkRow[] = [];

  rows.forEach((input, i) => {
    const line = i + 1;
    const messages: string[] = [];

    // ---- validation ----
    const dateISO = parseDateISO(input.date);
    if (!input.date) messages.push('Date is required.');
    else if (!dateISO) messages.push('Invalid date - use YYYY-MM-DD.');

    const sku = input.productSku.trim();
    const product = sku ? ctx.productBySku.get(sku) : undefined;
    if (!sku) messages.push('Product SKU is required.');
    else if (!product) messages.push(`Unknown or inactive SKU "${sku}" (exact active match only).`);

    const quantity = Number(input.quantity.replace(/,/g, '').trim());
    if (input.quantity.trim() === '') messages.push('Quantity is required.');
    else if (!Number.isInteger(quantity) || quantity <= 0)
      messages.push('Quantity must be a whole number greater than zero.');

    const unitCost = Number(input.unitCost.replace(/,/g, '').trim());
    if (input.unitCost.trim() === '') messages.push('Unit cost is required.');
    else if (!Number.isFinite(unitCost) || unitCost < 0)
      messages.push('Unit cost must be a number of zero or more.');

    let storeId: string | null = null;
    let storeName: string | null = null;
    if (input.store.trim()) {
      const store = ctx.storeByName.get(input.store.trim().toLowerCase());
      if (!store) messages.push(`Unknown store "${input.store.trim()}".`);
      else {
        storeId = store.id;
        storeName = store.name;
      }
    }

    if (messages.length > 0) {
      classified.push({ line, input, status: 'ERROR', messages });
      return;
    }

    const parsed: ParsedBulkRow = {
      dateISO: dateISO!,
      productId: product!.id,
      productName: product!.name,
      sku: product!.sku,
      quantity,
      unitCost,
      totalCost: round2(quantity * unitCost),
      storeId,
      storeName,
      purchasedBy: input.purchasedBy.trim() || 'Yahya',
      reference: input.reference.trim(),
      notes: input.notes.trim(),
    };

    // ---- duplicate rules (in precedence order) ----
    let status: BulkRowStatus = 'NEW';
    if (parsed.reference && ctx.existingRefKeys.has(refKeyOf(parsed.productId, parsed.reference))) {
      status = 'DUPLICATE';
      messages.push('Reference already recorded for this product.');
    } else {
      const sig = fileSignature(parsed);
      if (seenInFile.has(sig)) {
        status = 'DUPLICATE';
        messages.push('Identical to an earlier row in this file.');
      } else if (
        ctx.existingSoftKeys.has(
          softKeyOf(parsed.productId, parsed.dateISO, parsed.quantity, parsed.unitCost)
        )
      ) {
        status = 'POSSIBLE_DUPLICATE';
        messages.push(
          'Same date, SKU, quantity and unit cost as an existing purchase - verify before importing.'
        );
      }
      seenInFile.add(sig);
    }

    classified.push({ line, input, status, messages, parsed });
  });

  const summary: BulkPreviewSummary = {
    total: classified.length,
    new: classified.filter((r) => r.status === 'NEW').length,
    duplicate: classified.filter((r) => r.status === 'DUPLICATE').length,
    possibleDuplicate: classified.filter((r) => r.status === 'POSSIBLE_DUPLICATE').length,
    error: classified.filter((r) => r.status === 'ERROR').length,
  };
  return { rows: classified, summary };
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

/** Example data row shared by the CSV and Excel templates so they stay in sync. */
export const BULK_PURCHASE_EXAMPLE_ROW: string[] = [
  '2026-07-18',
  '1008',
  '10',
  '250',
  'INV-1042',
  'Ashu Traderz',
  'Yahya',
  'restock',
];

export function bulkPurchaseTemplateCsv(): string {
  return `${BULK_PURCHASE_HEADERS.join(',')}\n${BULK_PURCHASE_EXAMPLE_ROW.join(',')}\n`;
}
