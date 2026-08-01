import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import type { SearchParams } from '@/lib/filters';
import { getFinancials } from '@/lib/calculations';
import { listMissingCogsProducts, type DeliveredOrderLine } from '@/lib/daraz/income';
import {
  PageHeader,
  Card,
  CardBody,
  Table,
  THead,
  TH,
  TD,
  TRow,
  Badge,
  EmptyState,
} from '@/components/ui';
import { formatNumber } from '@/lib/utils';
import { getPresentationContext } from '@/lib/presentation/context';
import { redactMoney } from '@/lib/presentation/redact';
import { ArrowLeft, AlertTriangle } from 'lucide-react';

export const metadata = { title: 'Missing COGS costs' };
// Same freshness contract as the Dashboard: figures must never be stale after an
// import, purchase or SKU-mapping change, and the total here must always match
// the Dashboard's uncovered-units warning for the same store scope.
export const dynamic = 'force-dynamic';

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function MissingCogsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const requestedStore = one(sp.store) ?? null;

  // Presentation Safe View: this Dashboard drill-down stays available (counts are
  // safe operational context) but the per-product purchase cost is shown only as
  // a band/status — never an exact figure. Identity when inactive.
  const presentation = await getPresentationContext();

  // Mirror getFinancials' COGS inputs EXACTLY so this page's total equals the
  // Dashboard warning: delivered order items are store-scoped at the DB (empty
  // pure filter), costing resolves via the saved (store, sku) mapping, and only
  // order items with settled income are counted. Read-only throughout.
  const deliveredWhere: Prisma.DarazOrderItemWhereInput = {
    status: { equals: 'delivered', mode: 'insensitive' },
  };
  if (requestedStore) deliveredWhere.storeId = requestedStore;

  const [stores, deliveredLines, skuMappings, products, settledRows, fin] = await Promise.all([
    prisma.store.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.darazOrderItem.findMany({
      where: deliveredWhere,
      select: { orderItemId: true, storeId: true, sellerSku: true, status: true, createTime: true, quantity: true },
    }),
    prisma.darazSkuMapping.findMany({ select: { storeId: true, sellerSku: true, productId: true } }),
    prisma.product.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, sku: true, purchaseCost: true },
    }),
    prisma.darazIncomeLine.findMany({ select: { orderItemId: true }, distinct: ['orderItemId'] }),
    getFinancials({ storeId: requestedStore }),
  ]);

  const storeId = requestedStore && stores.some((s) => s.id === requestedStore) ? requestedStore : null;
  const activeStore = stores.find((s) => s.id === storeId) ?? null;
  const scopeLabel = activeStore ? activeStore.name : 'All Stores';

  const settledOrderItemIds = new Set(settledRows.map((r) => r.orderItemId));
  const report = listMissingCogsProducts(
    deliveredLines.map(
      (l): DeliveredOrderLine => ({
        orderItemId: l.orderItemId,
        storeId: l.storeId,
        sellerSku: l.sellerSku,
        status: l.status,
        orderDate: l.createTime,
        quantity: l.quantity,
      })
    ),
    skuMappings.map((m) => ({ storeId: m.storeId, sellerSku: m.sellerSku, productId: m.productId })),
    products.map((p) => ({ id: p.id, purchaseCost: p.purchaseCost })),
    {},
    settledOrderItemIds
  );

  // Join display names. The pure report carries ids + counts only.
  const productById = new Map(products.map((p) => [p.id, p]));
  const storeNameById = new Map(stores.map((s) => [s.id, s.name]));
  const rows = report.rows.map((r) => {
    const product = r.productId ? productById.get(r.productId) : undefined;
    return {
      ...r,
      productName: product?.name ?? null,
      productSku: product?.sku ?? null,
      storeName: r.storeId ? storeNameById.get(r.storeId) ?? null : null,
    };
  });

  // Cross-check against the authoritative Dashboard figure. They are computed
  // from the same inputs by the same pure code, so this holds by construction;
  // surfacing it makes any future drift immediately visible.
  const coverage = fin.darazCogs;
  const dashboardMissing = coverage.deliveredUnits - coverage.costedUnits;
  const matchesDashboard = report.totalMissingUnits === dashboardMissing;

  return (
    <div>
      <Link
        href={storeId ? `/dashboard?store=${encodeURIComponent(storeId)}` : '/dashboard'}
        className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
      >
        <ArrowLeft className="h-4 w-4" /> Back to dashboard
      </Link>

      <PageHeader
        title="Missing COGS costs"
        description={`Delivered units without a product purchase cost for ${scopeLabel}. Estimated profit excludes these units until a cost is recorded.`}
      />

      <Card className="mb-4 border-amber-200 bg-amber-50/70">
        <CardBody className="flex items-start gap-2 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <p className="text-sm leading-relaxed text-amber-800">
            <strong>{formatNumber(report.totalMissingUnits)}</strong> delivered unit(s) across{' '}
            <strong>{formatNumber(rows.length)}</strong> product(s) still need a purchase cost.
            {!matchesDashboard && (
              <span className="mt-1 block text-xs text-rose-700">
                Warning: this total ({formatNumber(report.totalMissingUnits)}) does not match the
                dashboard figure ({formatNumber(dashboardMissing)}).
              </span>
            )}
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="p-0">
          {rows.length === 0 ? (
            <EmptyState
              title="Every delivered unit is costed"
              message="All delivered units in this scope have a product purchase cost. Estimated profit is complete."
            />
          ) : (
            <Table>
              <THead>
                <TRow>
                  <TH>Product</TH>
                  <TH>Store</TH>
                  <TH>Daraz Seller SKU</TH>
                  <TH align="right">Delivered units missing cost</TH>
                  <TH align="right">Current purchase cost</TH>
                  <TH align="right">Action</TH>
                </TRow>
              </THead>
              <tbody>
                {rows.map((r) => (
                  <TRow key={`${r.storeId ?? ''}::${r.sellerSku}`}>
                    <TD>
                      {r.mapped ? (
                        r.productName ?? '—'
                      ) : (
                        <span className="inline-flex items-center gap-1.5">
                          <Badge tone="amber">Unmapped SKU</Badge>
                        </span>
                      )}
                    </TD>
                    <TD className="text-slate-500">{r.storeName ?? '—'}</TD>
                    <TD className="font-mono text-xs text-slate-600">{r.sellerSku || '—'}</TD>
                    <TD align="right" className="font-medium text-amber-700">
                      {formatNumber(r.deliveredUnitsMissingCost)}
                    </TD>
                    <TD align="right">{redactMoney(r.currentPurchaseCost, presentation)}</TD>
                    <TD align="right">
                      <Link
                        href={`/products?q=${encodeURIComponent(r.mapped ? r.productSku ?? r.sellerSku : r.sellerSku)}`}
                        className="font-medium text-brand-600 hover:underline"
                      >
                        {r.mapped ? 'Record purchase cost' : 'Map this SKU'}
                      </Link>
                    </TD>
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
