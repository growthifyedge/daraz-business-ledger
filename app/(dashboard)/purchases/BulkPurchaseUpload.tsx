'use client';

import { useActionState, useRef, useState } from 'react';
import { Upload, Download, X, FileText } from 'lucide-react';
import { Button, SubmitButton } from '@/components/Button';
import { Card, CardBody, StatCard, Badge, Table, THead, TH, TD, TRow } from '@/components/ui';
import { formatMoney } from '@/lib/utils';
import { previewBulkPurchases, type BulkPreviewState } from './bulkActions';
import { bulkPurchaseTemplateCsv, type BulkRowStatus } from '@/lib/purchaseBulk';

const initial: BulkPreviewState = {};

const STATUS: Record<BulkRowStatus, { label: string; tone: 'green' | 'amber' | 'red' | 'slate' }> = {
  NEW: { label: 'New', tone: 'green' },
  POSSIBLE_DUPLICATE: { label: 'Possible duplicate', tone: 'amber' },
  DUPLICATE: { label: 'Duplicate', tone: 'slate' },
  ERROR: { label: 'Error', tone: 'red' },
};

export function BulkPurchaseUpload() {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(previewBulkPurchases, initial);

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
                      Preview only — this validates and classifies your rows. Nothing is imported yet.
                    </p>
                  </div>
                  <button
                    onClick={() => setOpen(false)}
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
                  <form action={action} className="flex flex-wrap items-end gap-2">
                    <label className="text-sm">
                      <span className="mb-1 block font-medium text-slate-700">CSV or Excel file</span>
                      <input
                        type="file"
                        name="file"
                        accept=".csv,.xlsx"
                        required
                        className="block text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-slate-200"
                      />
                    </label>
                    <SubmitButton>
                      <FileText className="h-4 w-4" /> Preview
                    </SubmitButton>
                  </form>
                </div>

                {state.error && (
                  <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{state.error}</p>
                )}

                {state.summary && state.rows && (
                  <>
                    <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
                      <StatCard label="Rows" value={String(state.summary.total)} />
                      <StatCard label="New" value={String(state.summary.new)} tone="positive" />
                      <StatCard
                        label="Possible duplicate"
                        value={String(state.summary.possibleDuplicate)}
                        tone={state.summary.possibleDuplicate ? 'warning' : 'default'}
                      />
                      <StatCard label="Duplicate" value={String(state.summary.duplicate)} />
                      <StatCard
                        label="Error"
                        value={String(state.summary.error)}
                        tone={state.summary.error ? 'negative' : 'default'}
                      />
                    </div>

                    <div className="overflow-x-auto rounded-lg border border-slate-200">
                      <Table>
                        <THead>
                          <TRow>
                            <TH>#</TH>
                            <TH>Status</TH>
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
                          {state.rows.map((r) => (
                            <TRow key={r.line}>
                              <TD className="text-xs text-slate-400">{r.line}</TD>
                              <TD>
                                <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                              </TD>
                              <TD className="text-xs">{r.parsed?.dateISO ?? (r.input.date || '—')}</TD>
                              <TD className="max-w-[220px] truncate text-xs">
                                <span className="font-mono">{r.input.productSku || '—'}</span>
                                {r.parsed && (
                                  <span className="text-slate-500"> → {r.parsed.productName}</span>
                                )}
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

                    <p className="mt-3 text-xs text-slate-400">
                      Import is not enabled in this build — preview and validation only. No purchase,
                      stock or payment records are created.
                    </p>
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
