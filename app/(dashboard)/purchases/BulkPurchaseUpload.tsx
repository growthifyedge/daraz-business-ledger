'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Upload, Download, X, FileText, Database, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/Button';
import { Card, CardBody, StatCard, Badge, Table, THead, TH, TD, TRow } from '@/components/ui';
import { formatMoney } from '@/lib/utils';
import {
  previewBulkPurchases,
  commitBulkPurchases,
  type BulkPreviewState,
  type BulkCommitState,
} from './bulkActions';
import { bulkPurchaseTemplateCsv, type BulkRowStatus } from '@/lib/purchaseBulk';

const STATUS: Record<BulkRowStatus, { label: string; tone: 'green' | 'amber' | 'red' | 'slate' }> = {
  NEW: { label: 'New', tone: 'green' },
  POSSIBLE_DUPLICATE: { label: 'Possible duplicate', tone: 'amber' },
  DUPLICATE: { label: 'Duplicate', tone: 'slate' },
  ERROR: { label: 'Error', tone: 'red' },
};

export function BulkPurchaseUpload() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<BulkPreviewState | null>(null);
  const [importAnyway, setImportAnyway] = useState<Set<number>>(new Set());
  const [result, setResult] = useState<BulkCommitState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewing, startPreview] = useTransition();
  const [committing, setCommitting] = useState(false);

  function reset() {
    setPreview(null);
    setImportAnyway(new Set());
    setResult(null);
    setError(null);
  }
  function close() {
    setOpen(false);
    setFile(null);
    reset();
  }

  function runPreview() {
    setError(null);
    setResult(null);
    setImportAnyway(new Set());
    if (!file) {
      setError('Choose a .csv or .xlsx file first.');
      return;
    }
    const fd = new FormData();
    fd.append('file', file);
    startPreview(async () => {
      const state = await previewBulkPurchases(fd);
      if (state.error) {
        setPreview(null);
        setError(state.error);
      } else setPreview(state);
    });
  }

  function toggleAnyway(line: number) {
    setImportAnyway((prev) => {
      const next = new Set(prev);
      if (next.has(line)) next.delete(line);
      else next.add(line);
      return next;
    });
  }

  function runCommit() {
    if (!file) return;
    setError(null);
    setCommitting(true);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('importAnyway', [...importAnyway].join(','));
    (async () => {
      try {
        const res = await commitBulkPurchases(fd);
        if (res.error) setError(res.error);
        else {
          setResult(res);
          setPreview(null);
          router.refresh(); // reflect new purchases in the table behind the modal
        }
      } catch {
        setError('Network error during import.');
      } finally {
        setCommitting(false);
      }
    })();
  }

  const summary = preview?.summary;
  const selectedPossibles = preview?.rows
    ? preview.rows.filter((r) => r.status === 'POSSIBLE_DUPLICATE' && importAnyway.has(r.line)).length
    : 0;
  const importCount = (summary?.new ?? 0) + selectedPossibles;
  // Show/enable whenever there is at least one importable row — NEW rows, or
  // POSSIBLE_DUPLICATE rows explicitly ticked. Works even with zero NEW rows.
  const showConfirm = !!summary && importCount > 0;

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Upload className="h-4 w-4" /> Bulk Upload
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-6">
          <div className="w-full max-w-5xl">
            <Card>
              <CardBody>
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">Bulk Purchase Upload</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      Preview validates and classifies rows. Import writes NEW rows (and any possible
                      duplicates you tick) as purchases marked <strong>reconciliation pending</strong>.
                    </p>
                  </div>
                  <button
                    onClick={close}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                    aria-label="Close"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <div className="mb-4 flex flex-wrap items-end gap-3">
                  <CsvTemplateButton />
                  <a
                    href="/api/purchases/bulk-template"
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                  >
                    <Download className="h-4 w-4" /> Download Excel template
                  </a>
                  <label className="text-sm">
                    <span className="mb-1 block font-medium text-slate-700">CSV or Excel file</span>
                    <input
                      type="file"
                      accept=".csv,.xlsx"
                      onChange={(e) => {
                        setFile(e.target.files?.[0] ?? null);
                        reset();
                      }}
                      className="block text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-slate-200"
                    />
                  </label>
                  <Button onClick={runPreview} disabled={previewing || committing || !file}>
                    <FileText className="h-4 w-4" /> {previewing ? 'Previewing…' : 'Preview'}
                  </Button>
                </div>

                {error && (
                  <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
                )}

                {result && (
                  <div className="mb-3 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      Imported <strong>{result.imported}</strong> purchase(s); skipped{' '}
                      <strong>{result.skipped}</strong> (duplicates, errors, and un-ticked possible
                      duplicates). All imported rows are marked reconciliation pending. Re-uploading the
                      same sheet will import nothing.
                    </span>
                  </div>
                )}

                {summary && preview?.rows && (
                  <>
                    <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
                      <StatCard label="Rows" value={String(summary.total)} />
                      <StatCard label="New" value={String(summary.new)} tone="positive" />
                      <StatCard
                        label="Possible duplicate"
                        value={String(summary.possibleDuplicate)}
                        tone={summary.possibleDuplicate ? 'warning' : 'default'}
                      />
                      <StatCard label="Duplicate" value={String(summary.duplicate)} />
                      <StatCard
                        label="Error"
                        value={String(summary.error)}
                        tone={summary.error ? 'negative' : 'default'}
                      />
                    </div>

                    <div className="overflow-x-auto rounded-lg border border-slate-200">
                      <Table>
                        <THead>
                          <TRow>
                            <TH>#</TH>
                            <TH>Status</TH>
                            <TH align="center">Import</TH>
                            <TH>Date</TH>
                            <TH>SKU → Product</TH>
                            <TH align="right">Qty</TH>
                            <TH align="right">Unit</TH>
                            <TH align="right">Total</TH>
                            <TH>Reference</TH>
                            <TH>Store</TH>
                            <TH>Notes / messages</TH>
                          </TRow>
                        </THead>
                        <tbody>
                          {preview.rows.map((r) => (
                            <TRow key={r.line}>
                              <TD className="text-xs text-slate-400">{r.line}</TD>
                              <TD>
                                <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                              </TD>
                              <TD align="center">
                                {r.status === 'NEW' ? (
                                  <span className="text-xs text-emerald-600">Yes</span>
                                ) : r.status === 'POSSIBLE_DUPLICATE' ? (
                                  <label className="inline-flex items-center gap-1 text-xs">
                                    <input
                                      type="checkbox"
                                      checked={importAnyway.has(r.line)}
                                      onChange={() => toggleAnyway(r.line)}
                                    />
                                    anyway
                                  </label>
                                ) : (
                                  <span className="text-xs text-slate-300">—</span>
                                )}
                              </TD>
                              <TD className="text-xs">{r.parsed?.dateISO ?? (r.input.date || '—')}</TD>
                              <TD className="max-w-[220px] truncate text-xs">
                                <span className="font-mono">{r.input.productSku || '—'}</span>
                                {r.parsed && <span className="text-slate-500"> → {r.parsed.productName}</span>}
                              </TD>
                              <TD align="right">{r.parsed?.quantity ?? r.input.quantity}</TD>
                              <TD align="right">{r.parsed ? formatMoney(r.parsed.unitCost) : r.input.unitCost}</TD>
                              <TD align="right">{r.parsed ? formatMoney(r.parsed.totalCost) : '—'}</TD>
                              <TD className="text-xs">{r.input.reference || '—'}</TD>
                              <TD className="text-xs">{r.parsed?.storeName ?? (r.input.store || '—')}</TD>
                              <TD className="max-w-[260px] text-xs text-slate-500">
                                {r.messages.length ? r.messages.join(' ') : r.input.notes || ''}
                              </TD>
                            </TRow>
                          ))}
                        </tbody>
                      </Table>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                      <p className="text-xs text-slate-500">
                        Only NEW rows and ticked possible-duplicates are imported. Errors and duplicates
                        are never written. Imports are atomic — if any row fails, nothing is written.
                      </p>
                      {showConfirm && (
                        <Button onClick={runCommit} disabled={committing || importCount === 0}>
                          <Database className="h-4 w-4" />{' '}
                          {committing ? 'Importing…' : `Confirm Import (${importCount})`}
                        </Button>
                      )}
                    </div>
                  </>
                )}
              </CardBody>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}

function CsvTemplateButton() {
  const ref = useRef<HTMLAnchorElement>(null);
  function download() {
    const blob = new Blob([bulkPurchaseTemplateCsv()], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = ref.current!;
    a.href = url;
    a.download = 'bulk-purchase-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <>
      <Button variant="outline" size="sm" onClick={download} type="button">
        <Download className="h-4 w-4" /> Download CSV template
      </Button>
      <a ref={ref} className="hidden" aria-hidden />
    </>
  );
}
