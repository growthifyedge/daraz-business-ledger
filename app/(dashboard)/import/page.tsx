import { prisma } from '@/lib/prisma';
import { requireOwner } from '@/lib/auth';
import { ImportManager } from './ImportManager';

export const metadata = { title: 'Daraz Import' };
export const dynamic = 'force-dynamic';

export default async function ImportPage() {
  // Owner/admin only — this flow handles confidential customer data.
  await requireOwner();

  const products = await prisma.product.findMany({
    where: { deletedAt: null, active: true },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, sku: true },
  });

  return <ImportManager products={products} />;
}
