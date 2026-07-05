import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import type { SearchParams } from '@/lib/filters';
import { parsePagination, buildPageMeta, searchFilter } from '@/lib/pagination';
import { ProductsManager } from './ProductsManager';

export const metadata = { title: 'Products & Inventory' };
export const dynamic = 'force-dynamic';

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const { page, pageSize, skip, take, q } = parsePagination(sp);

  const where: Prisma.ProductWhereInput = {
    deletedAt: null,
    ...searchFilter(q, ['name', 'sku']),
  };

  const [products, count, stores] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: { stores: { include: { store: true } } },
    }),
    prisma.product.count({ where }),
    prisma.store.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
  ]);

  const rows = products.map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    purchaseCost: p.purchaseCost,
    sellingPrice: p.sellingPrice,
    currentStock: p.currentStock,
    minStockLevel: p.minStockLevel,
    damagedStock: p.damagedStock,
    lostStock: p.lostStock,
    returnedStock: p.returnedStock,
    active: p.active,
    notes: p.notes,
    storeIds: p.stores.map((s) => s.storeId),
    storeNames: p.stores.map((s) => s.store.name),
  }));

  return (
    <ProductsManager
      products={rows}
      stores={stores}
      meta={buildPageMeta({ page, pageSize, skip, take, q }, count)}
    />
  );
}
