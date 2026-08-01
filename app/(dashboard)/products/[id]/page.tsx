import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getPresentationContext } from '@/lib/presentation/context';
import {
  Card,
  CardBody,
  CardHeader,
  StatCard,
  Badge,
  EmptyState,
  Table,
  THead,
  TH,
  TD,
  TRow,
} from '@/components/ui';
import { formatMoney, formatNumber, formatDateTime, humanize } from '@/lib/utils';
import { ArrowLeft, History } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Presentation Safe View: the product drill-down surfaces exact stock value and
  // raw stock-movement notes / operator names, so it is blocked entirely while
  // active. The redacted Products list (/products) remains available. Inactive
  // mode is unchanged.
  const presentation = await getPresentationContext();
  if (presentation.active) redirect('/products?psv=blocked');

  const product = await prisma.product.findFirst({
    where: { id, deletedAt: null },
    include: {
      stores: { include: { store: true } },
      movements: { orderBy: { createdAt: 'desc' }, take: 100 },
    },
  });

  if (!product) notFound();

  const toneFor = (t: string) =>
    t === 'ADD' || t === 'RETURNED' || t === 'PURCHASE'
      ? 'green'
      : t === 'ADJUST' || t === 'TRANSFER'
      ? 'blue'
      : 'red';

  return (
    <div>
      <Link
        href="/products"
        className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
      >
        <ArrowLeft className="h-4 w-4" /> Back to products
      </Link>

      <div className="mb-5">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
            {product.name}
          </h1>
          <Badge tone={product.active ? 'green' : 'slate'}>
            {product.active ? 'Active' : 'Inactive'}
          </Badge>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          {product.sku} · {product.category}
        </p>
        {product.stores.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {product.stores.map((s) => (
              <Badge key={s.storeId} tone="blue">
                {s.store.name}
              </Badge>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Current Stock" value={formatNumber(product.currentStock)} />
        <StatCard
          label="Stock Value"
          value={formatMoney(product.currentStock * product.purchaseCost)}
        />
        <StatCard label="Min Level" value={formatNumber(product.minStockLevel)} />
        <StatCard
          label="Damaged"
          value={formatNumber(product.damagedStock)}
          tone={product.damagedStock ? 'negative' : 'default'}
        />
        <StatCard
          label="Lost"
          value={formatNumber(product.lostStock)}
          tone={product.lostStock ? 'negative' : 'default'}
        />
        <StatCard label="Returned" value={formatNumber(product.returnedStock)} />
      </div>

      <Card className="mt-4">
        <CardHeader
          title={
            <span className="flex items-center gap-1.5">
              <History className="h-4 w-4 text-slate-400" /> Stock Movement History
            </span>
          }
          subtitle="Most recent 100 movements"
        />
        <CardBody className="p-0">
          {product.movements.length === 0 ? (
            <EmptyState title="No movements yet" message="Stock changes will appear here." />
          ) : (
            <Table>
              <THead>
                <TRow>
                  <TH>Date & time</TH>
                  <TH>Type</TH>
                  <TH align="right">Change</TH>
                  <TH>Note</TH>
                  <TH>By</TH>
                </TRow>
              </THead>
              <tbody>
                {product.movements.map((m) => (
                  <TRow key={m.id}>
                    <TD>{formatDateTime(m.createdAt)}</TD>
                    <TD>
                      <Badge tone={toneFor(m.type)}>{humanize(m.type)}</Badge>
                    </TD>
                    <TD align="right">
                      <span
                        className={
                          m.quantity > 0
                            ? 'font-medium text-emerald-600'
                            : m.quantity < 0
                            ? 'font-medium text-rose-600'
                            : 'text-slate-400'
                        }
                      >
                        {m.quantity > 0 ? '+' : ''}
                        {formatNumber(m.quantity)}
                      </span>
                    </TD>
                    <TD className="max-w-xs truncate text-slate-500">{m.note ?? '—'}</TD>
                    <TD className="text-slate-500">{m.createdBy ?? '—'}</TD>
                  </TRow>
                ))}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
