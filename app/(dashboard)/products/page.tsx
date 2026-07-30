import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import type { SearchParams } from '@/lib/filters';
import { parsePagination, buildPageMeta, searchFilter } from '@/lib/pagination';
import { ProductsManager } from './ProductsManager';
import { getPresentationContext } from '@/lib/presentation/context';
import { toProductsPresentationRows } from '@/lib/presentation/viewmodels/products';
import { ProductsPresentationView } from './ProductsPresentationView';

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

  // ── Presentation Safe View: read-only, fully-redacted branch. ──────────────
  // The normal path below is unchanged; this never fetches product notes, and
  // costs/prices/stock value are shown only as a band/status.
  const presentation = await getPresentationContext();
  if (presentation.active) {
    const [pProducts, pCount] = await Promise.all([
      prisma.product.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: {
          id: true,
          name: true,
          sku: true,
          category: true,
          purchaseCost: true,
          sellingPrice: true,
          currentStock: true,
          minStockLevel: true,
          damagedStock: true,
          lostStock: true,
          returnedStock: true,
          active: true,
          stores: { select: { store: { select: { name: true } } } },
        },
      }),
      prisma.product.count({ where }),
    ]);

    const rows = toProductsPresentationRows(
      pProducts.map((p) => ({
        id: p.id,
        name: p.name,
        sku: p.sku,
        category: p.category,
        purchaseCost: p.purchaseCost,
        sellingPrice: p.sellingPrice,
        currentStock: p.currentStock,
        minStockLevel: p.minStockLevel,
        damagedStock: p.damagedStock,
        lostStock: p.lostStock,
        returnedStock: p.returnedStock,
        active: p.active,
        storeNames: p.stores.map((s) => s.store.name),
      })),
      presentation
    );

    return (
      <ProductsPresentationView
        rows={rows}
        productCount={pCount}
        page={page}
        pageSize={pageSize}
        total={pCount}
      />
    );
  }
  // ── End Presentation Safe View branch. Normal path continues unchanged. ────

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
