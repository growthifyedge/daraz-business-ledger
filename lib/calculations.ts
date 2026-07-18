import { prisma } from './prisma';
import { PROFIT_SPLIT } from './config';
import { saleCogs, returnRecoveredCogs } from './returns';
import type { Prisma, ExpenseCategory } from '@prisma/client';

// ---------------------------------------------------------------------------
// Shared filtering
// ---------------------------------------------------------------------------

export interface Filter {
  from?: Date | null;
  to?: Date | null;
  storeId?: string | null;
}

function dateRange(from?: Date | null, to?: Date | null) {
  const range: { gte?: Date; lte?: Date } = {};
  if (from) range.gte = from;
  if (to) {
    // include the whole "to" day
    const end = new Date(to);
    end.setHours(23, 59, 59, 999);
    range.lte = end;
  }
  return Object.keys(range).length ? range : undefined;
}

function baseWhere(f: Filter) {
  const where: Record<string, unknown> = { deletedAt: null };
  const range = dateRange(f.from, f.to);
  if (range) where.date = range;
  if (f.storeId) where.storeId = f.storeId;
  return where as Prisma.SaleWhereInput;
}

// Expense categories already captured inside Sales entries (Daraz-side
// deductions & product cost). Excluded from the P&L expense side to avoid
// double-counting. Log physical/operational costs in the other categories.
const DARAZ_DUP_CATEGORIES: ExpenseCategory[] = [
  'PRODUCT_COST',
  'VAT',
  'DARAZ_COMMISSION',
  'OTHER_DARAZ_CHARGES',
];

// ---------------------------------------------------------------------------
// Returns → P&L eligibility
// ---------------------------------------------------------------------------

/**
 * The single definition of a return refund that costs the seller money.
 * A refund reduces profit only when it is settled (COMPLETED), borne by us
 * (SELLER) and the record is live. Platform-covered refunds are Daraz's loss,
 * and PENDING/CANCELLED refunds have not cost anything (yet or ever).
 *
 * `returnDate` is the reporting date, so a refund lands in the period the
 * return was raised.
 *
 * WHY SUMMING THIS WITH THE LEGACY `Sale.returnsRefunds` IS SAFE
 * -------------------------------------------------------------
 * Not because overlap is inherently impossible — it is not. An *unlinked*
 * return can perfectly well describe a refund that some sale already recorded
 * in its legacy field, and nothing in the data would reveal the connection.
 *
 * It is safe because the legacy field is now a closed, historical set:
 *   - the Sales form no longer offers `returnsRefunds` as an input;
 *   - `saveSale` writes 0 on create and preserves the stored value on edit;
 *   - so no NEW refund can ever enter through the legacy path.
 * Every new refund is therefore recorded exactly once, in Returns.
 *
 * `legacyRefundConflict()` remains as defence-in-depth for the finite set of
 * historical sales that already carry a legacy refund and get linked to a
 * return. (At the time of writing that set is empty: 0 sales have
 * returnsRefunds != 0.)
 */
export function eligibleReturnWhere(f: Filter = {}): Prisma.ReturnWhereInput {
  const where: Prisma.ReturnWhereInput = {
    deletedAt: null,
    refundStatus: 'COMPLETED',
    chargedTo: 'SELLER',
  };
  const range = dateRange(f.from, f.to);
  if (range) where.returnDate = range;
  if (f.storeId) where.storeId = f.storeId;
  return where;
}

// ---------------------------------------------------------------------------
// Profit & Loss
// ---------------------------------------------------------------------------

export interface Financials {
  grossSales: number;
  unitsSold: number;
  /** Net product cost = salesCOGS − recoveredCOGS. Used as the COGS deduction. */
  productCost: number;
  /** Σ quantitySold × snapshotted unit cost. */
  salesCOGS: number;
  /** Σ restocked-return quantity × snapshotted unit cost (cost put back on shelf). */
  recoveredCOGS: number;
  /** salesCOGS − recoveredCOGS (same as productCost; named for reporting clarity). */
  netProductCost: number;
  commission: number;
  vat: number;
  otherDarazCharges: number;
  /** Total refunds that reduce profit = legacy Sale field + eligible Returns. */
  returnsRefunds: number;
  /** Breakdown: refunds recorded inline on Sale (legacy path). */
  legacySaleRefunds: number;
  /** Breakdown: COMPLETED + SELLER refunds from the Returns module. */
  returnModuleRefunds: number;
  /** Informational — Daraz absorbed these, so they never reduce seller profit. */
  platformCoveredRefunds: number;
  /** Informational — not settled yet, so not a loss. */
  pendingReturnRefunds: number;
  operatingExpenses: number; // packaging, flyers, transport, bank charges, misc...
  accessoriesConsumed: number; // cost of packing material used
  grossProfit: number; // grossSales - productCost
  totalDeductions: number;
  netProfit: number;
  yahyaShare: number;
  ownerShare: number;
  netReceived: number; // sum of sale.netAmount
}

export async function getFinancials(f: Filter = {}): Promise<Financials> {
  const saleWhere = baseWhere(f);

  const sales = await prisma.sale.findMany({
    where: saleWhere,
    select: {
      quantitySold: true,
      grossAmount: true,
      commission: true,
      vat: true,
      otherCharges: true,
      returnsRefunds: true,
      netAmount: true,
      unitCost: true,
      product: { select: { purchaseCost: true } },
    },
  });

  let grossSales = 0,
    unitsSold = 0,
    salesCOGS = 0,
    commission = 0,
    vat = 0,
    otherDarazCharges = 0,
    legacySaleRefunds = 0,
    netReceived = 0;

  for (const s of sales) {
    grossSales += s.grossAmount;
    unitsSold += s.quantitySold;
    // Snapshotted cost — stable against later purchaseCost changes.
    salesCOGS += saleCogs({
      quantitySold: s.quantitySold,
      unitCost: s.unitCost,
      productPurchaseCost: s.product?.purchaseCost,
    });
    commission += s.commission;
    vat += s.vat;
    otherDarazCharges += s.otherCharges;
    legacySaleRefunds += s.returnsRefunds;
    netReceived += s.netAmount;
  }

  // Returns module — dated by returnDate, filtered by store, same Filter shape.
  const returnRange = dateRange(f.from, f.to);
  const returnScope: Prisma.ReturnWhereInput = { deletedAt: null };
  if (returnRange) returnScope.returnDate = returnRange;
  if (f.storeId) returnScope.storeId = f.storeId;

  const [eligibleAgg, platformAgg, pendingAgg] = await Promise.all([
    // Only these cost the seller money.
    prisma.return.aggregate({
      where: eligibleReturnWhere(f),
      _sum: { refundAmount: true },
    }),
    // Daraz absorbed these — informational only.
    prisma.return.aggregate({
      where: { ...returnScope, refundStatus: 'COMPLETED', chargedTo: 'PLATFORM' },
      _sum: { refundAmount: true },
    }),
    // Not settled — never counted as a loss.
    prisma.return.aggregate({
      where: { ...returnScope, refundStatus: 'PENDING' },
      _sum: { refundAmount: true },
    }),
  ]);

  const returnModuleRefunds = eligibleAgg._sum.refundAmount ?? 0;
  const platformCoveredRefunds = platformAgg._sum.refundAmount ?? 0;
  const pendingReturnRefunds = pendingAgg._sum.refundAmount ?? 0;

  // Safe to add: the legacy field is a closed historical set (no longer
  // writable from the Sales form), so a new refund can only be counted once —
  // in Returns. See eligibleReturnWhere() for the full reasoning.
  const returnsRefunds = legacySaleRefunds + returnModuleRefunds;

  // COGS recovery — a restocked unit puts its cost back on the shelf. Dated by
  // receivedAt (when it physically returned), NOT returnDate. Independent of the
  // refund's financial state — see recoversCogs() in lib/returns.ts. Per-row
  // because a null unitCost snapshot falls back to the product's purchaseCost.
  const recoveryWhere: Prisma.ReturnWhereInput = {
    deletedAt: null,
    inventoryStatus: 'RESTOCKED',
  };
  if (returnRange) recoveryWhere.receivedAt = returnRange;
  if (f.storeId) recoveryWhere.storeId = f.storeId;
  const restockedReturns = await prisma.return.findMany({
    where: recoveryWhere,
    select: {
      quantity: true,
      unitCost: true,
      inventoryStatus: true,
      deletedAt: true,
      product: { select: { purchaseCost: true } },
    },
  });
  const recoveredCOGS = restockedReturns.reduce(
    (sum, r) =>
      sum +
      returnRecoveredCogs({
        inventoryStatus: r.inventoryStatus,
        deletedAt: r.deletedAt,
        quantity: r.quantity,
        unitCost: r.unitCost,
        productPurchaseCost: r.product?.purchaseCost,
      }),
    0
  );

  // Net product cost is COGS of goods sold minus the cost of goods returned to
  // sellable stock.
  const netProductCost = salesCOGS - recoveredCOGS;
  const productCost = netProductCost;

  // Operating expenses (exclude Daraz-side categories already in sales).
  const expenseWhere: Prisma.ExpenseWhereInput = {
    deletedAt: null,
    category: { notIn: DARAZ_DUP_CATEGORIES },
  };
  const range = dateRange(f.from, f.to);
  if (range) expenseWhere.date = range;
  if (f.storeId) expenseWhere.storeId = f.storeId;

  const expAgg = await prisma.expense.aggregate({
    where: expenseWhere,
    _sum: { amount: true },
  });
  const operatingExpenses = expAgg._sum.amount ?? 0;

  // Accessories consumed cost (cost of packing material actually used).
  // Consumption has no per-use date in the schema, so it is attributed to the
  // accessory's purchaseDate — this keeps period P&L date-bounded instead of
  // always subtracting all-time consumption. (Precise consumption dating is a
  // later phase.) Not store-attributable, so store filter does not apply here.
  const accessoryWhere: Prisma.AccessoryWhereInput = { deletedAt: null };
  if (range) accessoryWhere.purchaseDate = range;
  const accessories = await prisma.accessory.findMany({
    where: accessoryWhere,
    select: { quantityUsed: true, unitCost: true },
  });
  const accessoriesConsumed = accessories.reduce(
    (sum, a) => sum + a.quantityUsed * a.unitCost,
    0
  );

  const grossProfit = grossSales - productCost;
  const totalDeductions =
    productCost +
    commission +
    vat +
    otherDarazCharges +
    returnsRefunds +
    operatingExpenses +
    accessoriesConsumed;
  const netProfit = grossSales - totalDeductions;

  return {
    grossSales,
    unitsSold,
    productCost,
    salesCOGS,
    recoveredCOGS,
    netProductCost,
    commission,
    vat,
    otherDarazCharges,
    returnsRefunds,
    legacySaleRefunds,
    returnModuleRefunds,
    platformCoveredRefunds,
    pendingReturnRefunds,
    operatingExpenses,
    accessoriesConsumed,
    grossProfit,
    totalDeductions,
    netProfit,
    yahyaShare: netProfit * PROFIT_SPLIT.yahya,
    ownerShare: netProfit * PROFIT_SPLIT.owner,
    netReceived,
  };
}

// ---------------------------------------------------------------------------
// Inventory valuation
// ---------------------------------------------------------------------------

export interface StockValue {
  stockValueAtCost: number;
  stockValueAtSale: number;
  totalUnits: number;
  productCount: number;
}

export async function getStockValue(): Promise<StockValue> {
  const products = await prisma.product.findMany({
    where: { deletedAt: null, active: true },
    select: { currentStock: true, purchaseCost: true, sellingPrice: true },
  });
  let stockValueAtCost = 0,
    stockValueAtSale = 0,
    totalUnits = 0;
  for (const p of products) {
    stockValueAtCost += p.currentStock * p.purchaseCost;
    stockValueAtSale += p.currentStock * p.sellingPrice;
    totalUnits += p.currentStock;
  }
  return {
    stockValueAtCost,
    stockValueAtSale,
    totalUnits,
    productCount: products.length,
  };
}

// ---------------------------------------------------------------------------
// Cash flow
// ---------------------------------------------------------------------------

export interface CashFlow {
  investment: number; // money owner put in
  settlementsReceived: number; // money from Daraz
  reimbursementsPaid: number; // paid to Yahya for purchases
  stockPurchaseUnpaid: number; // owed to Yahya (unpaid purchases)
  expensesPaid: number; // all logged expenses
  payoutsPaid: number; // profit-share payouts
  netCashBalance: number;
}

export async function getCashFlow(f: Filter = {}): Promise<CashFlow> {
  const range = dateRange(f.from, f.to);

  const investmentWhere: Prisma.InvestmentWhereInput = { deletedAt: null };
  if (range) investmentWhere.date = range;

  const settlementWhere: Prisma.SettlementWhereInput = { deletedAt: null };
  if (range) settlementWhere.date = range;
  if (f.storeId) settlementWhere.storeId = f.storeId;

  const expenseWhere: Prisma.ExpenseWhereInput = { deletedAt: null };
  if (range) expenseWhere.date = range;
  if (f.storeId) expenseWhere.storeId = f.storeId;

  const payoutWhere: Prisma.PayoutWhereInput = { deletedAt: null };
  if (range) payoutWhere.date = range;

  const purchasePaidWhere: Prisma.PurchaseWhereInput = {
    deletedAt: null,
    paymentStatus: 'PAID',
  };
  const purchaseUnpaidWhere: Prisma.PurchaseWhereInput = {
    deletedAt: null,
    paymentStatus: 'UNPAID',
  };
  if (range) {
    purchasePaidWhere.date = range;
    purchaseUnpaidWhere.date = range;
  }
  if (f.storeId) {
    purchasePaidWhere.storeId = f.storeId;
    purchaseUnpaidWhere.storeId = f.storeId;
  }

  const [inv, settle, exp, payout, paid, unpaid] = await Promise.all([
    prisma.investment.aggregate({ where: investmentWhere, _sum: { amount: true } }),
    prisma.settlement.aggregate({ where: settlementWhere, _sum: { netAmount: true } }),
    prisma.expense.aggregate({ where: expenseWhere, _sum: { amount: true } }),
    prisma.payout.aggregate({ where: payoutWhere, _sum: { amount: true } }),
    prisma.purchase.aggregate({ where: purchasePaidWhere, _sum: { totalCost: true } }),
    prisma.purchase.aggregate({ where: purchaseUnpaidWhere, _sum: { totalCost: true } }),
  ]);

  const investment = inv._sum.amount ?? 0;
  const settlementsReceived = settle._sum.netAmount ?? 0;
  const expensesPaid = exp._sum.amount ?? 0;
  const payoutsPaid = payout._sum.amount ?? 0;
  const reimbursementsPaid = paid._sum.totalCost ?? 0;
  const stockPurchaseUnpaid = unpaid._sum.totalCost ?? 0;

  // Cash in hand = money in (investment + settlements) − money out
  // (reimbursements to Yahya + non-purchase expenses + profit payouts).
  const netCashBalance =
    investment +
    settlementsReceived -
    reimbursementsPaid -
    expensesPaid -
    payoutsPaid;

  return {
    investment,
    settlementsReceived,
    reimbursementsPaid,
    stockPurchaseUnpaid,
    expensesPaid,
    payoutsPaid,
    netCashBalance,
  };
}

// ---------------------------------------------------------------------------
// Product performance & stock health (for dashboard)
// ---------------------------------------------------------------------------

export async function getLowStockProducts(limit = 10) {
  const products = await prisma.product.findMany({
    where: { deletedAt: null, active: true },
    select: {
      id: true,
      name: true,
      sku: true,
      currentStock: true,
      minStockLevel: true,
    },
  });
  return products
    .filter((p) => p.currentStock <= p.minStockLevel)
    .sort((a, b) => a.currentStock - b.currentStock)
    .slice(0, limit);
}

export interface MonthlyPoint {
  label: string;
  sales: number;
  profit: number;
}

/** Last N months of gross sales and approximate net profit, for the trend chart. */
export async function getMonthlyTrend(months = 6): Promise<MonthlyPoint[]> {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);

  const [sales, expenses, returns, restocked] = await Promise.all([
    prisma.sale.findMany({
      where: { deletedAt: null, date: { gte: start } },
      select: {
        date: true,
        quantitySold: true,
        grossAmount: true,
        commission: true,
        vat: true,
        otherCharges: true,
        returnsRefunds: true,
        unitCost: true,
        product: { select: { purchaseCost: true } },
      },
    }),
    prisma.expense.findMany({
      where: {
        deletedAt: null,
        date: { gte: start },
        category: { notIn: DARAZ_DUP_CATEGORIES },
      },
      select: { date: true, amount: true },
    }),
    // Same eligibility rule as getFinancials — seller-borne settled refunds only.
    prisma.return.findMany({
      where: { ...eligibleReturnWhere(), returnDate: { gte: start } },
      select: { returnDate: true, refundAmount: true },
    }),
    // Recovered COGS — restocked units, dated by receivedAt (same as getFinancials).
    prisma.return.findMany({
      where: {
        deletedAt: null,
        inventoryStatus: 'RESTOCKED',
        receivedAt: { gte: start },
      },
      select: {
        receivedAt: true,
        quantity: true,
        unitCost: true,
        inventoryStatus: true,
        deletedAt: true,
        product: { select: { purchaseCost: true } },
      },
    }),
  ]);

  const buckets: MonthlyPoint[] = [];
  const index = new Map<string, MonthlyPoint>();
  for (let i = 0; i < months; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - (months - 1) + i, 1);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    const point: MonthlyPoint = {
      label: d.toLocaleDateString('en-GB', { month: 'short' }),
      sales: 0,
      profit: 0,
    };
    buckets.push(point);
    index.set(key, point);
  }

  for (const s of sales) {
    const key = `${s.date.getFullYear()}-${s.date.getMonth()}`;
    const p = index.get(key);
    if (!p) continue;
    p.sales += s.grossAmount;
    p.profit +=
      s.grossAmount -
      saleCogs({
        quantitySold: s.quantitySold,
        unitCost: s.unitCost,
        productPurchaseCost: s.product?.purchaseCost,
      }) -
      s.commission -
      s.vat -
      s.otherCharges -
      s.returnsRefunds;
  }
  for (const e of expenses) {
    const key = `${e.date.getFullYear()}-${e.date.getMonth()}`;
    const p = index.get(key);
    if (p) p.profit -= e.amount;
  }
  // Bucketed by returnDate, matching the P&L reporting period.
  for (const r of returns) {
    const key = `${r.returnDate.getFullYear()}-${r.returnDate.getMonth()}`;
    const p = index.get(key);
    if (p) p.profit -= r.refundAmount;
  }
  // Recovered COGS adds profit back, bucketed by receivedAt.
  for (const r of restocked) {
    if (!r.receivedAt) continue;
    const key = `${r.receivedAt.getFullYear()}-${r.receivedAt.getMonth()}`;
    const p = index.get(key);
    if (p)
      p.profit += returnRecoveredCogs({
        inventoryStatus: r.inventoryStatus,
        deletedAt: r.deletedAt,
        quantity: r.quantity,
        unitCost: r.unitCost,
        productPurchaseCost: r.product?.purchaseCost,
      });
  }

  return buckets.map((b) => ({
    ...b,
    sales: Math.round(b.sales),
    profit: Math.round(b.profit),
  }));
}

export interface ProductMovement {
  productId: string;
  name: string;
  sku: string;
  units: number;
  revenue: number;
  currentStock: number;
}

/**
 * Every active product with its units sold in the range (0 if never sold).
 * Used to derive best-selling (desc) and slow-moving (asc) lists.
 */
export async function getInventoryMovement(f: Filter = {}): Promise<ProductMovement[]> {
  const where = baseWhere(f);
  const [grouped, products] = await Promise.all([
    prisma.sale.groupBy({
      by: ['productId'],
      where,
      _sum: { quantitySold: true, grossAmount: true },
    }),
    prisma.product.findMany({
      where: { deletedAt: null, active: true },
      select: { id: true, name: true, sku: true, currentStock: true },
    }),
  ]);
  const stats = new Map(
    grouped.map((g) => [
      g.productId,
      { units: g._sum.quantitySold ?? 0, revenue: g._sum.grossAmount ?? 0 },
    ])
  );
  return products.map((p) => ({
    productId: p.id,
    name: p.name,
    sku: p.sku,
    currentStock: p.currentStock,
    units: stats.get(p.id)?.units ?? 0,
    revenue: stats.get(p.id)?.revenue ?? 0,
  }));
}
