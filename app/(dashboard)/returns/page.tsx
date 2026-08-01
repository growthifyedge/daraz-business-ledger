import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import type { SearchParams } from '@/lib/filters';
import { parsePagination, buildPageMeta, searchFilter } from '@/lib/pagination';
import { ReturnsManager } from './ReturnsManager';
import { getPresentationContext } from '@/lib/presentation/context';
import {
  toReturnsPresentationRows,
  toReturnsPresentationTotals,
} from '@/lib/presentation/viewmodels/returns';
import { ReturnsPresentationView } from './ReturnsPresentationView';
import { DEMO_RETURN_SOURCE } from '@/lib/presentation/demo/samples';

export const metadata = { title: 'Returns & Refunds' };
export const dynamic = 'force-dynamic';

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function ReturnsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const { page, pageSize, skip, take, q } = parsePagination(sp);
  const showDeleted = one(sp.deleted) === '1';
  const error = one(sp.error) ?? null;

  const where: Prisma.ReturnWhereInput = {
    deletedAt: showDeleted ? { not: null } : null,
    ...searchFilter(q, [
      'product.name',
      'sellerSku',
      'orderNumber',
      'returnOrderId',
      'returnItemId',
      'reason',
      'notes',
    ]),
  };

  // Totals always describe the live (non-deleted) set, regardless of the view.
  const liveWhere: Prisma.ReturnWhereInput = { deletedAt: null };

  // ── Presentation Safe View: read-only, fully-redacted branch. ──────────────
  // The normal path below is left completely unchanged; this only runs when the
  // mode is active, and it never fetches buyerName or notes.
  const presentation = await getPresentationContext();
  if (presentation.active) {
    const [pReturns, pCount, totalAgg, sellerAgg, platformAgg, pendingAgg] = await Promise.all([
      prisma.return.findMany({
        where,
        orderBy: { returnDate: 'desc' },
        skip,
        take,
        select: {
          id: true,
          returnDate: true,
          orderNumber: true,
          returnOrderId: true,
          trackingNumber: true,
          quantity: true,
          refundAmount: true,
          chargedTo: true,
          refundStatus: true,
          inventoryStatus: true,
          reason: true,
          product: { select: { name: true } },
          store: { select: { name: true } },
        },
      }),
      prisma.return.count({ where }),
      prisma.return.aggregate({ where: liveWhere, _sum: { refundAmount: true } }),
      prisma.return.aggregate({
        where: { ...liveWhere, refundStatus: 'COMPLETED', chargedTo: 'SELLER' },
        _sum: { refundAmount: true },
      }),
      prisma.return.aggregate({
        where: { ...liveWhere, refundStatus: 'COMPLETED', chargedTo: 'PLATFORM' },
        _sum: { refundAmount: true },
      }),
      prisma.return.aggregate({
        where: { ...liveWhere, refundStatus: 'PENDING' },
        _sum: { refundAmount: true },
      }),
    ]);

    const rows = toReturnsPresentationRows(
      pReturns.map((r) => ({
        id: r.id,
        returnDate: r.returnDate,
        productName: r.product?.name ?? null,
        storeName: r.store?.name ?? null,
        orderNumber: r.orderNumber,
        returnOrderId: r.returnOrderId,
        trackingNumber: r.trackingNumber,
        quantity: r.quantity,
        refundAmount: r.refundAmount,
        chargedTo: r.chargedTo,
        refundStatus: r.refundStatus,
        inventoryStatus: r.inventoryStatus,
        reason: r.reason,
      })),
      presentation
    );
    const totals = toReturnsPresentationTotals(
      {
        refund: totalAgg._sum.refundAmount ?? 0,
        sellerLoss: sellerAgg._sum.refundAmount ?? 0,
        platformCovered: platformAgg._sum.refundAmount ?? 0,
        pending: pendingAgg._sum.refundAmount ?? 0,
        count: pCount,
      },
      presentation
    );

    // Demo Interaction Layer: when the real protected dataset is empty, show a
    // few clearly-marked illustrative rows (redacted by the active profile) so a
    // demo never lands on a blank Returns screen. Nothing is written.
    const illustrative = rows.length === 0;
    const viewRows = illustrative
      ? toReturnsPresentationRows(DEMO_RETURN_SOURCE, presentation)
      : rows;

    return (
      <ReturnsPresentationView
        rows={viewRows}
        totals={totals}
        page={page}
        pageSize={pageSize}
        total={illustrative ? viewRows.length : pCount}
        illustrative={illustrative}
      />
    );
  }
  // ── End Presentation Safe View branch. Normal path continues unchanged. ────

  const [returns, count, totalAgg, sellerAgg, platformAgg, pendingAgg, products, stores, sales, deletedCount] =
    await Promise.all([
      prisma.return.findMany({
        where,
        orderBy: { returnDate: 'desc' },
        skip,
        take,
        include: {
          product: { select: { name: true } },
          store: { select: { name: true } },
        },
      }),
      prisma.return.count({ where }),
      prisma.return.aggregate({ where: liveWhere, _sum: { refundAmount: true, quantity: true } }),
      // Seller loss — the only refunds that reduce profit.
      prisma.return.aggregate({
        where: { ...liveWhere, refundStatus: 'COMPLETED', chargedTo: 'SELLER' },
        _sum: { refundAmount: true },
      }),
      // Platform covered — Daraz's loss, not ours.
      prisma.return.aggregate({
        where: { ...liveWhere, refundStatus: 'COMPLETED', chargedTo: 'PLATFORM' },
        _sum: { refundAmount: true },
      }),
      // Pending — not settled, never counted as a loss.
      prisma.return.aggregate({
        where: { ...liveWhere, refundStatus: 'PENDING' },
        _sum: { refundAmount: true },
      }),
      prisma.product.findMany({
        where: { deletedAt: null, active: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, purchaseCost: true },
      }),
      prisma.store.findMany({
        where: { deletedAt: null },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      }),
      // Sales available to link a return to.
      prisma.sale.findMany({
        where: { deletedAt: null },
        orderBy: { date: 'desc' },
        take: 200,
        select: {
          id: true,
          date: true,
          quantitySold: true,
          unitCost: true,
          returnsRefunds: true,
          productId: true,
          storeId: true,
          product: { select: { name: true, purchaseCost: true } },
        },
      }),
      prisma.return.count({ where: { deletedAt: { not: null } } }),
    ]);

  const rows = returns.map((r) => ({
    id: r.id,
    returnDate: r.returnDate.toISOString(),
    orderDate: r.orderDate ? r.orderDate.toISOString() : null,
    receivedAt: r.receivedAt ? r.receivedAt.toISOString() : null,
    storeId: r.storeId,
    storeName: r.store?.name ?? null,
    productId: r.productId,
    productName: r.product?.name ?? null,
    saleId: r.saleId,
    buyerName: r.buyerName,
    sellerSku: r.sellerSku,
    orderNumber: r.orderNumber,
    returnOrderId: r.returnOrderId,
    returnItemId: r.returnItemId,
    orderItemId: r.orderItemId,
    quantity: r.quantity,
    paidAmount: r.paidAmount,
    refundAmount: r.refundAmount,
    unitCost: r.unitCost,
    chargedTo: r.chargedTo,
    refundStatus: r.refundStatus,
    inventoryStatus: r.inventoryStatus,
    reason: r.reason,
    status: r.status,
    trackingNumber: r.trackingNumber,
    logisticStatus: r.logisticStatus,
    notes: r.notes,
    deleted: r.deletedAt !== null,
  }));

  return (
    <ReturnsManager
      returns={rows}
      products={products}
      stores={stores}
      sales={sales.map((s) => ({
        id: s.id,
        label: `${s.product.name} · ${s.date.toLocaleDateString('en-GB', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        })} · ${s.quantitySold} unit(s)`,
        productId: s.productId,
        storeId: s.storeId,
        legacyRefund: s.returnsRefunds,
        unitCost: s.unitCost,
        productPurchaseCost: s.product.purchaseCost,
      }))}
      totals={{
        refund: totalAgg._sum.refundAmount ?? 0,
        units: totalAgg._sum.quantity ?? 0,
        count,
        sellerLoss: sellerAgg._sum.refundAmount ?? 0,
        platformCovered: platformAgg._sum.refundAmount ?? 0,
        pending: pendingAgg._sum.refundAmount ?? 0,
      }}
      meta={buildPageMeta({ page, pageSize, skip, take, q }, count)}
      showDeleted={showDeleted}
      deletedCount={deletedCount}
      error={error}
    />
  );
}
