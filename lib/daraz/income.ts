// Pure, store- and date-scoped roll-up of imported Daraz income into clear
// financial buckets. NO I/O, NO Prisma — the caller supplies already-fetched
// income lines (with their categorised fees). This module ONLY aggregates and
// proves reconciliation; it is NOT wired into Dashboard / P&L / Reports / Cash
// Flow yet, and it never touches stock, COGS, Purchases, Yahya, Sales,
// Settlements or Returns.
//
// Reconciliation invariant: at import time every line's netAmount equals the sum
// of its fee amounts, so the sum of all category buckets equals the sum of the
// lines' Daraz-authoritative net. This helper asserts that equality.

import { ALL_FEE_CATEGORIES, round2, type FeeCategory } from './fees';

/** One income line as needed for the roll-up (a subset of DarazIncomeLine). */
export interface IncomeLineForRollup {
  storeId?: string | null;
  statementNumber: string;
  orderItemId: string;
  /** Daraz transaction date — used only for date scoping. */
  transactionDate?: Date | string | null;
  /** Daraz-authoritative net for this statement line. */
  netAmount: number;
  fees: { category: FeeCategory; amount: number }[];
}

export interface IncomeRollupFilter {
  storeId?: string | null;
  from?: Date | null;
  to?: Date | null;
}

export interface DarazIncomeRollup {
  // Scope + counts
  statements: number; // distinct statement numbers
  lines: number; // statement lines included
  orderItems: number; // distinct Order Line IDs

  // Per-category totals (signed; sum to categoryNet). Never collapse categories.
  byCategory: Record<FeeCategory, number>;

  // Named credits (money in)
  productRevenue: number; // PRODUCT_REVENUE
  buyerShippingCredit: number; // BUYER_SHIPPING_CREDIT
  shippingDiscount: number; // SHIPPING_DISCOUNT (credit offsetting shipping)
  reversals: number; // REVERSAL (credit)

  // Named deductions (money out; negative)
  commission: number; // COMMISSION
  paymentFee: number; // PAYMENT_FEE
  shippingFee: number; // SHIPPING_FEE
  freeShippingMaxFee: number; // FREE_SHIPPING_MAX_FEE
  handlingFee: number; // HANDLING_FEE
  coins: number; // COINS_PARTICIPATION
  voucher: number; // VOUCHER_PARTICIPATION
  incomeTaxWht: number; // INCOME_TAX_WHT
  salesTaxWht: number; // SALES_TAX_WHT
  refunds: number; // REFUND (already inside Daraz net — must not be double-counted by Returns)
  otherFees: number; // OTHER (unrecognised — surfaced, never dropped)

  // Grouped roll-ups
  grossRevenue: number; // productRevenue + buyerShippingCredit (buyer-paid gross)
  totalCredits: number; // Σ positive category amounts
  totalDeductions: number; // Σ negative category amounts
  darazFees: number; // commission + payment + shipping + freeShipMax + handling + coins + voucher + shippingDiscount
  taxesWithheld: number; // incomeTaxWht + salesTaxWht

  // Reconciliation (the proof)
  net: number; // Σ line.netAmount — Daraz-authoritative
  categoryNet: number; // Σ byCategory
  reconDiff: number; // categoryNet − net (must be 0)
  reconciles: boolean; // reconDiff === 0
}

/**
 * Whether a Daraz income line's release status means the money was actually
 * RELEASED (paid out) — used to add Daraz net to Cash Flow only when realised.
 * "Released" → true; "Ready to Release", "Not Released", "Pending" → false.
 */
export function isReleased(status: string | null | undefined): boolean {
  const x = (status ?? '').toLowerCase();
  return x.includes('released') && !x.includes('not');
}

function emptyCat(): Record<FeeCategory, number> {
  const m = {} as Record<FeeCategory, number>;
  for (const c of ALL_FEE_CATEGORIES) m[c] = 0;
  return m;
}

function ts(d: Date | string | null | undefined): number | null {
  if (d == null) return null;
  const t = d instanceof Date ? d.getTime() : Date.parse(String(d));
  return Number.isNaN(t) ? null : t;
}

function inRange(line: IncomeLineForRollup, f: IncomeRollupFilter): boolean {
  if (f.storeId && (line.storeId ?? null) !== f.storeId) return false;
  if (f.from || f.to) {
    const t = ts(line.transactionDate);
    if (t == null) return false; // a dated filter excludes undated lines
    if (f.from && t < f.from.getTime()) return false;
    if (f.to && t > f.to.getTime()) return false;
  }
  return true;
}

/**
 * Aggregate income lines into financial buckets, scoped by store and/or date.
 * Pure. The returned `net` is the Daraz-authoritative line net; `categoryNet` is
 * the sum of every fee category; `reconciles` proves they are equal.
 */
export function rollUpDarazIncome(
  lines: IncomeLineForRollup[],
  filter: IncomeRollupFilter = {}
): DarazIncomeRollup {
  const byCategory = emptyCat();
  const statements = new Set<string>();
  const orderItems = new Set<string>();
  let lineCount = 0;
  let net = 0;

  for (const l of lines) {
    if (!inRange(l, filter)) continue;
    lineCount += 1;
    if (l.statementNumber) statements.add(l.statementNumber);
    if (l.orderItemId) orderItems.add(l.orderItemId);
    net = round2(net + l.netAmount);
    for (const fee of l.fees) byCategory[fee.category] = round2(byCategory[fee.category] + fee.amount);
  }

  let totalCredits = 0;
  let totalDeductions = 0;
  for (const c of ALL_FEE_CATEGORIES) {
    const v = byCategory[c];
    if (v > 0) totalCredits = round2(totalCredits + v);
    else if (v < 0) totalDeductions = round2(totalDeductions + v);
  }

  const productRevenue = byCategory.PRODUCT_REVENUE;
  const buyerShippingCredit = byCategory.BUYER_SHIPPING_CREDIT;
  const shippingDiscount = byCategory.SHIPPING_DISCOUNT;
  const commission = byCategory.COMMISSION;
  const paymentFee = byCategory.PAYMENT_FEE;
  const shippingFee = byCategory.SHIPPING_FEE;
  const freeShippingMaxFee = byCategory.FREE_SHIPPING_MAX_FEE;
  const handlingFee = byCategory.HANDLING_FEE;
  const coins = byCategory.COINS_PARTICIPATION;
  const voucher = byCategory.VOUCHER_PARTICIPATION;
  const incomeTaxWht = byCategory.INCOME_TAX_WHT;
  const salesTaxWht = byCategory.SALES_TAX_WHT;
  const refunds = byCategory.REFUND;
  const reversals = byCategory.REVERSAL;
  const otherFees = byCategory.OTHER;

  const categoryNet = round2(ALL_FEE_CATEGORIES.reduce((s, c) => s + byCategory[c], 0));

  return {
    statements: statements.size,
    lines: lineCount,
    orderItems: orderItems.size,
    byCategory,
    productRevenue,
    buyerShippingCredit,
    shippingDiscount,
    reversals,
    commission,
    paymentFee,
    shippingFee,
    freeShippingMaxFee,
    handlingFee,
    coins,
    voucher,
    incomeTaxWht,
    salesTaxWht,
    refunds,
    otherFees,
    grossRevenue: round2(productRevenue + buyerShippingCredit),
    totalCredits,
    totalDeductions,
    darazFees: round2(
      commission + paymentFee + shippingFee + freeShippingMaxFee + handlingFee + coins + voucher + shippingDiscount
    ),
    taxesWithheld: round2(incomeTaxWht + salesTaxWht),
    net,
    categoryNet,
    reconDiff: round2(categoryNet - net),
    reconciles: round2(categoryNet - net) === 0,
  };
}
