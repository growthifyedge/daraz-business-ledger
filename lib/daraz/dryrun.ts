// The dry-run engine. Pure: given parsed income lines, parsed order items,
// existing SKU mappings, ledger products and the set of already-imported order
// items, it produces the full preview the Import page renders. It never writes.

import { ALL_FEE_CATEGORIES, sumByCategory, round2, type FeeCategory } from './fees';
import type { IncomeLine } from './parse';
import { planOrderLineWrites, type SanitizedOrderRecord } from './sanitize';

export interface SkuMappingEntry {
  storeId: string;
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
  /** The store this import is scoped to. SKU resolution is per (storeId, sellerSku). */
  storeId: string;
  incomeLines: IncomeLine[];
  orders: SanitizedOrderRecord[];
  /** All SKU mappings; only those for `storeId` are used to resolve. */
  skuMappings: SkuMappingEntry[];
  products: LedgerProduct[];
  /** (orderItemId, statementNumber) keys already present (DarazIncomeLine) — duplicates. */
  alreadyImported: Set<string>;
  /** Order Line IDs (orderItemId) already stored — a re-upload updates, never duplicates. */
  existingOrderLineIds?: Set<string>;
  /** true when this exact (store + file pair) was already imported (batch fingerprint hit). */
  batchAlreadyImported: boolean;
}

export interface PreviewLine {
  orderItemId: string;
  statementNumber: string;
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
    incomeLines: number; // statement-specific lines (combinations)
    distinctOrderItemIds: number; // distinct income Order Item IDs
    statementCount: number; // distinct statement numbers
    orderItems: number;
    /** Order Line IDs not yet stored — inserted on commit. */
    orderLinesNew: number;
    /** Order Line IDs already stored — updated in place (e.g. Shipping → Delivered), never duplicated. */
    orderLinesUpdated: number;
    matched: number; // distinct income Order Item IDs with a matching order
    unmatched: number;
    duplicates: number;
    /** Income lines whose (orderItemId, statementNumber) is new — inserted. */
    incomeLinesNew: number;
    /** Income lines already present — updated in place (revised figures + fees). */
    incomeLinesUpdated: number;
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

/** Composite idempotency key for a statement line. */
export function dupKey(orderItemId: string, statementNumber: string): string {
  return `${orderItemId} ${statementNumber}`;
}

/**
 * Split income lines into inserts vs updates by their composite key. A line whose
 * (orderItemId, statementNumber) already exists is an UPDATE — Daraz revised its
 * figures, so the stored line and its fees are refreshed rather than ignored.
 * Pure — the commit performs the update + atomic fee replacement.
 */
export function planIncomeLineWrites<T extends { orderItemId: string; statementNumber: string }>(
  existingKeys: Set<string>,
  incomeLines: T[]
): { inserts: T[]; updates: T[] } {
  const inserts: T[] = [];
  const updates: T[] = [];
  for (const il of incomeLines) {
    (existingKeys.has(dupKey(il.orderItemId, il.statementNumber)) ? updates : inserts).push(il);
  }
  return { inserts, updates };
}

export function computeDryRun(input: DryRunInput): DryRunResult {
  const orderById = new Map(input.orders.map((o) => [o.orderItemId, o]));
  // Store isolation: resolve SKUs ONLY against this store's mappings. The same
  // Seller SKU may map to the same shared Product in the other store, but that
  // mapping is invisible here.
  const skuToProduct = new Map(
    input.skuMappings
      .filter((m) => m.storeId === input.storeId)
      .map((m) => [m.sellerSku, m.productId])
  );
  const productById = new Map(input.products.map((p) => [p.id, p]));

  const lines: PreviewLine[] = [];
  const totalsCat = emptyCatMap();
  const creditCat = emptyCatMap();
  const deductCat = emptyCatMap();
  const resolvedSkus = new Set<string>();
  const unresolvedAgg = new Map<string, { productName: string; lines: number; units: number }>();
  const deliveredUnitsByProduct = new Map<string, number>();
  // Physical stock deducts ONCE per order item even if it settles across two
  // statements — track which order items were already counted for stock.
  const countedForStock = new Set<string>();
  // Distinct income Order Item IDs and their match state (matching is at the
  // order-item level, not the statement-line level).
  const distinctOrderIds = new Set<string>();
  const matchedOrderIds = new Set<string>();
  const statementNumbers = new Set<string>();

  let duplicates = 0,
    productRevenue = 0,
    buyerShippingCredit = 0,
    totalCredits = 0,
    totalDeductions = 0,
    calculatedNet = 0,
    darazNet = 0,
    vatTotal = 0;

  for (const il of input.incomeLines) {
    const order = orderById.get(il.orderItemId);
    const isMatched = !!order;
    distinctOrderIds.add(il.orderItemId);
    if (isMatched) matchedOrderIds.add(il.orderItemId);
    if (il.statementNumber) statementNumbers.add(il.statementNumber);

    const sku = il.sellerSku || order?.sellerSku || '';
    const resolvedProductId = sku ? (skuToProduct.get(sku) ?? null) : null;
    const skuResolved = resolvedProductId !== null;
    if (skuResolved) resolvedSkus.add(sku);

    // Idempotency is per statement line: (orderItemId, statementNumber).
    const isDuplicate = input.alreadyImported.has(dupKey(il.orderItemId, il.statementNumber));
    if (isDuplicate) duplicates++;

    const feesByCategory = sumByCategory(il.fees);
    const calcNet = round2(il.totalCredits + il.totalDeductions);
    const reconDiff = round2(calcNet - il.netAmount);

    // A line is blocked (cannot import) if unmatched or its SKU is unresolved.
    // An already-imported (orderItemId, statementNumber) is NOT blocked — it is
    // updated in place when Daraz revises its figures (fees replaced atomically).
    const blocked = !isMatched || !skuResolved;
    if (!skuResolved) {
      const agg = unresolvedAgg.get(sku) ?? {
        productName: il.productName || order?.productName || '',
        lines: 0,
        units: 0,
      };
      agg.lines++;
      if (!countedForStock.has(il.orderItemId)) agg.units += 1;
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

    const status = (il.orderStatus || order?.status || '').toLowerCase();
    if (
      skuResolved &&
      resolvedProductId &&
      !isDuplicate &&
      status.includes('deliver') &&
      !countedForStock.has(il.orderItemId)
    ) {
      countedForStock.add(il.orderItemId);
      deliveredUnitsByProduct.set(
        resolvedProductId,
        (deliveredUnitsByProduct.get(resolvedProductId) ?? 0) + 1
      );
    }

    lines.push({
      orderItemId: il.orderItemId,
      statementNumber: il.statementNumber,
      orderNumber: il.orderNumber || order?.orderNumber || '',
      sellerSku: sku,
      productName: il.productName || order?.productName || '',
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

  const distinctOrderItemIds = distinctOrderIds.size;
  const matched = matchedOrderIds.size;
  const units = distinctOrderItemIds; // one physical unit per distinct order item

  // Order-line idempotency: split incoming order lines into inserts vs in-place
  // updates against what is already stored (Order Line ID is the key).
  const orderPlan = planOrderLineWrites(input.existingOrderLineIds ?? new Set(), input.orders);

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
      distinctOrderItemIds,
      statementCount: statementNumbers.size,
      orderItems: input.orders.length,
      orderLinesNew: orderPlan.inserts.length,
      orderLinesUpdated: orderPlan.updates.length,
      matched,
      unmatched: distinctOrderItemIds - matched,
      duplicates,
      incomeLinesNew: input.incomeLines.length - duplicates,
      incomeLinesUpdated: duplicates,
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
