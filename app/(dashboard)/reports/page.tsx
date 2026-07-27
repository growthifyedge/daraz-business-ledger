import Link from 'next/link';
import {
  TrendingUp,
  ShoppingBag,
  ShoppingCart,
  Receipt,
  Boxes,
  PackagePlus,
  ArrowUpRight,
} from 'lucide-react';
import { Card, CardBody, PageHeader } from '@/components/ui';

export const metadata = { title: 'Reports' };
export const dynamic = 'force-dynamic';

const REPORTS = [
  {
    href: '/reports/profit',
    title: 'Profit & Loss',
    description: 'Gross sales, deductions, net profit and the 50/50 split.',
    icon: TrendingUp,
  },
  {
    href: '/reports/sales',
    title: 'Sales',
    description: 'Every sale with gross, deductions and net received.',
    icon: ShoppingBag,
  },
  {
    href: '/reports/purchases',
    title: 'Purchases',
    description: 'Stock bought, reimbursement status and bank references.',
    icon: ShoppingCart,
  },
  {
    href: '/reports/expenses',
    title: 'Expenses',
    description: 'Operating costs by category, store and payment method.',
    icon: Receipt,
  },
  {
    href: '/reports/inventory',
    title: 'Inventory',
    description: 'Current stock, valuation at cost and damage/loss counts.',
    icon: Boxes,
  },
  {
    href: '/reports/restocking',
    title: 'Restocking',
    description: 'Products at or below their minimum stock level.',
    icon: PackagePlus,
  },
];

export default function ReportsPage() {
  return (
    <>
      <PageHeader
        title="Reports"
        description="Financial and inventory reports with date-range and store filters, exportable to CSV or PDF."
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {REPORTS.map((r) => {
          const Icon = r.icon;
          return (
            <Link key={r.href} href={r.href} className="group block">
              <Card className="h-full transition hover:border-brand-300 hover:shadow-md">
                <CardBody>
                  <div className="flex items-start justify-between">
                    <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                      <Icon className="h-5 w-5" />
                    </span>
                    <ArrowUpRight className="h-4 w-4 text-slate-300 transition group-hover:text-brand-500" />
                  </div>
                  <h3 className="mt-3 text-sm font-semibold text-slate-800">
                    {r.title}
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">{r.description}</p>
                </CardBody>
              </Card>
            </Link>
          );
        })}
      </div>
    </>
  );
}
