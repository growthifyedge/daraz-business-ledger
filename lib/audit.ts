import { prisma } from './prisma';
import type { SessionUser } from './auth';
import type { AuditAction, Prisma } from '@prisma/client';

/** Convert a Prisma record (with Date/Decimal values) into plain JSON. */
function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === null || value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  } catch {
    return undefined;
  }
}

interface LogArgs {
  user: SessionUser | null;
  action: AuditAction;
  module: string;
  recordId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
}

/**
 * Write an entry to the owner-only audit log.
 * Never throws — auditing must never break the underlying action.
 */
export async function logAudit({
  user,
  action,
  module,
  recordId,
  oldValue,
  newValue,
}: LogArgs): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: user?.id ?? null,
        userEmail: user?.email ?? 'system',
        userName: user?.name ?? 'System',
        action,
        module,
        recordId: recordId ?? null,
        oldValue: toJson(oldValue),
        newValue: toJson(newValue),
      },
    });
  } catch (err) {
    // Swallow — auditing failures should not surface to the user.
    console.error('[audit] failed to write log', err);
  }
}
