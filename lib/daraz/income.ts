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

// ---------------------------------------------------------------------------
// Estimated Daraz COGS (calculation-time only)
//
// For EXACTLY Delivered Daraz order lines, resolve (storeId, sellerSku) through
// the saved SKU mapping and cost each unit at that product's current
// purchaseCost. This is an ESTIMATE — historic purchase lots are incomplete, so
// date-aware FIFO cannot cost every unit; a flat purchaseCost gives full
// coverage. Pure: no Prisma, no stock/product/purchase writes, no mutation of
// its inputs.
// ---------------------------------------------------------------------------

/** Only lines whose status is EXACTLY "delivered" are costed. Excludes
 *  shipping, shipped, returned, cancelled, and "Buyer Delivery Failed". */
export function isDeliveredExact(status: string | null | undefined): boolean {
  return (status ?? '').trim().toLowerCase() === 'delivered';
}

export interface DeliveredOrderLine {
  storeId?: string | null;
  sellerSku?: string | null;
  status?: string | null;
  /** Order date (createTime) — used for date scoping. */
  orderDate?: Date | string | null;
  quantity: number;
}

export interface SkuMappingRow {
  storeId?: string | null;
  sellerSku: string;
  productId: string;
}

export interface ProductCostRow {
  id: string;
  purchaseCost: number;
}

export interface DarazCogsEstimate {
  deliveredUnits: number; // Σ qty of exactly-Delivered lines in scope
  mappedUnits: number; // delivered units whose (store, sku) resolves to a product
  unmappedUnits: number; // delivered units with no SKU mapping
  costedUnits: number; // mapped units whose product has purchaseCost > 0
  missingCostUnits: number; // mapped units whose product cost is 0/absent
  estimatedCogs: number; // Σ costed units × purchaseCost
  coveragePct: number; // costedUnits / deliveredUnits (0 when none)
  /** SKUs that could not be mapped (for the coverage warning). */
  unmappedSkus: string[];
}

const mapKey = (storeId: string | null | undefined, sellerSku: string | null | undefined) =>
  `${storeId ?? ''}||${(sellerSku ?? '').trim()}`;

function orderInScope(l: DeliveredOrderLine, f: IncomeRollupFilter): boolean {
  if (f.storeId && (l.storeId ?? null) !== f.storeId) return false;
  if (f.from || f.to) {
    const t = ts(l.orderDate);
    if (t == null) return false;
    if (f.from && t < f.from.getTime()) return false;
    if (f.to && t > f.to.getTime()) return false;
  }
  return true;
}

/**
 * Estimate Daraz COGS for exactly-Delivered lines, store/date scoped. Resolves
 * each line's product via the saved (storeId, sellerSku) mapping and costs it at
 * the product's purchaseCost. Reports coverage so the UI can label it estimated.
 * Pure — never writes or mutates its inputs.
 */
export function estimateDarazCogs(
  lines: DeliveredOrderLine[],
  mappings: SkuMappingRow[],
  products: ProductCostRow[],
  filter: IncomeRollupFilter = {}
): DarazCogsEstimate {
  const skuToProduct = new Map(mappings.map((m) => [mapKey(m.storeId, m.sellerSku), m.productId]));
  const costById = new Map(products.map((p) => [p.id, p.purchaseCost]));

  let deliveredUnits = 0;
  let mappedUnits = 0;
  let costedUnits = 0;
  let missingCostUnits = 0;
  let estimatedCogs = 0;
  const unmappedSkus = new Set<string>();

  for (const l of lines) {
    if (!isDeliveredExact(l.status)) continue; // Delivered-only
    if (!orderInScope(l, filter)) continue;
    const qty = Number.isInteger(l.quantity) && l.quantity > 0 ? l.quantity : 1;
    deliveredUnits += qty;

    const productId = skuToProduct.get(mapKey(l.storeId, l.sellerSku));
    if (!productId) {
      unmappedSkus.add((l.sellerSku ?? '').trim());
      continue; // unmapped
    }
    mappedUnits += qty;
    const cost = costById.get(productId) ?? 0;
    if (cost > 0) {
      costedUnits += qty;
      estimatedCogs = round2(estimatedCogs + qty * cost);
    } else {
      missingCostUnits += qty;
    }
  }

  return {
    deliveredUnits,
    mappedUnits,
    unmappedUnits: deliveredUnits - mappedUnits,
    costedUnits,
    missingCostUnits,
    estimatedCogs,
    coveragePct: deliveredUnits > 0 ? round2((costedUnits / deliveredUnits) * 100) : 0,
    unmappedSkus: [...unmappedSkus].filter(Boolean).sort(),
  };
}

// ---------------------------------------------------------------------------
// Unified "Estimated Business P&L" statement lines (presentation math only).
//
// Turns the shared Financials figures into the single statement the P&L screen
// renders. Pure — it derives the manual sales-only margin and reconstructs the
// business net, then asserts it equals the authoritative combinedNetProfit. No
// calculation logic changes: combinedNetProfit is passed in and is the total.
// ---------------------------------------------------------------------------

export interface BusinessPnlInput {
  darazNet: number;
  estimatedDarazCogs: number;
  /** Manual channel components (already computed by getFinancials). */
  grossSales: number;
  productCost: number;
  commission: number;
  vat: number;
  otherDarazCharges: number;
  returnsRefunds: number;
  operatingExpenses: number;
  accessoriesConsumed: number;
  /** Authoritative total from getFinancials — never recomputed here. */
  combinedNetProfit: number;
}

export interface BusinessPnl {
  darazNet: number;
  estimatedDarazCogs: number;
  /** Manual sales-only margin (before shared operating costs); 0 with no sales. */
  manualSalesMargin: number;
  hasManualSales: boolean;
  operatingExpenses: number;
  accessoriesConsumed: number;
  /** The statement total = the authoritative combinedNetProfit. */
  businessNetProfit: number;
  /** Independent reconstruction of the total from the displayed lines. */
  reconstructed: number;
  /** True when the displayed lines reconcile to the authoritative total. */
  reconciles: boolean;
}

export function buildBusinessPnl(i: BusinessPnlInput): BusinessPnl {
  const manualSalesMargin = round2(
    i.grossSales - i.productCost - i.commission - i.vat - i.otherDarazCharges - i.returnsRefunds
  );
  const reconstructed = round2(
    i.darazNet - i.estimatedDarazCogs + manualSalesMargin - i.operatingExpenses - i.accessoriesConsumed
  );
  return {
    darazNet: i.darazNet,
    estimatedDarazCogs: i.estimatedDarazCogs,
    manualSalesMargin,
    hasManualSales: Math.round(manualSalesMargin * 100) !== 0,
    operatingExpenses: i.operatingExpenses,
    accessoriesConsumed: i.accessoriesConsumed,
    businessNetProfit: i.combinedNetProfit,
    reconstructed,
    reconciles: reconstructed === round2(i.combinedNetProfit),
  };
}
