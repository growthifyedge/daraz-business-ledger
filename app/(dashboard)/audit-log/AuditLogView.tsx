'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useState } from 'react';
import { Eye, ShieldCheck } from 'lucide-react';
import { Modal } from '@/components/Modal';
import {
  Card,
  CardBody,
  Badge,
  EmptyState,
  Select,
  Table,
  THead,
  TH,
  TD,
  TRow,
} from '@/components/ui';
import { formatDateTime, humanize } from '@/lib/utils';

interface LogRow {
  id: string;
  createdAt: string;
  userName: string;
  userEmail: string;
  action: string;
  module: string;
  recordId: string | null;
  oldValue: unknown;
  newValue: unknown;
}

const ACTION_TONE: Record<string, 'green' | 'blue' | 'red' | 'amber' | 'slate'> = {
  CREATE: 'green',
  UPDATE: 'blue',
  DELETE: 'red',
  LOGIN: 'amber',
  RESTORE: 'slate',
};

export function AuditLogView({
  logs,
  modules,
  currentModule,
  currentAction,
  page,
  totalPages,
}: {
  logs: LogRow[];
  modules: string[];
  currentModule: string;
  currentAction: string;
  page: number;
  totalPages: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [detail, setDetail] = useState<LogRow | null>(null);

  function setParam(key: string, value: string) {
    const q = new URLSearchParams();
    if (key === 'module' ? value : currentModule) q.set('module', key === 'module' ? value : currentModule);
    if (key === 'action' ? value : currentAction) q.set('action', key === 'action' ? value : currentAction);
    // reset to page 1 on filter change
    router.push(`${pathname}?${q.toString()}`);
  }

  function goPage(p: number) {
    const q = new URLSearchParams();
    if (currentModule) q.set('module', currentModule);
    if (currentAction) q.set('action', currentAction);
    q.set('page', String(p));
    router.push(`${pathname}?${q.toString()}`);
  }

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
            <ShieldCheck className="h-6 w-6 text-amber-500" /> Audit Log
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Owner-only record of every change. Logs cannot be edited or deleted.
          </p>
        </div>
        <div className="flex gap-2">
          <Select
            value={currentModule}
            onChange={(e) => setParam('module', e.target.value)}
            className="w-auto"
          >
            <option value="">All modules</option>
            {modules.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
          <Select
            value={currentAction}
            onChange={(e) => setParam('action', e.target.value)}
            className="w-auto"
          >
            <option value="">All actions</option>
            {['CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'RESTORE'].map((a) => (
              <option key={a} value={a}>
                {humanize(a)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {logs.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck className="h-10 w-10" />}
          title="No activity yet"
          message="Changes across the system will be recorded here."
        />
      ) : (
        <Card>
          <CardBody className="p-0">
            <Table>
              <THead>
                <TRow>
                  <TH>Date & time</TH>
                  <TH>User</TH>
                  <TH>Action</TH>
                  <TH>Module</TH>
                  <TH>Record</TH>
                  <TH align="right">Details</TH>
                </TRow>
              </THead>
              <tbody>
                {logs.map((l) => (
                  <TRow key={l.id}>
                    <TD className="whitespace-nowrap">{formatDateTime(l.createdAt)}</TD>
                    <TD>
                      <div className="font-medium text-slate-800">{l.userName}</div>
                      <div className="text-xs text-slate-400">{l.userEmail}</div>
                    </TD>
                    <TD>
                      <Badge tone={ACTION_TONE[l.action] ?? 'slate'}>
                        {humanize(l.action)}
                      </Badge>
                    </TD>
                    <TD>{l.module}</TD>
                    <TD className="max-w-[120px] truncate text-xs text-slate-400">
                      {l.recordId ?? '—'}
                    </TD>
                    <TD align="right">
                      {l.oldValue || l.newValue ? (
                        <button
                          onClick={() => setDetail(l)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                          aria-label="View details"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </TD>
                  </TRow>
                ))}
              </tbody>
            </Table>
          </CardBody>
        </Card>
      )}

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2 text-sm">
          <button
            disabled={page <= 1}
            onClick={() => goPage(page - 1)}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-slate-600 disabled:opacity-40 enabled:hover:bg-slate-50"
          >
            Previous
          </button>
          <span className="text-slate-500">
            Page {page} of {totalPages}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => goPage(page + 1)}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-slate-600 disabled:opacity-40 enabled:hover:bg-slate-50"
          >
            Next
          </button>
        </div>
      )}

      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        title="Change Details"
        description={detail ? `${humanize(detail.action)} · ${detail.module}` : ''}
        size="lg"
      >
        {detail && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Before
              </p>
              <pre className="max-h-80 overflow-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
                {detail.oldValue ? JSON.stringify(detail.oldValue, null, 2) : '—'}
              </pre>
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                After
              </p>
              <pre className="max-h-80 overflow-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
                {detail.newValue ? JSON.stringify(detail.newValue, null, 2) : '—'}
              </pre>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
