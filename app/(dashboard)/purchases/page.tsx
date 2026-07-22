import { prisma } from '@/lib/prisma';
import type { Prisma, PaymentStatus } from '@prisma/client';
import type { SearchParams } from '@/lib/filters';
import { parsePagination, buildPageMeta, searchFilter } from '@/lib/pagination';
import { remainingBalance } from '@/lib/yahyaPayments';
import { getYahyaCashSummary } from '@/lib/calculations';
import { PurchasesManager } from './PurchasesManager';

export const metadata = { title: 'Purchases' };
export const dynamic = 'force-dynamic';

const PAYABLE: PaymentStatus[] = ['UNPAID', 'PARTIALLY_PAID'];
const nonVoidedAllocs = {
  paymentAllocations: { where: { payment: { voided: false } }, select: { amount: true } },
};

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

  const [
    purchases,
    count,
    totalAgg,
    yahya,
    payablePurchasesRaw,
    paymentsRaw,
    products,
    stores,
  ] = await Promise.all([
    prisma.purchase.findMany({
      where,
      orderBy: { date: 'desc' },
      skip,
      take,
      include: {
        product: { select: { name: true } },
        store: { select: { name: true } },
        ...nonVoidedAllocs,
      },
    }),
    prisma.purchase.count({ where }),
    prisma.purchase.aggregate({ where, _sum: { totalCost: true } }),
    // Single shared source — same numbers as Cash Flow, Dashboard and reports.
    getYahyaCashSummary(),
    prisma.purchase.findMany({
      where: { deletedAt: null, paymentStatus: { in: PAYABLE } },
      orderBy: { date: 'asc' },
      take: 300,
      include: {
        product: { select: { name: true } },
        store: { select: { name: true } },
        ...nonVoidedAllocs,
      },
    }),
    prisma.yahyaPayment.findMany({
      orderBy: { date: 'desc' },
      take: 50,
      include: {
        allocations: { include: { purchase: { select: { product: { select: { name: true } } } } } },
      },
    }),
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

  const allocated = (p: { paymentAllocations: { amount: number }[] }) =>
    p.paymentAllocations.reduce((s, a) => s + a.amount, 0);

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
    remaining: remainingBalance({
      paymentStatus: p.paymentStatus,
      totalCost: p.totalCost,
      allocatedAmount: allocated(p),
    }),
    reimbursementDate: p.reimbursementDate?.toISOString() ?? null,
    bankReference: p.bankReference,
    invoiceUrl: p.invoiceUrl,
    notes: p.notes,
  }));

  const payablePurchases = payablePurchasesRaw
    .map((p) => ({
      id: p.id,
      label: `${p.product.name}${p.store?.name ? ` · ${p.store.name}` : ''} · ${p.date
        .toISOString()
        .slice(0, 10)}${p.bankReference ? ` · ${p.bankReference}` : ''}`,
      remaining: remainingBalance({
        paymentStatus: p.paymentStatus,
        totalCost: p.totalCost,
        allocatedAmount: allocated(p),
      }),
    }))
    .filter((p) => p.remaining > 0);

  const payments = paymentsRaw.map((pay) => ({
    id: pay.id,
    date: pay.date.toISOString(),
    amount: pay.amount,
    bankAccount: pay.bankAccount,
    bankReference: pay.bankReference,
    notes: pay.notes,
    voided: pay.voided,
    allocations: pay.allocations.map((a) => ({
      productName: a.purchase.product.name,
      amount: a.amount,
    })),
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
      payablePurchases={payablePurchases}
      payments={payments}
      meta={buildPageMeta({ page, pageSize, skip, take, q }, count)}
    />
  );
}
