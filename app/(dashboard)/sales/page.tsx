import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import type { SearchParams } from '@/lib/filters';
import { parsePagination, buildPageMeta, searchFilter } from '@/lib/pagination';
import { SalesManager } from './SalesManager';

export const metadata = { title: 'Sales Income' };
export const dynamic = 'force-dynamic';

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const { page, pageSize, skip, take, q } = parsePagination(sp);

  const where: Prisma.SaleWhereInput = {
    deletedAt: null,
    ...searchFilter(q, ['product.name', 'notes']),
  };

  const [sales, count, agg, products, stores] = await Promise.all([
    prisma.sale.findMany({
      where,
      orderBy: { date: 'desc' },
      skip,
      take,
      include: {
        product: { select: { name: true } },
        store: { select: { name: true } },
      },
    }),
    prisma.sale.count({ where }),
    prisma.sale.aggregate({
      where,
      _sum: { grossAmount: true, netAmount: true, quantitySold: true },
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
  ]);

  const rows = sales.map((s) => ({
    id: s.id,
    date: s.date.toISOString(),
    storeId: s.storeId,
    storeName: s.store?.name ?? null,
    productId: s.productId,
    productName: s.product.name,
    quantitySold: s.quantitySold,
    unitCost: s.unitCost,
    grossAmount: s.grossAmount,
    commission: s.commission,
    vat: s.vat,
    otherCharges: s.otherCharges,
    returnsRefunds: s.returnsRefunds,
    netAmount: s.netAmount,
    notes: s.notes,
  }));

  return (
    <SalesManager
      sales={rows}
      products={products}
      stores={stores}
      totals={{
        gross: agg._sum.grossAmount ?? 0,
        net: agg._sum.netAmount ?? 0,
        units: agg._sum.quantitySold ?? 0,
      }}
      meta={buildPageMeta({ page, pageSize, skip, take, q }, count)}
    />
  );
}
