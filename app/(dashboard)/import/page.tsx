import { prisma } from '@/lib/prisma';
import { requireOwner } from '@/lib/auth';
import { ImportManager } from './ImportManager';

export const metadata = { title: 'Daraz Import' };
export const dynamic = 'force-dynamic';

export default async function ImportPage() {
  // Owner only. Phase 4 accepts a sanitized, identifier-only Orders dataset —
  // no customer/PII is handled here.
  await requireOwner();

  const [products, stores, committedBatches] = await Promise.all([
    prisma.product.findMany({
      where: { deletedAt: null, active: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, sku: true },
    }),
    prisma.store.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.darazImportBatch.count({ where: { status: 'COMMITTED' } }),
  ]);

  return (
    <ImportManager
      products={products}
      stores={stores}
      hasCommittedImport={committedBatches > 0}
    />
  );
}
