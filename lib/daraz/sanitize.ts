// Sanitized Orders dataset policy — pure, no I/O, unit-testable.
//
// Phase 4 replaces the raw "All Orders export" (which carried customer PII) with
// a sanitized dataset that must contain ONLY order identifiers. This module is
// the single source of truth for what is permitted and what is rejected, and it
// normalises the permitted columns into a minimal, PII-free record.
//
// Permitted columns (exactly these; Quantity optional — else derived as 1):
//   Order Number, Order Line ID, Seller SKU, Product Name, Order Date, Order Status
//
// Any customer/PII column (name, email, phone, address, national-ID,
// billing/shipping, tracking, etc.) causes the whole file to be rejected — such
// data is never read, stored, encrypted, logged, previewed, audited or committed.

/** Canonical permitted headers. */
export const PERMITTED_ORDER_COLUMNS = [
  'Order Number',
  'Order Line ID',
  'Seller SKU',
  'Product Name',
  'Order Date',
  'Order Status',
] as const;

/** Optional permitted header — quantity is otherwise derived as 1 per line. */
const OPTIONAL_ORDER_COLUMNS = ['Quantity'] as const;

/** Accepted synonyms → canonical header. Kept small and explicit. */
const HEADER_ALIASES: Record<string, string> = {
  'order item id': 'Order Line ID',
  'order line id': 'Order Line ID',
  'order number': 'Order Number',
  'seller sku': 'Seller SKU',
  sku: 'Seller SKU',
  'product name': 'Product Name',
  'order date': 'Order Date',
  'order status': 'Order Status',
  status: 'Order Status',
  quantity: 'Quantity',
  qty: 'Quantity',
};

// Forbidden substrings (case-insensitive). Matched only AGAINST columns that are
// not already a permitted/optional canonical header, so "Product Name" (permitted)
// is never caught by the "name" rule.
const FORBIDDEN_PATTERNS: RegExp[] = [
  /name/, /e-?mail/, /phone/, /mobile/, /contact/, /whatsapp/,
  /address/, /\baddr\b/, /street/, /city/, /post\s*code/, /postcode/, /\bzip\b/, /province/, /region/,
  /national/, /nric/, /cnic/, /\bnid\b/, /passport/, /identity/, /registration/,
  /billing/, /shipping/, /ship\s*to/, /recipient/, /buyer/, /customer/, /consignee/,
  /tracking/, /\btrack\b/, /awb/, /waybill/, /courier/,
];

const norm = (h: string) => h.trim().replace(/\s+/g, ' ');
const canonicalOf = (h: string): string => HEADER_ALIASES[norm(h).toLowerCase()] ?? norm(h);

const PERMITTED_SET = new Set<string>([...PERMITTED_ORDER_COLUMNS, ...OPTIONAL_ORDER_COLUMNS]);

export interface HeaderValidation {
  ok: boolean;
  /** Human-readable rejection message (only when !ok). */
  error?: string;
  /** Offending headers that look like customer/PII data. */
  forbidden?: string[];
  /** Headers that are neither permitted nor recognised PII. */
  unexpected?: string[];
  /** Required permitted headers that are absent. */
  missing?: string[];
}

/**
 * Validate a sanitized Orders header row. Pure — returns a result, never throws.
 * A file is accepted only when every column is a permitted order identifier and
 * all required columns are present. Any PII-shaped column rejects the whole file.
 */
export function validateSanitizedOrderHeaders(headers: string[]): HeaderValidation {
  const seen = headers.map(norm).filter(Boolean);
  const forbidden: string[] = [];
  const unexpected: string[] = [];
  const present = new Set<string>();

  for (const h of seen) {
    const canon = canonicalOf(h);
    if (PERMITTED_SET.has(canon)) {
      present.add(canon);
      continue;
    }
    if (FORBIDDEN_PATTERNS.some((re) => re.test(h.toLowerCase()))) forbidden.push(h);
    else unexpected.push(h);
  }

  const missing = PERMITTED_ORDER_COLUMNS.filter((c) => !present.has(c));

  if (forbidden.length) {
    return {
      ok: false,
      forbidden,
      error:
        `Rejected: the Orders file contains customer/personal-data column(s): ${forbidden.join(', ')}. ` +
        `Upload a sanitized file with only: ${PERMITTED_ORDER_COLUMNS.join(', ')}.`,
    };
  }
  if (missing.length) {
    return { ok: false, missing, error: `The Orders file is missing required column(s): ${missing.join(', ')}.` };
  }
  if (unexpected.length) {
    return {
      ok: false,
      unexpected,
      error:
        `Unexpected column(s) in the Orders file: ${unexpected.join(', ')}. ` +
        `Only these are allowed: ${PERMITTED_ORDER_COLUMNS.join(', ')}${OPTIONAL_ORDER_COLUMNS.length ? ', ' + OPTIONAL_ORDER_COLUMNS.join(', ') : ''}.`,
    };
  }
  return { ok: true };
}

/** One sanitized order line — a single unit, no PII. */
export interface SanitizedOrderRecord {
  orderItemId: string; // "Order Line ID" — the idempotency key + income join key
  orderNumber: string;
  sellerSku: string;
  productName: string;
  orderDate: string;
  status: string;
  quantity: number; // derived = 1 per Order Line ID unless a Quantity column is present
}

type Row = Record<string, unknown>;

/** Read a value by canonical header, tolerating accepted aliases. */
function pick(row: Row, canonical: string): string {
  for (const [k, v] of Object.entries(row)) {
    if (canonicalOf(k) === canonical) return v == null ? '' : String(v).trim();
  }
  return '';
}

/**
 * Normalise permitted-only rows into minimal records. Quantity is derived as 1
 * (one unit per Order Line ID) unless a positive Quantity column is present.
 * Rows without an Order Line ID are skipped.
 */
export function normaliseSanitizedOrderRows(rows: Row[]): SanitizedOrderRecord[] {
  const out: SanitizedOrderRecord[] = [];
  for (const r of rows) {
    const orderItemId = pick(r, 'Order Line ID');
    if (!orderItemId) continue;
    const qRaw = pick(r, 'Quantity');
    const q = Number(qRaw.replace(/,/g, ''));
    out.push({
      orderItemId,
      orderNumber: pick(r, 'Order Number'),
      sellerSku: pick(r, 'Seller SKU'),
      productName: pick(r, 'Product Name'),
      orderDate: pick(r, 'Order Date'),
      status: pick(r, 'Order Status'),
      quantity: Number.isFinite(q) && q > 0 ? Math.floor(q) : 1,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Order-line idempotency planning (Order Line ID is the key).
// ---------------------------------------------------------------------------

/**
 * Split incoming order lines into inserts vs updates against the set of order
 * line IDs already stored. Re-uploading the same Order Line ID is an UPDATE
 * (e.g. a Shipping line that later became Delivered), never a duplicate insert.
 * Pure — the commit uses INSERT … ON CONFLICT to reach the same end state.
 */
export function planOrderLineWrites(
  existingOrderLineIds: Set<string>,
  incoming: SanitizedOrderRecord[]
): { inserts: SanitizedOrderRecord[]; updates: SanitizedOrderRecord[] } {
  const inserts: SanitizedOrderRecord[] = [];
  const updates: SanitizedOrderRecord[] = [];
  const handled = new Set<string>();
  for (const o of incoming) {
    if (handled.has(o.orderItemId)) continue; // one row per Order Line ID within a file
    handled.add(o.orderItemId);
    if (existingOrderLineIds.has(o.orderItemId)) updates.push(o);
    else inserts.push(o);
  }
  return { inserts, updates };
}
