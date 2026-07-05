import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import type { SearchParams } from '@/lib/filters';
import { parsePagination, buildPageMeta, searchFilter } from '@/lib/pagination';
import { StoresManager } from './StoresManager';

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
