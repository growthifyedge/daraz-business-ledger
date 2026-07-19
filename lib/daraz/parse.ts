// Parsers for the two verified Daraz export formats. Pure: they take file
// text / already-decoded rows and return typed records. No I/O, no DB.

import { toCategorisedFee, type CategorisedFee } from './fees';

// ---------------------------------------------------------------------------
// Income CSV — semicolon-delimited, long fee format
// ---------------------------------------------------------------------------
//
// Layout: row 0 banner, row 1 blank, row 2 header, rows 3+ one row per fee.
// Header columns (verified):
//   Statement Period; Statement Number; Transaction Date; Fee Name;
//   Est Release Amount(Include Tax); VAT Amount; Release Status; Comment;
//   Order Creation Date; Order Number; Order Line ID; Seller SKU; Lazada SKU;
//   WHT Amount; WHT included in Amount; Order Status; Product Name; Short Code

export interface IncomeFeeRow {
  statementPeriod: string;
  statementNumber: string;
  transactionDate: string;
  feeName: string;
  amount: number;
  vatAmount: number;
  releaseStatus: string;
  orderCreationDate: string;
  orderNumber: string;
  orderItemId: string; // "Order Line ID" — the join key to Orders orderItemId
  sellerSku: string;
  orderStatus: string;
  productName: string;
}

function num(v: string | undefined): number {
  if (v == null) return 0;
  const n = Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}

/** Parse a semicolon CSV line (no embedded-semicolon quoting is used by Daraz). */
function splitSemicolon(line: string): string[] {
  return line.split(';').map((c) => c.trim());
}

export function parseIncomeCsv(text: string): IncomeFeeRow[] {
  const clean = text.replace(/^﻿/, '');
  const lines = clean.split(/\r?\n/);
  // Find the header row: the first line containing "Order Line ID".
  let headerIdx = -1;
  for (let i = 0; i < Math.min(lines.length, 8); i++) {
    if (lines[i].includes('Order Line ID')) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) return [];
  const header = splitSemicolon(lines[headerIdx]);
  const col = (name: string) => header.findIndex((h) => h === name);
  const c = {
    period: col('Statement Period'),
    stmt: col('Statement Number'),
    txn: col('Transaction Date'),
    fee: col('Fee Name'),
    amt: col('Est Release Amount(Include Tax)'),
    vat: col('VAT Amount'),
    rel: col('Release Status'),
    ocd: col('Order Creation Date'),
    ordno: col('Order Number'),
    olid: col('Order Line ID'),
    sku: col('Seller SKU'),
    ostat: col('Order Status'),
    pname: col('Product Name'),
  };
  const out: IncomeFeeRow[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw || !raw.trim()) continue;
    const r = splitSemicolon(raw);
    const orderItemId = r[c.olid];
    if (!orderItemId) continue;
    out.push({
      statementPeriod: r[c.period] ?? '',
      statementNumber: r[c.stmt] ?? '',
      transactionDate: r[c.txn] ?? '',
      feeName: r[c.fee] ?? '',
      amount: num(r[c.amt]),
      vatAmount: num(r[c.vat]),
      releaseStatus: r[c.rel] ?? '',
      orderCreationDate: r[c.ocd] ?? '',
      orderNumber: r[c.ordno] ?? '',
      orderItemId,
      sellerSku: r[c.sku] ?? '',
      orderStatus: r[c.ostat] ?? '',
      productName: r[c.pname] ?? '',
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Orders — 77-column export, one row per unique orderItemId (one unit)
// ---------------------------------------------------------------------------
//
// The route decodes the .xlsx to an array of header-keyed objects (via exceljs,
// in lib/daraz/xlsx.ts); this normaliser is pure and used by both the route and
// the tests. Only the
// business + PII fields we retain are mapped; the rest are ignored.

export interface OrderItemRecord {
  orderItemId: string;
  orderNumber: string;
  sellerSku: string;
  lazadaSku: string;
  itemName: string;
  variation: string;
  quantity: number; // always 1 — one unit per unique orderItemId
  unitPrice: number;
  paidPrice: number;
  status: string;
  createTime: string;
  deliveredDate: string;
  trackingCode: string;
  trackingUrl: string;
  shippingProvider: string;
  // customer + shipping + billing (confidential — preserved, masked in UI)
  customerName: string;
  customerEmail: string;
  nationalRegistrationNumber: string;
  shippingName: string;
  shippingAddress: string;
  shippingPhone: string;
  shippingCity: string;
  shippingPostCode: string;
  billingName: string;
  billingAddress: string;
  billingPhone: string;
  billingCity: string;
}

type Row = Record<string, unknown>;
const str = (v: unknown): string => (v == null ? '' : String(v).trim());

export function normaliseOrderRows(rows: Row[]): OrderItemRecord[] {
  const out: OrderItemRecord[] = [];
  for (const r of rows) {
    const orderItemId = str(r['orderItemId']);
    if (!orderItemId) continue;
    out.push({
      orderItemId,
      orderNumber: str(r['orderNumber']),
      sellerSku: str(r['sellerSku']),
      lazadaSku: str(r['lazadaSku']),
      itemName: str(r['itemName']),
      variation: str(r['variation']),
      quantity: 1,
      unitPrice: num(str(r['unitPrice'])),
      paidPrice: num(str(r['paidPrice'])),
      status: str(r['status']),
      createTime: str(r['createTime']),
      deliveredDate: str(r['deliveredDate']),
      trackingCode: str(r['trackingCode']),
      trackingUrl: str(r['trackingUrl']),
      shippingProvider: str(r['shippingProvider']),
      customerName: str(r['customerName']),
      customerEmail: str(r['customerEmail']),
      nationalRegistrationNumber: str(r['nationalRegistrationNumber']),
      shippingName: str(r['shippingName']),
      shippingAddress: [
        str(r['shippingAddress']),
        str(r['shippingAddress2']),
        str(r['shippingAddress3']),
      ]
        .filter(Boolean)
        .join(', '),
      shippingPhone: str(r['shippingPhone']),
      shippingCity: str(r['shippingCity']),
      shippingPostCode: str(r['shippingPostCode']),
      billingName: str(r['billingName']),
      billingAddress: [str(r['billingAddr']), str(r['billingAddr2'])]
        .filter(Boolean)
        .join(', '),
      billingPhone: str(r['billingPhone']),
      billingCity: str(r['billingCity']),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Aggregate income fee rows into one line per orderItemId
// ---------------------------------------------------------------------------

export interface IncomeLine {
  orderItemId: string;
  orderNumber: string;
  sellerSku: string;
  productName: string;
  statementNumbers: string[];
  statementPeriods: string[];
  transactionDates: string[];
  orderCreationDate: string;
  orderStatus: string;
  releaseStatus: string;
  fees: CategorisedFee[];
  productPriceRevenue: number;
  buyerShippingCredit: number;
  totalCredits: number;
  totalDeductions: number;
  netAmount: number; // Daraz-authoritative net (sum of all fee amounts)
}

export function buildIncomeLines(rows: IncomeFeeRow[]): IncomeLine[] {
  const byLine = new Map<string, IncomeFeeRow[]>();
  for (const r of rows) {
    const arr = byLine.get(r.orderItemId) ?? [];
    arr.push(r);
    byLine.set(r.orderItemId, arr);
  }
  const out: IncomeLine[] = [];
  for (const [orderItemId, rs] of byLine) {
    const fees = rs.map((r) => toCategorisedFee(r.feeName, r.amount, r.vatAmount));
    const productPriceRevenue = round2(
      fees.filter((f) => f.category === 'PRODUCT_REVENUE').reduce((s, f) => s + f.amount, 0)
    );
    const buyerShippingCredit = round2(
      fees
        .filter((f) => f.category === 'BUYER_SHIPPING_CREDIT')
        .reduce((s, f) => s + f.amount, 0)
    );
    const totalCredits = round2(
      fees.filter((f) => f.amount > 0).reduce((s, f) => s + f.amount, 0)
    );
    const totalDeductions = round2(
      fees.filter((f) => f.amount < 0).reduce((s, f) => s + f.amount, 0)
    );
    const netAmount = round2(totalCredits + totalDeductions);
    const first = rs[0];
    out.push({
      orderItemId,
      orderNumber: first.orderNumber,
      sellerSku: first.sellerSku,
      productName: first.productName,
      statementNumbers: [...new Set(rs.map((r) => r.statementNumber))].sort(),
      statementPeriods: [...new Set(rs.map((r) => r.statementPeriod))].sort(),
      transactionDates: [...new Set(rs.map((r) => r.transactionDate))].sort(),
      orderCreationDate: first.orderCreationDate,
      orderStatus: first.orderStatus,
      releaseStatus: first.releaseStatus,
      fees,
      productPriceRevenue,
      buyerShippingCredit,
      totalCredits,
      totalDeductions,
      netAmount,
    });
  }
  return out;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
