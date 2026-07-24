// Auto-discard policy for the raw Daraz Orders export — pure, no I/O.
//
// The app accepts the NORMAL official Daraz "All Orders" Excel directly. This
// module extracts ONLY the seven permitted fields and discards every other raw
// column and value (customer, email, phone, address, national-ID, billing,
// shipping, tracking, carrier, prices, notes, …). Discarded data is never
// stored, logged, audited, previewed or exported — it is dropped in memory.
//
// Retained fields:
//   Order Number, Order Line ID, Seller SKU, Product Name, Order Date,
//   Order Status, and a derived quantity (1 per Order Line ID).

export type OrderField =
  | 'orderItemId'
  | 'orderNumber'
  | 'sellerSku'
  | 'productName'
  | 'orderDate'
  | 'status'
  | 'quantity';

/** Required permitted fields for a file to be recognised as a Daraz Orders export. */
export const REQUIRED_ORDER_FIELDS: OrderField[] = [
  'orderItemId',
  'orderNumber',
  'sellerSku',
  'productName',
  'orderDate',
  'status',
];

const norm = (h: string) => h.trim().replace(/\s+/g, ' ').toLowerCase();

// Header aliases → canonical field. Covers the raw Daraz export headers
// (camelCase: orderItemId, itemName, createTime, …) and the human-readable
// variants. Anything NOT listed here is discarded.
const HEADER_TO_FIELD: Record<string, OrderField> = {
  // Order Line ID
  orderitemid: 'orderItemId',
  'order item id': 'orderItemId',
  'order line id': 'orderItemId',
  orderlineid: 'orderItemId',
  // Order Number
  ordernumber: 'orderNumber',
  'order number': 'orderNumber',
  'order no': 'orderNumber',
  orderno: 'orderNumber',
  // Seller SKU
  sellersku: 'sellerSku',
  'seller sku': 'sellerSku',
  sku: 'sellerSku',
  // Product Name (NOT bare "name" — that is customer data)
  itemname: 'productName',
  'item name': 'productName',
  productname: 'productName',
  'product name': 'productName',
  // Order Date
  createtime: 'orderDate',
  'create time': 'orderDate',
  orderdate: 'orderDate',
  'order date': 'orderDate',
  'order creation date': 'orderDate',
  ordercreationdate: 'orderDate',
  // Order Status
  status: 'status',
  'order status': 'status',
  orderstatus: 'status',
  // Quantity (optional — otherwise derived as 1)
  quantity: 'quantity',
  qty: 'quantity',
};

/** Map a raw header to a permitted field, or null if it must be discarded. */
export function permittedOrderField(header: string): OrderField | null {
  return HEADER_TO_FIELD[norm(header)] ?? null;
}

export interface HeaderValidation {
  ok: boolean;
  error?: string;
  /** Required permitted fields not found in the header row. */
  missing?: OrderField[];
  /** Count of raw columns that will be discarded (PII etc.) — informational only,
   *  never the column names, never persisted. */
  discardedColumns?: number;
}

/**
 * Validate a raw Orders header row. Accepts ANY file that contains the required
 * order-identifier columns — extra columns (including PII) are permitted and
 * silently discarded, never a rejection. Pure — returns a result, never throws.
 */
export function validateRawOrderHeaders(headers: string[]): HeaderValidation {
  const present = new Set<OrderField>();
  let discarded = 0;
  for (const h of headers) {
    const f = permittedOrderField(h);
    if (f) present.add(f);
    else if (h.trim()) discarded++;
  }
  const missing = REQUIRED_ORDER_FIELDS.filter((f) => !present.has(f));
  if (missing.length) {
    return {
      ok: false,
      missing,
      error:
        'This does not look like the Daraz All Orders export — missing column(s) for: ' +
        missing.join(', ') +
        '.',
    };
  }
  return { ok: true, discardedColumns: discarded };
}

/** One sanitized order line — a single unit, no PII. */
export interface SanitizedOrderRecord {
  orderItemId: string; // "Order Line ID" — idempotency key + income join key
  orderNumber: string;
  sellerSku: string;
  productName: string;
  orderDate: string;
  status: string;
  quantity: number; // derived = 1 unless a positive Quantity column is present
}

type Row = Record<string, unknown>;

/** Project a raw row down to permitted fields only — discards everything else. */
function projectRow(row: Row): Partial<Record<OrderField, string>> {
  const out: Partial<Record<OrderField, string>> = {};
  for (const [k, v] of Object.entries(row)) {
    const f = permittedOrderField(k);
    if (f && out[f] === undefined) out[f] = v == null ? '' : String(v).trim();
  }
  return out;
}

/**
 * Extract sanitized records from raw order rows. Every non-permitted column is
 * discarded here — the returned records contain ONLY the seven permitted fields.
 * Quantity is derived as 1 unless a positive Quantity column is present. Rows
 * without an Order Line ID are skipped.
 */
export function normaliseRawOrderRows(rows: Row[]): SanitizedOrderRecord[] {
  const out: SanitizedOrderRecord[] = [];
  for (const raw of rows) {
    const r = projectRow(raw);
    const orderItemId = r.orderItemId ?? '';
    if (!orderItemId) continue;
    const q = Number((r.quantity ?? '').replace(/,/g, ''));
    out.push({
      orderItemId,
      orderNumber: r.orderNumber ?? '',
      sellerSku: r.sellerSku ?? '',
      productName: r.productName ?? '',
      orderDate: r.orderDate ?? '',
      status: r.status ?? '',
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
