import { prisma } from './prisma';
import { PROFIT_SPLIT } from './config';
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
// Profit & Loss
// ---------------------------------------------------------------------------

export interface Financials {
  grossSales: number;
  unitsSold: number;
  productCost: number; // COGS of items sold
  commission: number;
  vat: number;
  otherDarazCharges: number;
  returnsRefunds: number;
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
      product: { select: { purchaseCost: true } },
    },
  });

  let grossSales = 0,
    unitsSold = 0,
    productCost = 0,
    commission = 0,
    vat = 0,
    otherDarazCharges = 0,
    returnsRefunds = 0,
    netReceived = 0;

  for (const s of sales) {
    grossSales += s.grossAmount;
    unitsSold += s.quantitySold;
    productCost += s.quantitySold * (s.product?.purchaseCost ?? 0);
    commission += s.commission;
    vat += s.vat;
    otherDarazCharges += s.otherCharges;
    returnsRefunds += s.returnsRefunds;
    netReceived += s.netAmount;
  }

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
    commission,
    vat,
    otherDarazCharges,
    returnsRefunds,
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

  const [sales, expenses] = await Promise.all([
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
      s.quantitySold * (s.product?.purchaseCost ?? 0) -
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
