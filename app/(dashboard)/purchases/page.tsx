import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import type { SearchParams } from '@/lib/filters';
import { parsePagination, buildPageMeta, searchFilter } from '@/lib/pagination';
import { getYahyaCashSummary } from '@/lib/calculations';
import { PurchasesManager } from './PurchasesManager';
import { getPresentationContext } from '@/lib/presentation/context';
import {
  toPurchasesPresentationRows,
  toPurchasesPresentationTotals,
} from '@/lib/presentation/viewmodels/purchases';
import { PurchasesPresentationView } from './PurchasesPresentationView';

export const metadata = { title: 'Purchases' };
export const dynamic = 'force-dynamic';

export default async function PurchasesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const { page, pageSize, skip, take, q } = parsePagination(sp);

  const where: Prisma.PurchaseWhereInput = {
    deletedAt: null,
    ...searchFilter(q, ['product.name', 'bankReference', 'notes', 'purchasedBy']),
  };

  // ── Presentation Safe View: read-only, fully-redacted branch. ──────────────
  // The normal path below is unchanged; this never fetches purchasedBy, bank
  // references, invoice URLs or notes, and shows no payment-history detail.
  const presentation = await getPresentationContext();
  if (presentation.active) {
    const [pPurchases, pCount, pTotalAgg, pYahya] = await Promise.all([
      prisma.purchase.findMany({
        where,
        orderBy: { date: 'desc' },
        skip,
        take,
        select: {
          id: true,
          date: true,
          quantity: true,
          unitCost: true,
          totalCost: true,
          paymentStatus: true,
          product: { select: { name: true } },
          store: { select: { name: true } },
        },
      }),
      prisma.purchase.count({ where }),
      prisma.purchase.aggregate({ where, _sum: { totalCost: true } }),
      getYahyaCashSummary(),
    ]);

    const rows = toPurchasesPresentationRows(
      pPurchases.map((p) => ({
        id: p.id,
        date: p.date,
        productName: p.product.name,
        storeName: p.store?.name ?? null,
        quantity: p.quantity,
        unitCost: p.unitCost,
        totalCost: p.totalCost,
        paymentStatus: p.paymentStatus,
      })),
      presentation
    );
    const totals = toPurchasesPresentationTotals(
      {
        total: pTotalAgg._sum?.totalCost ?? 0,
        payable: pYahya.payableToYahya,
        paid: pYahya.actualPaidToYahya,
        count: pCount,
      },
      presentation
    );

    return (
      <PurchasesPresentationView
        rows={rows}
        totals={totals}
        page={page}
        pageSize={pageSize}
        total={pCount}
      />
    );
  }
  // ── End Presentation Safe View branch. Normal path continues unchanged. ────

  const [purchases, count, totalAgg, yahya, paymentsRaw, products, stores] = await Promise.all([
    prisma.purchase.findMany({
      where,
      orderBy: { date: 'desc' },
      skip,
      take,
      include: {
        product: { select: { name: true } },
        store: { select: { name: true } },
      },
    }),
    prisma.purchase.count({ where }),
    prisma.purchase.aggregate({ where, _sum: { totalCost: true } }),
    // Single shared source — same numbers as Cash Flow, Dashboard and reports.
    getYahyaCashSummary(),
    // Payment-level fields only — FIFO allocations are internal, never surfaced.
    // Only active payments reach the owner view. Removed (voided) payments are
    // kept in the DB with an AuditLog trail but never listed in Payment History.
    prisma.yahyaPayment.findMany({ where: { voided: false }, orderBy: { date: 'desc' }, take: 50 }),
    prisma.product.findMany({
      where: { deletedAt: null, active: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.store.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
  ]);

  const rows = purchases.map((p) => ({
    id: p.id,
    date: p.date.toISOString(),
    purchasedBy: p.purchasedBy,
    storeId: p.storeId,
    storeName: p.store?.name ?? null,
    productId: p.productId,
    productName: p.product.name,
    quantity: p.quantity,
    unitCost: p.unitCost,
    totalCost: p.totalCost,
    paymentStatus: p.paymentStatus,
    reimbursementDate: p.reimbursementDate?.toISOString() ?? null,
    bankReference: p.bankReference,
    invoiceUrl: p.invoiceUrl,
    notes: p.notes,
  }));

  const payments = paymentsRaw.map((pay) => ({
    id: pay.id,
    date: pay.date.toISOString(),
    amount: pay.amount,
    bankAccount: pay.bankAccount,
    bankReference: pay.bankReference,
    notes: pay.notes,
    voided: pay.voided,
  }));

  return (
    <PurchasesManager
      purchases={rows}
      products={products}
      stores={stores}
      totals={{
        total: totalAgg._sum?.totalCost ?? 0,
        payable: yahya.payableToYahya,
        paid: yahya.actualPaidToYahya,
        reconciliationPending: yahya.reconciliationPending,
        count,
      }}
      payments={payments}
      meta={buildPageMeta({ page, pageSize, skip, take, q }, count)}
    />
  );
}
