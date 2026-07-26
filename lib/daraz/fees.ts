// Daraz fee categorisation. Every fee keeps its ORIGINAL label; this only groups
// it so P&L can hold each category strictly separate. Commission is ONLY the
// "Commission Fee" line — payment/shipping/handling/voucher/coins/taxes are never
// folded into commission. Refunds and reversals are their own buckets.

export type FeeCategory =
  | 'PRODUCT_REVENUE'
  | 'BUYER_SHIPPING_CREDIT'
  | 'COMMISSION'
  | 'PAYMENT_FEE'
  | 'SHIPPING_FEE'
  | 'FREE_SHIPPING_MAX_FEE'
  | 'HANDLING_FEE'
  | 'COINS_PARTICIPATION'
  | 'VOUCHER_PARTICIPATION'
  | 'SHIPPING_DISCOUNT'
  | 'INCOME_TAX_WHT'
  | 'SALES_TAX_WHT'
  | 'REFUND'
  | 'REVERSAL'
  | 'OTHER';

export interface CategorisedFee {
  label: string; // verbatim Daraz fee name
  category: FeeCategory;
  amount: number;
  vatAmount: number;
  isRefund: boolean;
  isReversal: boolean;
}

/** Exact base-label → category. Checked only after refund/reversal detection. */
const BASE: Array<[string, FeeCategory]> = [
  ['Product Price Paid by Buyer', 'PRODUCT_REVENUE'],
  ['Shipping Fee Paid by Buyer', 'BUYER_SHIPPING_CREDIT'],
  ['Commission Fee', 'COMMISSION'],
  ['Payment Fee', 'PAYMENT_FEE'],
  ['Free Shipping Max Fee', 'FREE_SHIPPING_MAX_FEE'],
  ['Handling Fee', 'HANDLING_FEE'],
  ['Daraz Coins Discount Participation Fee', 'COINS_PARTICIPATION'],
  ['Co-funded Voucher Max', 'VOUCHER_PARTICIPATION'],
  ['Shipping Fee Discount', 'SHIPPING_DISCOUNT'],
  ['Income Tax Withholding', 'INCOME_TAX_WHT'],
  ['Sales Tax Withholding', 'SALES_TAX_WHT'],
  // Generic 'Shipping Fee' MUST come last so the specific shipping labels win.
  ['Shipping Fee', 'SHIPPING_FEE'],
];

/**
 * Categorise a single Daraz fee label. A "Refunded" fee → REFUND; a "Reversal
 * of …" fee → REVERSAL (both keep the original label). Anything unrecognised →
 * OTHER, so nothing is silently dropped.
 */
export function categoriseFee(label: string): FeeCategory {
  const l = (label || '').trim();
  const low = l.toLowerCase();
  if (low.includes('reversal') || low.includes('reversed')) return 'REVERSAL';
  if (low.includes('refunded') || low.includes('refund')) return 'REFUND';
  for (const [base, cat] of BASE) {
    if (l === base) return cat;
  }
  // tolerant contains-match for minor label drift, specific-first
  for (const [base, cat] of BASE) {
    if (cat !== 'SHIPPING_FEE' && low.includes(base.toLowerCase())) return cat;
  }
  if (low.includes('shipping fee')) return 'SHIPPING_FEE';
  return 'OTHER';
}

export function toCategorisedFee(label: string, amount: number, vatAmount = 0): CategorisedFee {
  const category = categoriseFee(label);
  return {
    label,
    category,
    amount,
    vatAmount,
    isRefund: category === 'REFUND',
    isReversal: category === 'REVERSAL',
  };
}

export const ALL_FEE_CATEGORIES: FeeCategory[] = [
  'PRODUCT_REVENUE',
  'BUYER_SHIPPING_CREDIT',
  'COMMISSION',
  'PAYMENT_FEE',
  'SHIPPING_FEE',
  'FREE_SHIPPING_MAX_FEE',
  'HANDLING_FEE',
  'COINS_PARTICIPATION',
  'VOUCHER_PARTICIPATION',
  'SHIPPING_DISCOUNT',
  'INCOME_TAX_WHT',
  'SALES_TAX_WHT',
  'REFUND',
  'REVERSAL',
  'OTHER',
];

export const FEE_CATEGORY_LABEL: Record<FeeCategory, string> = {
  PRODUCT_REVENUE: 'Product Revenue',
  BUYER_SHIPPING_CREDIT: 'Buyer Shipping Credit',
  COMMISSION: 'Commission Fee',
  PAYMENT_FEE: 'Payment Fee',
  SHIPPING_FEE: 'Shipping Fee',
  FREE_SHIPPING_MAX_FEE: 'Free Shipping Max Fee',
  HANDLING_FEE: 'Handling Fee',
  COINS_PARTICIPATION: 'Coins Participation',
  VOUCHER_PARTICIPATION: 'Voucher Participation',
  SHIPPING_DISCOUNT: 'Shipping Discount',
  INCOME_TAX_WHT: 'Income Tax Withholding',
  SALES_TAX_WHT: 'Sales Tax Withholding',
  REFUND: 'Refunds',
  REVERSAL: 'Reversals',
  OTHER: 'Other',
};

/** Sum categorised fees into a per-category total map (all categories present). */
export function sumByCategory(fees: CategorisedFee[]): Record<FeeCategory, number> {
  const out = {} as Record<FeeCategory, number>;
  for (const c of ALL_FEE_CATEGORIES) out[c] = 0;
  for (const f of fees) out[f.category] = round2(out[f.category] + f.amount);
  return out;
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * The single canonical Seller-SKU normalizer. Every path that stores, resolves
 * or maps a Daraz Seller SKU MUST go through this so a SKU keyed at Purchase
 * time matches the one Daraz Import / COGS resolve later. Kept intentionally
 * conservative (trim only) — Daraz SKUs are case- and punctuation-significant,
 * so we do not lower-case or strip anything else.
 */
export function normalizeSellerSku(value: string | null | undefined): string {
  return String(value ?? '').trim();
}
