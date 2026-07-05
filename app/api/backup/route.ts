import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { logAudit } from '@/lib/audit';

// Owner-only full-data export (JSON backup of every table).
// Password hashes are intentionally excluded — this is a data backup, not an
// auth/credentials export.
export async function GET() {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (user.role !== 'OWNER') {
    return NextResponse.json({ error: 'Owner access required' }, { status: 403 });
  }

  const [
    users,
    stores,
    products,
    productStores,
    stockMovements,
    purchases,
    sales,
    expenses,
    accessories,
    settlements,
    investments,
    payouts,
    auditLogs,
  ] = await Promise.all([
    prisma.user.findMany({
      select: { id: true, email: true, name: true, role: true, active: true, createdAt: true },
    }),
    prisma.store.findMany(),
    prisma.product.findMany(),
    prisma.productStore.findMany(),
    prisma.stockMovement.findMany(),
    prisma.purchase.findMany(),
    prisma.sale.findMany(),
    prisma.expense.findMany(),
    prisma.accessory.findMany(),
    prisma.settlement.findMany(),
    prisma.investment.findMany(),
    prisma.payout.findMany(),
    prisma.auditLog.findMany(),
  ]);

  const backup = {
    meta: {
      app: 'Daraz Business Ledger',
      version: 1,
      exportedAt: new Date().toISOString(),
      exportedBy: user.email,
    },
    data: {
      users,
      stores,
      products,
      productStores,
      stockMovements,
      purchases,
      sales,
      expenses,
      accessories,
      settlements,
      investments,
      payouts,
      auditLogs,
    },
  };

  await logAudit({ user, action: 'CREATE', module: 'Backup', newValue: { exportedAt: backup.meta.exportedAt } });

  const filename = `daraz-backup-${new Date().toISOString().slice(0, 10)}.json`;
  return new NextResponse(JSON.stringify(backup, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
