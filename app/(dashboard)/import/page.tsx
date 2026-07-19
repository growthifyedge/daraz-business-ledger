import { prisma } from '@/lib/prisma';
import { requireOwner } from '@/lib/auth';
import { piiKeyConfigured } from '@/lib/daraz/crypto';
import { ImportManager } from './ImportManager';

export const metadata = { title: 'Daraz Import' };
export const dynamic = 'force-dynamic';

export default async function ImportPage() {
  // Owner only — this flow handles confidential customer data.
  await requireOwner();

  const committedBatches = await prisma.darazImportBatch.count({
    where: { status: 'COMMITTED' },
  });

  return (
    <ImportManager piiKeyReady={piiKeyConfigured()} hasCommittedImport={committedBatches > 0} />
  );
}
