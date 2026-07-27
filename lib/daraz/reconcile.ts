// Pure, DB-free write-payload + reconciliation helpers shared by the commit and
// reprocess persistence paths. Kept out of persist.ts (which imports Prisma) so
// the exact payloads a transaction will write — and the guards that must hold —
// are unit-testable without a database.

import { parseDarazDate, type IncomeLine } from './parse';
import { round2 } from './fees';

/**
 * The full DarazIncomeLine field payload written for one parsed statement line.
 * This is the SINGLE source of truth for both an insert and an in-place update,
 * so the two can never drift (a drift is what let updates persist stale zeros).
 * Contains the authoritative financial figures — netAmount is never derived from
 * anything but the parsed line.
 */
export function incomeLineWriteData(il: IncomeLine) {
  return {
    orderNumber: il.orderNumber || null,
    sellerSku: il.sellerSku || null,
    productName: il.productName || null,
    statementPeriod: il.statementPeriod || null,
    transactionDate: parseDarazDate(il.transactionDates[0]),
    orderCreationDate: parseDarazDate(il.orderCreationDate),
    orderStatus: il.orderStatus || null,
    releaseStatus: il.releaseStatus || null,
    productPriceRevenue: il.productPriceRevenue,
    buyerShippingCredit: il.buyerShippingCredit,
    totalCredits: il.totalCredits,
    totalDeductions: il.totalDeductions,
    netAmount: il.netAmount,
    reconciled: round2(il.totalCredits + il.totalDeductions) === il.netAmount,
  };
}

/** The DarazIncomeFee rows for one statement line, preserving every original fee. */
export function incomeFeeCreateRows(incomeLineId: string, il: IncomeLine) {
  return il.fees.map((f) => ({
    incomeLineId,
    label: f.label,
    category: f.category,
    amount: f.amount,
    vatAmount: f.vatAmount,
    isRefund: f.isRefund,
    isReversal: f.isReversal,
  }));
}

/** Sum of netAmount across parsed statement lines (the authoritative source total). */
export function sumNet(lines: Array<{ netAmount: number }>): number {
  return round2(lines.reduce((s, l) => s + l.netAmount, 0));
}

/**
 * The authoritative total printed in the Daraz Income CSV banner, e.g.
 * "…the total to release amount is PKR 70,596.09". Independent of the per-fee
 * amount parse, so it catches a whole-file zero (banner non-zero, persisted 0).
 * Returns null when no banner total is present.
 */
export function parseIncomeBannerTotal(text: string): number | null {
  const clean = text.replace(/^\ufeff/, '');
  const head = clean.split(/\r?\n/).slice(0, 3).join('\n');
  const m = head.match(/PKR\s*([\d,]+(?:\.\d+)?)/i);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Two money figures agree within half a cent (rounding-safe equality). */
export function reconciles(a: number, b: number): boolean {
  return Math.abs(round2(a) - round2(b)) < 0.005;
}
