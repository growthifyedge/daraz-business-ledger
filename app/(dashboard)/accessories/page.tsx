import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import type { SearchParams } from '@/lib/filters';
import { parsePagination, buildPageMeta, searchFilter } from '@/lib/pagination';
import { AccessoriesManager } from './AccessoriesManager';
import { getPresentationContext } from '@/lib/presentation/context';
import {
  toAccessoriesPresentationRows,
  toAccessoriesPresentationTotals,
} from '@/lib/presentation/viewmodels/accessories';
import { AccessoriesPresentationView } from './AccessoriesPresentationView';

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

  // ── Presentation Safe View: read-only, fully-redacted branch. ──────────────
  // The normal path below is unchanged. This never fetches the receipt URL or
  // notes (which may hold confidential supplier/payment info); unit and total
  // cost are shown only as a band/status; no mutation controls or file links.
  const presentation = await getPresentationContext();
  if (presentation.active) {
    const [pAccessories, pCount, pTotalAgg, pConsumedRows] = await Promise.all([
      prisma.accessory.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: {
          id: true,
          name: true,
          quantityPurchased: true,
          quantityUsed: true,
          unitCost: true,
          totalCost: true,
          purchaseDate: true,
        },
      }),
      prisma.accessory.count({ where }),
      prisma.accessory.aggregate({ where, _sum: { totalCost: true } }),
      prisma.accessory.findMany({ where, select: { quantityUsed: true, unitCost: true } }),
    ]);

    const rows = toAccessoriesPresentationRows(
      pAccessories.map((a) => ({
        id: a.id,
        name: a.name,
        quantityPurchased: a.quantityPurchased,
        quantityUsed: a.quantityUsed,
        unitCost: a.unitCost,
        totalCost: a.totalCost,
        purchaseDate: a.purchaseDate?.toISOString() ?? null,
      })),
      presentation
    );
    const consumedCost = pConsumedRows.reduce((s, a) => s + a.quantityUsed * a.unitCost, 0);
    const totals = toAccessoriesPresentationTotals(
      { totalCost: pTotalAgg._sum.totalCost ?? 0, consumedCost, count: pCount },
      presentation
    );

    return (
      <AccessoriesPresentationView
        rows={rows}
        totals={totals}
        page={page}
        pageSize={pageSize}
        total={pCount}
      />
    );
  }

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
