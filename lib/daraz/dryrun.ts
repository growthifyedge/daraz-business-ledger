// The dry-run engine. Pure: given parsed income lines, parsed order items,
// existing SKU mappings, ledger products and the set of already-imported order
// items, it produces the full preview the Import page renders. It never writes.

import { ALL_FEE_CATEGORIES, sumByCategory, round2, type FeeCategory } from './fees';
import type { IncomeLine, OrderItemRecord } from './parse';

export interface SkuMappingEntry {
  sellerSku: string;
  productId: string;
}
export interface LedgerProduct {
  id: string;
  sku: string;
  name: string;
  currentStock: number;
  purchaseCost: number;
}

export interface DryRunInput {
  incomeLines: IncomeLine[];
  orders: OrderItemRecord[];
  skuMappings: SkuMappingEntry[];
  products: LedgerProduct[];
  /** orderItemIds already present in the ledger (DarazIncomeLine) — duplicates. */
  alreadyImported: Set<string>;
  /** true when this exact file pair was already imported (batch fingerprint hit). */
  batchAlreadyImported: boolean;
}

export interface PreviewLine {
  orderItemId: string;
  orderNumber: string;
  sellerSku: string;
  productName: string;
  orderStatus: string;
  matched: boolean;
  units: number;
  productPriceRevenue: number;
  buyerShippingCredit: number;
  feesByCategory: Record<FeeCategory, number>;
  totalCredits: number;
  totalDeductions: number;
  calculatedNet: number;
  darazNet: number;
  reconDiff: number;
  reconciles: boolean;
  resolvedProductId: string | null;
  skuResolved: boolean;
  blocked: boolean; // unresolved SKU (or unmatched/duplicate) → cannot import
  isDuplicate: boolean;
}

export interface StockImpact {
  productId: string;
  sku: string;
  name: string;
  currentStock: number;
  unitsOut: number;
  projectedStock: number;
  negativeBlocker: boolean;
}

const UNAVAILABLE = 'Cannot calculate until product mapping is completed' as const;
export type Unavailable = typeof UNAVAILABLE;
export const MAPPING_UNAVAILABLE = UNAVAILABLE;

export interface DryRunResult {
  batchAlreadyImported: boolean;
  mappingComplete: boolean; // false while ANY Seller SKU is unresolved
  totals: {
    incomeLines: number;
    orderItems: number;
    matched: number;
    unmatched: number;
    duplicates: number;
    importable: number;
    blocked: number; // lines that cannot import (unresolved SKU / unmatched / dup)
    resolvedSkus: number;
    unresolvedSkus: number;
    units: number;
    productRevenue: number;
    buyerShippingCredit: number;
    // Category NET (sums to net). Plus gross credit/deduction split PER category,
    // so credits/deductions reconcile to categories with no unexplained balance.
    feesByCategory: Record<FeeCategory, number>;
    feeCreditByCategory: Record<FeeCategory, number>;
    feeDeductionByCategory: Record<FeeCategory, number>;
    vatTotal: number; // informational (per-fee VAT column)
    totalCredits: number;
    totalDeductions: number;
    calculatedNet: number;
    darazNet: number;
    reconDiff: number;
    categorySumCheck: number; // Σ feesByCategory − darazNet (must be 0)
    // Stock/COGS/profit are UNAVAILABLE until every SKU is mapped.
    projectedCOGS: number | Unavailable;
    projectedGrossProfit: number | Unavailable;
  };
  lines: PreviewLine[];
  unresolvedSkuList: Array<{ sellerSku: string; productName: string; lines: number; units: number }>;
  stockProjectionAvailable: boolean;
  stockImpact: StockImpact[] | Unavailable;
  negativeStockBlockers: StockImpact[] | Unavailable;
}

function emptyCatMap(): Record<FeeCategory, number> {
  const m = {} as Record<FeeCategory, number>;
  for (const c of ALL_FEE_CATEGORIES) m[c] = 0;
  return m;
}

export function computeDryRun(input: DryRunInput): DryRunResult {
  const orderById = new Map(input.orders.map((o) => [o.orderItemId, o]));
  const skuToProduct = new Map(input.skuMappings.map((m) => [m.sellerSku, m.productId]));
  const productById = new Map(input.products.map((p) => [p.id, p]));

  const lines: PreviewLine[] = [];
  const totalsCat = emptyCatMap();
  const creditCat = emptyCatMap();
  const deductCat = emptyCatMap();
  const resolvedSkus = new Set<string>();
  const unresolvedAgg = new Map<string, { productName: string; lines: number; units: number }>();
  const deliveredUnitsByProduct = new Map<string, number>();

  let matched = 0,
    duplicates = 0,
    productRevenue = 0,
    buyerShippingCredit = 0,
    totalCredits = 0,
    totalDeductions = 0,
    calculatedNet = 0,
    darazNet = 0,
    vatTotal = 0,
    units = 0;

  for (const il of input.incomeLines) {
    const order = orderById.get(il.orderItemId);
    const isMatched = !!order;
    if (isMatched) matched++;

    const sku = il.sellerSku || order?.sellerSku || '';
    const resolvedProductId = sku ? (skuToProduct.get(sku) ?? null) : null;
    const skuResolved = resolvedProductId !== null;
    if (skuResolved) resolvedSkus.add(sku);

    const isDuplicate = input.alreadyImported.has(il.orderItemId);
    if (isDuplicate) duplicates++;

    const feesByCategory = sumByCategory(il.fees);
    const calcNet = round2(il.totalCredits + il.totalDeductions);
    const reconDiff = round2(calcNet - il.netAmount);

    // A line is blocked (cannot import) if unmatched, duplicate, or SKU unresolved.
    const blocked = !isMatched || isDuplicate || !skuResolved;
    if (!skuResolved) {
      const agg = unresolvedAgg.get(sku) ?? {
        productName: il.productName || order?.itemName || '',
        lines: 0,
        units: 0,
      };
      agg.lines++;
      agg.units += 1;
      unresolvedAgg.set(sku, agg);
    }

    // Batch totals — NET per category and gross credit/deduction per category.
    for (const f of il.fees) {
      totalsCat[f.category] = round2(totalsCat[f.category] + f.amount);
      if (f.amount > 0) creditCat[f.category] = round2(creditCat[f.category] + f.amount);
      else if (f.amount < 0) deductCat[f.category] = round2(deductCat[f.category] + f.amount);
      vatTotal = round2(vatTotal + f.vatAmount);
    }
    productRevenue = round2(productRevenue + il.productPriceRevenue);
    buyerShippingCredit = round2(buyerShippingCredit + il.buyerShippingCredit);
    totalCredits = round2(totalCredits + il.totalCredits);
    totalDeductions = round2(totalDeductions + il.totalDeductions);
    calculatedNet = round2(calculatedNet + calcNet);
    darazNet = round2(darazNet + il.netAmount);
    units += 1;

    const status = (il.orderStatus || order?.status || '').toLowerCase();
    if (skuResolved && resolvedProductId && !isDuplicate && status.includes('deliver')) {
      deliveredUnitsByProduct.set(
        resolvedProductId,
        (deliveredUnitsByProduct.get(resolvedProductId) ?? 0) + 1
      );
    }

    lines.push({
      orderItemId: il.orderItemId,
      orderNumber: il.orderNumber || order?.orderNumber || '',
      sellerSku: sku,
      productName: il.productName || order?.itemName || '',
      orderStatus: il.orderStatus || order?.status || '',
      matched: isMatched,
      units: 1,
      productPriceRevenue: il.productPriceRevenue,
      buyerShippingCredit: il.buyerShippingCredit,
      feesByCategory,
      totalCredits: il.totalCredits,
      totalDeductions: il.totalDeductions,
      calculatedNet: calcNet,
      darazNet: il.netAmount,
      reconDiff,
      reconciles: reconDiff === 0,
      resolvedProductId,
      skuResolved,
      blocked,
      isDuplicate,
    });
  }

  const unresolvedSkuList = [...unresolvedAgg.entries()]
    .map(([sellerSku, v]) => ({ sellerSku, ...v }))
    .sort((a, b) => b.units - a.units);

  const mappingComplete = unresolvedAgg.size === 0;

  // Σ of all category nets must equal the Daraz net exactly — no hidden balance.
  const categorySum = round2(
    ALL_FEE_CATEGORIES.reduce((s, c) => s + totalsCat[c], 0)
  );

  // Stock / COGS / profit are UNAVAILABLE until every SKU is mapped — an
  // unresolved SKU is an import blocker, never a zero-impact success.
  let stockImpact: StockImpact[] | Unavailable = UNAVAILABLE;
  let negativeStockBlockers: StockImpact[] | Unavailable = UNAVAILABLE;
  let projectedCOGS: number | Unavailable = UNAVAILABLE;
  let projectedGrossProfit: number | Unavailable = UNAVAILABLE;

  if (mappingComplete) {
    const impacts: StockImpact[] = [];
    let cogs = 0;
    for (const [productId, unitsOut] of deliveredUnitsByProduct) {
      const p = productById.get(productId);
      if (!p) continue;
      const projectedStock = p.currentStock - unitsOut;
      impacts.push({
        productId,
        sku: p.sku,
        name: p.name,
        currentStock: p.currentStock,
        unitsOut,
        projectedStock,
        negativeBlocker: projectedStock < 0,
      });
      cogs = round2(cogs + unitsOut * p.purchaseCost);
    }
    impacts.sort((a, b) => b.unitsOut - a.unitsOut);
    stockImpact = impacts;
    negativeStockBlockers = impacts.filter((s) => s.negativeBlocker);
    projectedCOGS = cogs;
    projectedGrossProfit = round2(productRevenue - cogs);
  }

  const importable = mappingComplete
    ? lines.filter((l) => !l.blocked).length
    : 0;

  return {
    batchAlreadyImported: input.batchAlreadyImported,
    mappingComplete,
    totals: {
      incomeLines: input.incomeLines.length,
      orderItems: input.orders.length,
      matched,
      unmatched: input.incomeLines.length - matched,
      duplicates,
      importable,
      blocked: lines.filter((l) => l.blocked).length,
      resolvedSkus: resolvedSkus.size,
      unresolvedSkus: unresolvedAgg.size,
      units,
      productRevenue,
      buyerShippingCredit,
      feesByCategory: totalsCat,
      feeCreditByCategory: creditCat,
      feeDeductionByCategory: deductCat,
      vatTotal,
      totalCredits,
      totalDeductions,
      calculatedNet,
      darazNet,
      reconDiff: round2(calculatedNet - darazNet),
      categorySumCheck: round2(categorySum - darazNet),
      projectedCOGS,
      projectedGrossProfit,
    },
    lines,
    unresolvedSkuList,
    stockProjectionAvailable: mappingComplete,
    stockImpact,
    negativeStockBlockers,
  };
}
