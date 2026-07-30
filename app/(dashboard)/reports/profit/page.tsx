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
import { getPresentationContext } from '@/lib/presentation/context';
import { redactMoney } from '@/lib/presentation/redact';
import { redactExportRows } from '@/lib/presentation/viewmodels/exports';

export const metadata = { title: 'Profit Report' };
export const dynamic = 'force-dynamic';

export default async function ProfitReportPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const filter = parseFilter(sp);

  // Presentation Safe View: money redacted server-side (identity when inactive).
  const presentation = await getPresentationContext();
  const money = (n: number) => redactMoney(n, presentation);

  const [stores, fin] = await Promise.all([
    prisma.store.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    getFinancials(filter),
  ]);

  const rows = [
    { item: 'Gross Sales (Manual)', amount: fin.grossSales },
    { item: 'Product Cost (COGS)', amount: -fin.productCost },
    { item: 'Daraz Commission (Manual)', amount: -fin.commission },
    { item: 'VAT (Manual)', amount: -fin.vat },
    { item: 'Other Daraz Charges (Manual)', amount: -fin.otherDarazCharges },
    { item: 'Returns & Refunds', amount: -fin.returnsRefunds },
    { item: 'Operating Expenses', amount: -fin.operatingExpenses },
    { item: 'Accessories Consumed', amount: -fin.accessoriesConsumed },
    { item: 'Net Profit (Manual channel)', amount: fin.netProfit },
    { item: 'Daraz Import — gross revenue', amount: fin.daraz.grossRevenue },
    { item: 'Daraz Import — fees', amount: fin.daraz.darazFees },
    { item: 'Daraz Import — taxes withheld', amount: fin.daraz.taxesWithheld },
    { item: 'Daraz Import — refunds', amount: fin.daraz.refunds },
    { item: 'Daraz Import — net', amount: fin.daraz.net },
    { item: 'Estimated Daraz COGS (Delivered)', amount: -fin.estimatedDarazCogs },
    { item: 'Estimated Business Net Profit', amount: fin.combinedNetProfit },
    { item: 'Estimated Yahya Share (50%)', amount: fin.yahyaShare },
    { item: 'Estimated Owner Share (50%)', amount: fin.ownerShare },
  ];

  // Exports use redacted data only.
  const exportColumns = [
    { key: 'item', label: 'Item' },
    { key: 'amount', label: 'Amount', money: true },
  ];
  const exp = redactExportRows(exportColumns, rows, presentation);

  return (
    <>
      <Link
        href="/reports"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 transition hover:text-brand-600"
      >
        <ArrowLeft className="h-4 w-4" /> Back to reports
      </Link>

      <PageHeader
        title="Estimated Business Profit & Loss"
        description={rangeLabel(filter)}
      />

      <FilterBar stores={stores} />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-6">
        <StatCard label="Daraz (net)" value={money(fin.daraz.net)} tone="brand" />
        <StatCard label="Est. Daraz COGS" value={`− ${money(fin.estimatedDarazCogs)}`} tone="negative" />
        <StatCard
          label="Est. Business Net Profit"
          value={money(fin.combinedNetProfit)}
          tone={fin.combinedNetProfit >= 0 ? 'positive' : 'negative'}
        />
        <StatCard label="Est. Yahya 50%" value={money(fin.yahyaShare)} />
        <StatCard label="Est. Owner 50%" value={money(fin.ownerShare)} />
        <StatCard label="Manual Sales (gross)" value={money(fin.grossSales)} hint="Separate channel" />
      </div>

      <Card>
        <CardBody className="p-0">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
            <h3 className="text-sm font-semibold text-slate-800">P&amp;L Breakdown</h3>
            <ExportButtons
              title="Profit & Loss Report"
              filename="profit-report"
              subtitle={rangeLabel(filter)}
              columns={exp.columns}
              rows={exp.rows}
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
                    {money(r.amount)}
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
