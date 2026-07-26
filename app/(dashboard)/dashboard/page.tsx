import Link from 'next/link';
import {
  getFinancials,
  getStockValue,
  getCashFlow,
  getLowStockProducts,
  getInventoryMovement,
  getMonthlyTrend,
} from '@/lib/calculations';
import { prisma } from '@/lib/prisma';
import {
  Card,
  CardBody,
  CardHeader,
  StatCard,
  Badge,
  Table,
  THead,
  TH,
  TD,
  TRow,
} from '@/components/ui';
import { TrendChart, SplitChart } from '@/components/DashboardCharts';
import { formatMoney, formatMoneyCompact, formatNumber, formatDate, humanize } from '@/lib/utils';
import {
  Wallet,
  Package,
  TrendingUp,
  Receipt,
  PieChart,
  AlertTriangle,
  Boxes,
  ArrowUpRight,
} from 'lucide-react';

export const metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const [fin, stock, cash, lowStock, movement, trend, recentPurchases, recentExpenses, recentSales] =
    await Promise.all([
      getFinancials(),
      getStockValue(),
      getCashFlow(),
      getLowStockProducts(6),
      getInventoryMovement(),
      getMonthlyTrend(6),
      prisma.purchase.findMany({
        where: { deletedAt: null },
        orderBy: { date: 'desc' },
        take: 5,
        include: { product: { select: { name: true } } },
      }),
      prisma.expense.findMany({
        where: { deletedAt: null },
        orderBy: { date: 'desc' },
        take: 5,
      }),
      prisma.sale.findMany({
        where: { deletedAt: null },
        orderBy: { date: 'desc' },
        take: 5,
        include: { product: { select: { name: true } } },
      }),
    ]);

  const bestSelling = [...movement].sort((a, b) => b.units - a.units).slice(0, 5).filter((p) => p.units > 0);
  const slowMoving = [...movement].sort((a, b) => a.units - b.units).slice(0, 5);

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
          Dashboard
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Business overview across all Daraz stores (all-time).
        </p>
      </div>

      {/* KPI row 1 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        <StatCard
          label="Total Investment"
          value={formatMoneyCompact(cash.investment)}
          icon={<Wallet size={18} />}
          tone="brand"
        />
        <StatCard
          label="Current Stock Value"
          value={formatMoneyCompact(stock.stockValueAtCost)}
          hint={`${formatNumber(stock.totalUnits)} units · at cost`}
          icon={<Package size={18} />}
        />
        <StatCard
          label="Manual Sales Income"
          value={formatMoneyCompact(fin.grossSales)}
          hint={`Source: Manual · ${formatNumber(fin.unitsSold)} units`}
          icon={<TrendingUp size={18} />}
          tone="positive"
        />
        <StatCard
          label="Daraz Import (net)"
          value={formatMoneyCompact(fin.daraz.net)}
          hint={`Source: Daraz Import · ${formatNumber(fin.daraz.statements)} statement(s)`}
          icon={<TrendingUp size={18} />}
          tone="brand"
        />
        <StatCard
          label="Total Expenses"
          value={formatMoneyCompact(cash.expensesPaid)}
          icon={<Receipt size={18} />}
        />
        <StatCard
          label="Manual Net Profit"
          value={formatMoneyCompact(fin.netProfit)}
          hint="Manual channel, after all costs"
          tone={fin.netProfit >= 0 ? 'positive' : 'negative'}
        />
        <StatCard
          label="Est. Daraz COGS"
          value={`− ${formatMoneyCompact(fin.estimatedDarazCogs)}`}
          hint={`Delivered · ${formatNumber(fin.darazCogs.coveragePct)}% costed`}
          tone="negative"
        />
        <StatCard
          label="Est. Business Net Profit"
          value={formatMoneyCompact(fin.combinedNetProfit)}
          hint="Daraz net − est. COGS − operating costs"
          icon={<PieChart size={18} />}
          tone={fin.combinedNetProfit >= 0 ? 'positive' : 'negative'}
        />
        <StatCard
          label="Est. Yahya Share (50%)"
          value={formatMoneyCompact(fin.yahyaShare)}
          tone="brand"
        />
        <StatCard
          label="Est. Owner Share (50%)"
          value={formatMoneyCompact(fin.ownerShare)}
          tone="brand"
        />
      </div>

      {/* Cash in hand banner */}
      <Card className="mt-3 border-brand-100 bg-gradient-to-r from-brand-600 to-brand-700 text-white">
        <CardBody className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-brand-100">
              Net Cash Movement (All Stores)
            </p>
            <p className="mt-1 text-3xl font-bold tabular-nums">
              {formatMoney(cash.netCashMovement)}
            </p>
          </div>
          <div className="text-right text-xs text-brand-100">
            <p>Investment + Daraz released</p>
            <p>− reimbursements, expenses & payouts</p>
            {cash.owedToYahya > 0 && (
              <p className="mt-1 font-semibold text-amber-200">
                {formatMoney(cash.owedToYahya)} owed to Yahya for stock
              </p>
            )}
            {cash.reconciliationPending > 0 && (
              <p className="mt-1 font-semibold text-sky-200">
                {formatMoney(cash.reconciliationPending)} payment reconciliation pending
              </p>
            )}
          </div>
        </CardBody>
      </Card>

      {/* Charts */}
      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Sales & Profit Trend" subtitle="Last 6 months" />
          <CardBody>
            <TrendChart data={trend} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Profit Distribution" subtitle="Net profit split" />
          <CardBody>
            <SplitChart yahya={fin.yahyaShare} owner={fin.ownerShare} />
          </CardBody>
        </Card>
      </div>

      {/* Stock health */}
      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Card>
          <CardHeader
            title={
              <span className="flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4 text-amber-500" /> Low Stock
              </span>
            }
            action={
              <Link href="/reports/restocking" className="text-xs font-medium text-brand-600 hover:underline">
                Restock report
              </Link>
            }
          />
          <CardBody className="p-0">
            {lowStock.length === 0 ? (
              <p className="px-5 py-6 text-center text-sm text-slate-400">
                All products above minimum level.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {lowStock.map((p) => (
                  <li key={p.id} className="flex items-center justify-between px-5 py-2.5 text-sm">
                    <span className="truncate text-slate-700">{p.name}</span>
                    <Badge tone={p.currentStock === 0 ? 'red' : 'amber'}>
                      {p.currentStock} / {p.minStockLevel}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Best Selling" subtitle="By units sold" />
          <CardBody className="p-0">
            {bestSelling.length === 0 ? (
              <p className="px-5 py-6 text-center text-sm text-slate-400">
                No sales recorded yet.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {bestSelling.map((p) => (
                  <li key={p.productId} className="flex items-center justify-between px-5 py-2.5 text-sm">
                    <span className="truncate text-slate-700">{p.name}</span>
                    <span className="flex items-center gap-1 font-medium text-emerald-600">
                      <ArrowUpRight className="h-3.5 w-3.5" />
                      {formatNumber(p.units)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title={
              <span className="flex items-center gap-1.5">
                <Boxes className="h-4 w-4 text-slate-400" /> Slow Moving
              </span>
            }
            subtitle="Fewest units sold"
          />
          <CardBody className="p-0">
            {slowMoving.length === 0 ? (
              <p className="px-5 py-6 text-center text-sm text-slate-400">
                No products yet.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {slowMoving.map((p) => (
                  <li key={p.productId} className="flex items-center justify-between px-5 py-2.5 text-sm">
                    <span className="truncate text-slate-700">{p.name}</span>
                    <span className="text-slate-400">
                      {formatNumber(p.units)} sold · {p.currentStock} in stock
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Recent activity */}
      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Card>
          <CardHeader title="Recent Sales" action={<Link href="/sales" className="text-xs font-medium text-brand-600 hover:underline">View all</Link>} />
          <CardBody className="p-0">
            {recentSales.length === 0 ? (
              <p className="px-5 py-6 text-center text-sm text-slate-400">No sales yet.</p>
            ) : (
              <Table>
                <THead>
                  <TRow>
                    <TH>Product</TH>
                    <TH align="right">Net</TH>
                    <TH>Date</TH>
                  </TRow>
                </THead>
                <tbody>
                  {recentSales.map((s) => (
                    <TRow key={s.id}>
                      <TD className="max-w-[140px] truncate">{s.product.name}</TD>
                      <TD align="right">{formatMoney(s.netAmount)}</TD>
                      <TD>{formatDate(s.date)}</TD>
                    </TRow>
                  ))}
                </tbody>
              </Table>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Recent Purchases" action={<Link href="/purchases" className="text-xs font-medium text-brand-600 hover:underline">View all</Link>} />
          <CardBody className="p-0">
            {recentPurchases.length === 0 ? (
              <p className="px-5 py-6 text-center text-sm text-slate-400">No purchases yet.</p>
            ) : (
              <Table>
                <THead>
                  <TRow>
                    <TH>Product</TH>
                    <TH align="right">Cost</TH>
                    <TH>Status</TH>
                  </TRow>
                </THead>
                <tbody>
                  {recentPurchases.map((p) => (
                    <TRow key={p.id}>
                      <TD className="max-w-[140px] truncate">{p.product.name}</TD>
                      <TD align="right">{formatMoney(p.totalCost)}</TD>
                      <TD>
                        <Badge tone={p.paymentStatus === 'PAID' ? 'green' : 'amber'}>
                          {humanize(p.paymentStatus)}
                        </Badge>
                      </TD>
                    </TRow>
                  ))}
                </tbody>
              </Table>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Recent Expenses" action={<Link href="/expenses" className="text-xs font-medium text-brand-600 hover:underline">View all</Link>} />
          <CardBody className="p-0">
            {recentExpenses.length === 0 ? (
              <p className="px-5 py-6 text-center text-sm text-slate-400">No expenses yet.</p>
            ) : (
              <Table>
                <THead>
                  <TRow>
                    <TH>Category</TH>
                    <TH align="right">Amount</TH>
                    <TH>Date</TH>
                  </TRow>
                </THead>
                <tbody>
                  {recentExpenses.map((e) => (
                    <TRow key={e.id}>
                      <TD className="max-w-[140px] truncate">{humanize(e.category)}</TD>
                      <TD align="right">{formatMoney(e.amount)}</TD>
                      <TD>{formatDate(e.date)}</TD>
                    </TRow>
                  ))}
                </tbody>
              </Table>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
