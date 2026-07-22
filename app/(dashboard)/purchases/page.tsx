import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import type { SearchParams } from '@/lib/filters';
import { parsePagination, buildPageMeta, searchFilter } from '@/lib/pagination';
import { getYahyaCashSummary } from '@/lib/calculations';
import { PurchasesManager } from './PurchasesManager';

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
    prisma.yahyaPayment.findMany({ orderBy: { date: 'desc' }, take: 50 }),
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
        reconciliationPending: yahya.reconciliationPending,
        count,
      }}
      payments={payments}
      meta={buildPageMeta({ page, pageSize, skip, take, q }, count)}
    />
  );
}
