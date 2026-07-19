// Pure per-statement aggregation for the Daraz Statements page. Groups income
// lines by statement number and rolls up every fee category into the columns
// the page shows. No I/O — the page passes DB rows in.

import { ALL_FEE_CATEGORIES, round2, type FeeCategory } from './fees';

export interface StatementFee {
  category: FeeCategory;
  amount: number;
}
export interface StatementLineInput {
  statementNumber: string;
  statementPeriod?: string | null;
  releaseStatus?: string | null;
  transactionDate?: Date | string | null;
  orderItemId: string;
  productPriceRevenue: number;
  buyerShippingCredit: number;
  totalCredits: number;
  totalDeductions: number;
  netAmount: number;
  fees: StatementFee[];
}

export interface StatementSummary {
  statementNumber: string;
  statementPeriod: string;
  releaseStatus: string;
  transactionDate: string | null;
  orderItemCount: number; // distinct order items in this statement
  lineCount: number; // statement-specific income lines
  productRevenue: number;
  buyerShippingCredit: number;
  totalCredits: number;
  commission: number;
  paymentFee: number;
  shippingFee: number;
  handlingFee: number;
  freeShippingMaxFee: number;
  coinsFee: number;
  voucherFee: number;
  shippingDiscount: number;
  incomeTaxWht: number;
  salesTaxWht: number;
  refunds: number;
  reversals: number;
  otherFees: number;
  totalDeductions: number;
  netPayout: number;
  byCategory: Record<FeeCategory, number>;
}

function emptyCat(): Record<FeeCategory, number> {
  const m = {} as Record<FeeCategory, number>;
  for (const c of ALL_FEE_CATEGORIES) m[c] = 0;
  return m;
}

export function summariseStatements(lines: StatementLineInput[]): StatementSummary[] {
  const groups = new Map<
    string,
    {
      period: string;
      release: string;
      date: string | null;
      orderIds: Set<string>;
      lineCount: number;
      productRevenue: number;
      buyerShippingCredit: number;
      totalCredits: number;
      totalDeductions: number;
      netPayout: number;
      cat: Record<FeeCategory, number>;
    }
  >();

  for (const l of lines) {
    let g = groups.get(l.statementNumber);
    if (!g) {
      g = {
        period: l.statementPeriod ?? '',
        release: l.releaseStatus ?? '',
        date: normDate(l.transactionDate),
        orderIds: new Set(),
        lineCount: 0,
        productRevenue: 0,
        buyerShippingCredit: 0,
        totalCredits: 0,
        totalDeductions: 0,
        netPayout: 0,
        cat: emptyCat(),
      };
      groups.set(l.statementNumber, g);
    }
    g.orderIds.add(l.orderItemId);
    g.lineCount += 1;
    g.productRevenue = round2(g.productRevenue + l.productPriceRevenue);
    g.buyerShippingCredit = round2(g.buyerShippingCredit + l.buyerShippingCredit);
    g.totalCredits = round2(g.totalCredits + l.totalCredits);
    g.totalDeductions = round2(g.totalDeductions + l.totalDeductions);
    g.netPayout = round2(g.netPayout + l.netAmount);
    for (const f of l.fees) g.cat[f.category] = round2(g.cat[f.category] + f.amount);
  }

  return [...groups.entries()]
    .map(([statementNumber, g]) => ({
      statementNumber,
      statementPeriod: g.period,
      releaseStatus: g.release,
      transactionDate: g.date,
      orderItemCount: g.orderIds.size,
      lineCount: g.lineCount,
      productRevenue: g.cat.PRODUCT_REVENUE,
      buyerShippingCredit: g.cat.BUYER_SHIPPING_CREDIT,
      totalCredits: g.totalCredits,
      commission: g.cat.COMMISSION,
      paymentFee: g.cat.PAYMENT_FEE,
      shippingFee: g.cat.SHIPPING_FEE,
      handlingFee: g.cat.HANDLING_FEE,
      freeShippingMaxFee: g.cat.FREE_SHIPPING_MAX_FEE,
      coinsFee: g.cat.COINS_PARTICIPATION,
      voucherFee: g.cat.VOUCHER_PARTICIPATION,
      shippingDiscount: g.cat.SHIPPING_DISCOUNT,
      incomeTaxWht: g.cat.INCOME_TAX_WHT,
      salesTaxWht: g.cat.SALES_TAX_WHT,
      refunds: g.cat.REFUND,
      reversals: g.cat.REVERSAL,
      otherFees: g.cat.OTHER,
      totalDeductions: g.totalDeductions,
      netPayout: g.netPayout,
      byCategory: g.cat,
    }))
    .sort((a, b) => a.statementNumber.localeCompare(b.statementNumber));
}

function normDate(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  if (typeof d === 'string') return d;
  try {
    return d.toISOString().slice(0, 10);
  } catch {
    return null;
  }
}
