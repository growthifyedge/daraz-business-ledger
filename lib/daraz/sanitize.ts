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
  | 'quantity'
  // Transient only: used to pick the newest status when combining multiple
  // Orders files (Shipping/Delivered/Returned). NEVER stored — it is not a
  // retained order field and is dropped after the combine.
  | 'updateTime';

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
  'order id': 'orderNumber', // Daraz Returned export header (distinct from "Order Item ID")
  orderid: 'orderNumber',
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
  // Update time (transient only — chooses the newest status, never stored)
  updatetime: 'updateTime',
  'update time': 'updateTime',
  updatedat: 'updateTime',
  'updated at': 'updateTime',
  'last update': 'updateTime',
  lastupdated: 'updateTime',
  'status update time': 'updateTime',

  // --- Daraz "Returned" export: same fields under different header names ---
  // Order Number
  'sale order number': 'orderNumber',
  saleordernumber: 'orderNumber',
  'sale order id': 'orderNumber',
  saleorderid: 'orderNumber',
  // Order Line ID
  'return order item id': 'orderItemId',
  returnorderitemid: 'orderItemId',
  'return item id': 'orderItemId',
  // Seller SKU
  'shop sku': 'sellerSku',
  shopsku: 'sellerSku',
  'seller sku id': 'sellerSku',
  sellerskuid: 'sellerSku',
  'sku id': 'sellerSku',
  skuid: 'sellerSku',
  'seller sku code': 'sellerSku',
  // Product Name
  'return product name': 'productName',
  // Order Date (return request/created date)
  'requested date': 'orderDate',
  'return date': 'orderDate',
  'return requested date': 'orderDate',
  'return created time': 'orderDate',
  'return request date': 'orderDate',
  // Order/Return Status
  'return status': 'status',
  returnstatus: 'status',
  'refund status': 'status',
  'return order status': 'status',
  'rma status': 'status',
};

const FIELD_LABEL: Record<OrderField, string> = {
  orderItemId: 'Order Line ID',
  orderNumber: 'Order Number',
  sellerSku: 'Seller SKU',
  productName: 'Product Name',
  orderDate: 'Order Date',
  status: 'Order Status',
  quantity: 'Quantity',
  updateTime: 'Update Time',
};

/** Human label for a permitted order field (for diagnostics). */
export function orderFieldLabel(field: OrderField): string {
  return FIELD_LABEL[field];
}

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

/** A sanitized record plus the TRANSIENT updateTime used only during combine. */
export interface RawOrderRecord extends SanitizedOrderRecord {
  /** Transient — used to choose the newest status; never stored. */
  updateTime?: string;
}

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
 * Extract records from raw order rows. Every non-permitted column is discarded
 * here — the returned records contain ONLY the seven permitted fields, plus the
 * transient `updateTime` (present only if the source had it) used to pick the
 * newest status when combining. Quantity is derived as 1 unless a positive
 * Quantity column is present. Rows without an Order Line ID are skipped.
 */
export function normaliseRawOrderRows(rows: Row[]): RawOrderRecord[] {
  const out: RawOrderRecord[] = [];
  for (const raw of rows) {
    const r = projectRow(raw);
    const orderItemId = r.orderItemId ?? '';
    if (!orderItemId) continue;
    const q = Number((r.quantity ?? '').replace(/,/g, ''));
    const rec: RawOrderRecord = {
      orderItemId,
      orderNumber: r.orderNumber ?? '',
      sellerSku: r.sellerSku ?? '',
      productName: r.productName ?? '',
      orderDate: r.orderDate ?? '',
      status: r.status ?? '',
      quantity: Number.isFinite(q) && q > 0 ? Math.floor(q) : 1,
    };
    if (r.updateTime) rec.updateTime = r.updateTime; // transient only
    out.push(rec);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Combine multiple Orders files by Order Line ID (Shipping/Delivered/Returned)
// ---------------------------------------------------------------------------

/** Lifecycle rank — higher = later state. Fallback when updateTime is absent. */
export function statusRank(status: string): number {
  const x = (status || '').toLowerCase();
  if (/return|refund/.test(x)) return 6;
  if (/cancel|fail/.test(x)) return 5;
  if (/deliver/.test(x)) return 4;
  if (/ship|transit|dispatch|out for/.test(x)) return 3;
  if (/pack|ready|process|pending|unpaid|confirm/.test(x)) return 2;
  return 1;
}

/** Coarse status bucket for preview counts. */
export function statusBucket(status: string): 'shipping' | 'delivered' | 'returned' | 'other' {
  const x = (status || '').toLowerCase();
  if (/return|refund/.test(x)) return 'returned';
  if (/deliver/.test(x)) return 'delivered';
  if (/ship|transit|dispatch|out for/.test(x)) return 'shipping';
  return 'other';
}

const strip = (r: RawOrderRecord): SanitizedOrderRecord => ({
  orderItemId: r.orderItemId,
  orderNumber: r.orderNumber,
  sellerSku: r.sellerSku,
  productName: r.productName,
  orderDate: r.orderDate,
  status: r.status,
  quantity: r.quantity,
});

/** Pick the record representing the newer state: newest updateTime wins; when
 *  updateTime is absent/equal, the later lifecycle status wins. Deterministic
 *  regardless of file order. */
function newer(a: RawOrderRecord, b: RawOrderRecord): RawOrderRecord {
  const ta = a.updateTime ? Date.parse(a.updateTime) : NaN;
  const tb = b.updateTime ? Date.parse(b.updateTime) : NaN;
  if (!Number.isNaN(ta) && !Number.isNaN(tb) && ta !== tb) return ta > tb ? a : b;
  if (!Number.isNaN(ta) && Number.isNaN(tb)) return a;
  if (!Number.isNaN(tb) && Number.isNaN(ta)) return b;
  return statusRank(b.status) >= statusRank(a.status) ? b : a;
}

export interface CombinedOrders {
  /** One record per Order Line ID, in its newest state. updateTime stripped. */
  records: SanitizedOrderRecord[];
  /** Count of final records in each status bucket. */
  byStatus: { shipping: number; delivered: number; returned: number; other: number };
  /** Raw rows removed by combining (same Order Line ID across files/statuses). */
  mergedDuplicates: number;
}

/**
 * Combine order rows from one or many raw Orders files into one record per
 * Order Line ID, keeping the newest status. The transient updateTime is used
 * only to order and is dropped from the result — it is never stored.
 */
export function combineOrderRecords(rows: RawOrderRecord[]): CombinedOrders {
  const byLine = new Map<string, RawOrderRecord>();
  for (const r of rows) {
    const cur = byLine.get(r.orderItemId);
    byLine.set(r.orderItemId, cur ? newer(cur, r) : r);
  }
  const records = [...byLine.values()].map(strip);
  const byStatus = { shipping: 0, delivered: 0, returned: 0, other: 0 };
  for (const r of records) byStatus[statusBucket(r.status)]++;
  return { records, byStatus, mergedDuplicates: rows.length - records.length };
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
