import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { prisma } from '@/lib/prisma';
import { getFinancials } from '@/lib/calculations';
import { parseFilter, rangeLabel, type SearchParams } from '@/lib/filters';
import { FilterBar } from '@/components/FilterBar';
import { ExportButtons } from '@/components/ExportButtons';
import {
  Card,
  CardBody,
  PageHeader,
  StatCard,
  Table,
  THead,
  TH,
  TD,
  TRow,
} from '@/components/ui';
import { formatMoney } from '@/lib/utils';

export const metadata = { title: 'Profit Report' };
export const dynamic = 'force-dynamic';

export default async function ProfitReportPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const filter = parseFilter(sp);

  const [stores, fin] = await Promise.all([
    prisma.store.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    getFinancials(filter),
  ]);

  const rows = [
    { item: 'Gross Sales', amount: fin.grossSales },
    { item: 'Product Cost (COGS)', amount: -fin.productCost },
    { item: 'Daraz Commission', amount: -fin.commission },
    { item: 'VAT', amount: -fin.vat },
    { item: 'Other Daraz Charges', amount: -fin.otherDarazCharges },
    { item: 'Returns & Refunds', amount: -fin.returnsRefunds },
    { item: 'Operating Expenses', amount: -fin.operatingExpenses },
    { item: 'Accessories Consumed', amount: -fin.accessoriesConsumed },
    { item: 'Net Profit', amount: fin.netProfit },
    { item: 'Yahya Share (50%)', amount: fin.yahyaShare },
    { item: 'Owner Share (50%)', amount: fin.ownerShare },
  ];

  return (
    <>
      <Link
        href="/reports"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 transition hover:text-brand-600"
      >
        <ArrowLeft className="h-4 w-4" /> Back to reports
      </Link>

      <PageHeader
        title="Profit & Loss"
        description={rangeLabel(filter)}
      />

      <FilterBar stores={stores} />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Gross Sales" value={formatMoney(fin.grossSales)} tone="brand" />
        <StatCard
          label="Net Profit"
          value={formatMoney(fin.netProfit)}
          tone={fin.netProfit >= 0 ? 'positive' : 'negative'}
        />
        <StatCard label="Yahya 50%" value={formatMoney(fin.yahyaShare)} />
        <StatCard label="Owner 50%" value={formatMoney(fin.ownerShare)} />
      </div>

      <Card>
        <CardBody className="p-0">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
            <h3 className="text-sm font-semibold text-slate-800">P&amp;L Breakdown</h3>
            <ExportButtons
              title="Profit & Loss Report"
              filename="profit-report"
              subtitle={rangeLabel(filter)}
              columns={[
                { key: 'item', label: 'Item' },
                { key: 'amount', label: 'Amount', money: true },
              ]}
              rows={rows}
            />
          </div>
          <Table>
            <THead>
              <TRow>
                <TH>Item</TH>
                <TH align="right">Amount</TH>
              </TRow>
            </THead>
            <tbody>
              {rows.map((r) => (
                <TRow key={r.item}>
                  <TD className="font-medium text-slate-800">{r.item}</TD>
                  <TD align="right" className={r.amount < 0 ? 'text-rose-600' : undefined}>
                    {formatMoney(r.amount)}
                  </TD>
                </TRow>
              ))}
            </tbody>
          </Table>
        </CardBody>
      </Card>
    </>
  );
}
