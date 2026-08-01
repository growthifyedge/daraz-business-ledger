import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import type { SearchParams } from '@/lib/filters';
import { parsePagination, buildPageMeta, searchFilter } from '@/lib/pagination';
import { StoresManager } from './StoresManager';
import { getPresentationContext } from '@/lib/presentation/context';
import { toStoresPresentationRows } from '@/lib/presentation/viewmodels/stores';
import { StoresPresentationView } from './StoresPresentationView';

export const metadata = { title: 'Stores' };
export const dynamic = 'force-dynamic';

export default async function StoresPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const { page, pageSize, skip, take, q } = parsePagination(sp);

  const where: Prisma.StoreWhereInput = {
    deletedAt: null,
    ...searchFilter(q, ['name', 'notes']),
  };

  // ── Presentation Safe View: read-only, redacted branch. ────────────────────
  // The normal path below is unchanged. Store display names, active status and
  // the linked-product count are preserved; confidential notes are never
  // fetched; and no mutation controls are rendered.
  const presentation = await getPresentationContext();
  if (presentation.active) {
    const [pStores, pCount] = await Promise.all([
      prisma.store.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: {
          id: true,
          name: true,
          active: true,
          _count: { select: { products: true } },
        },
      }),
      prisma.store.count({ where }),
    ]);

    const rows = toStoresPresentationRows(
      pStores.map((s) => ({
        id: s.id,
        name: s.name,
        active: s.active,
        productCount: s._count.products,
      }))
    );

    return (
      <StoresPresentationView rows={rows} page={page} pageSize={pageSize} total={pCount} />
    );
  }

  const [stores, count] = await Promise.all([
    prisma.store.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: { _count: { select: { products: true } } },
    }),
    prisma.store.count({ where }),
  ]);

  const rows = stores.map((s) => ({
    id: s.id,
    name: s.name,
    notes: s.notes,
    active: s.active,
    createdAt: s.createdAt.toISOString(),
    _count: s._count,
  }));

  return (
    <StoresManager
      stores={rows}
      meta={buildPageMeta({ page, pageSize, skip, take, q }, count)}
    />
  );
}
