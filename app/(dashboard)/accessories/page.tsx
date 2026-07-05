import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import type { SearchParams } from '@/lib/filters';
import { parsePagination, buildPageMeta, searchFilter } from '@/lib/pagination';
import { AccessoriesManager } from './AccessoriesManager';

export const metadata = { title: 'Accessories & Stationery' };
export const dynamic = 'force-dynamic';

export default async function AccessoriesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const { page, pageSize, skip, take, q } = parsePagination(sp);

  const where: Prisma.AccessoryWhereInput = {
    deletedAt: null,
    ...searchFilter(q, ['name', 'notes']),
  };

  const [accessories, count, totalAgg, consumedRows] = await Promise.all([
    prisma.accessory.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
    prisma.accessory.count({ where }),
    prisma.accessory.aggregate({ where, _sum: { totalCost: true } }),
    // consumed cost = SUM(quantityUsed * unitCost), which Prisma's _sum cannot
    // express; pull the two columns over the filtered set and reduce in JS.
    prisma.accessory.findMany({
      where,
      select: { quantityUsed: true, unitCost: true },
    }),
  ]);

  const rows = accessories.map((a) => ({
    id: a.id,
    name: a.name,
    quantityPurchased: a.quantityPurchased,
    quantityUsed: a.quantityUsed,
    unitCost: a.unitCost,
    totalCost: a.totalCost,
    purchaseDate: a.purchaseDate?.toISOString() ?? null,
    receiptUrl: a.receiptUrl,
    notes: a.notes,
  }));

  const consumedCost = consumedRows.reduce(
    (s, a) => s + a.quantityUsed * a.unitCost,
    0
  );

  return (
    <AccessoriesManager
      accessories={rows}
      totals={{
        totalCost: totalAgg._sum.totalCost ?? 0,
        consumedCost,
        count,
      }}
      meta={buildPageMeta({ page, pageSize, skip, take, q }, count)}
    />
  );
}
