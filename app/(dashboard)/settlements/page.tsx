import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import type { SearchParams } from '@/lib/filters';
import { parsePagination, buildPageMeta, searchFilter } from '@/lib/pagination';
import { SettlementsManager } from './SettlementsManager';

export const metadata = { title: 'Weekly Settlements' };
export const dynamic = 'force-dynamic';

export default async function SettlementsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const { page, pageSize, skip, take, q } = parsePagination(sp);

  const where: Prisma.SettlementWhereInput = {
    deletedAt: null,
    ...searchFilter(q, ['bankReference', 'notes']),
  };

  const [settlements, count, agg, stores] = await Promise.all([
    prisma.settlement.findMany({
      where,
      orderBy: { date: 'desc' },
      skip,
      take,
      include: {
        store: { select: { name: true } },
      },
    }),
    prisma.settlement.count({ where }),
    prisma.settlement.aggregate({
      where,
      _sum: { grossAmount: true, netAmount: true },
    }),
    prisma.store.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
  ]);

  const rows = settlements.map((s) => ({
    id: s.id,
    date: s.date.toISOString(),
    storeId: s.storeId,
    storeName: s.store?.name ?? null,
    grossAmount: s.grossAmount,
    vat: s.vat,
    commission: s.commission,
    otherCharges: s.otherCharges,
    deductions: s.deductions,
    netAmount: s.netAmount,
    bankReference: s.bankReference,
    notes: s.notes,
  }));

  return (
    <SettlementsManager
      settlements={rows}
      stores={stores}
      totals={{
        gross: agg._sum.grossAmount ?? 0,
        net: agg._sum.netAmount ?? 0,
        count,
      }}
      meta={buildPageMeta({ page, pageSize, skip, take, q }, count)}
    />
  );
}
