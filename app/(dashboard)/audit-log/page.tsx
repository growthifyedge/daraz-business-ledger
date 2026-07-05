import { requireOwner } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { AuditLogView } from './AuditLogView';
import type { Prisma } from '@prisma/client';

export const metadata = { title: 'Audit Log' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ module?: string; action?: string; page?: string }>;
}) {
  // Owner-only. Redirects non-owners (also enforced in middleware).
  await requireOwner();

  const sp = await searchParams;
  const currentModule = sp.module ?? '';
  const currentAction = sp.action ?? '';
  const page = Math.max(1, Number(sp.page ?? '1') || 1);

  const where: Prisma.AuditLogWhereInput = {};
  if (currentModule) where.module = currentModule;
  if (currentAction) where.action = currentAction as Prisma.AuditLogWhereInput['action'];

  const [logs, total, distinctModules] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      distinct: ['module'],
      select: { module: true },
      orderBy: { module: 'asc' },
    }),
  ]);

  const rows = logs.map((l) => ({
    id: l.id,
    createdAt: l.createdAt.toISOString(),
    userName: l.userName,
    userEmail: l.userEmail,
    action: l.action,
    module: l.module,
    recordId: l.recordId,
    oldValue: l.oldValue,
    newValue: l.newValue,
  }));

  return (
    <AuditLogView
      logs={rows}
      modules={distinctModules.map((m) => m.module)}
      currentModule={currentModule}
      currentAction={currentAction}
      page={page}
      totalPages={Math.max(1, Math.ceil(total / PAGE_SIZE))}
    />
  );
}
