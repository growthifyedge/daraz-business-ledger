'use client';

import { useState } from 'react';
import { UploadCloud, FileText, Loader2, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { useDemoSimulation } from '@/lib/presentation/demo/useDemoSimulation';
import { DemoActionResult } from '@/components/demo/DemoActionResult';
import { DemoBadge } from '@/components/demo/DemoBadge';
import { DEMO_IMPORT_FILENAME, DEMO_IMPORT_STAGES } from '@/lib/presentation/demo/samples';

/**
 * Demo-only Daraz income import shown inside active Presentation Safe View. It
 * uses a built-in fake filename, plays a realistic staged preview (validation,
 * SKU matching, payout reconciliation) and a simulated import success. It never
 * accepts or stores a real file and never calls the real Daraz import API
 * routes — those stay blocked server-side. The trigger is styled like a
 * quick-action tile so the entry point is visible without un-blocking Import.
 */
export function DemoImport() {
  const [open, setOpen] = useState(false);
  const preview = useDemoSimulation(700);
  const doImport = useDemoSimulation(900);

  function openFlow() {
    preview.reset();
    doImport.reset();
    setOpen(true);
  }
  function close() {
    setOpen(false);
    preview.reset();
    doImport.reset();
  }

  const previewed = preview.status === 'success';
  const imported = doImport.status === 'success';

  return (
    <section aria-labelledby="demo-import-heading" className="mb-9">
      <h2 id="demo-import-heading" className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        Demo tools
      </h2>
      <button
        type="button"
        onClick={openFlow}
        className="group flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-card transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 sm:w-auto"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 transition group-hover:bg-brand-100">
          <UploadCloud className="h-5 w-5" aria-hidden="true" />
        </span>
        <span>
          <span className="block text-sm font-semibold text-slate-700 group-hover:text-slate-900">Demo import</span>
          <span className="block text-xs text-slate-400">Daraz payout statement — simulated</span>
        </span>
      </button>

      <Modal
        open={open}
        onClose={close}
        title="Daraz income import"
        description="Demonstration workflow — no real file is uploaded or imported."
        size="lg"
      >
        {imported ? (
          <div className="flex flex-col gap-4">
            <DemoActionResult
              title="Demo import completed successfully"
              subtitle="128 income lines would be imported in normal mode."
            />
            <div className="flex justify-end">
              <Button onClick={close}>Done</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
              <FileText className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
              <span className="flex-1 truncate text-sm font-medium text-slate-700">{DEMO_IMPORT_FILENAME}</span>
              <span className="text-xs text-slate-400">sample</span>
            </div>

            {previewed && (
              <ol className="flex flex-col gap-2">
                {DEMO_IMPORT_STAGES.map((s) => (
                  <li key={s.key} className="flex items-start gap-2.5 rounded-xl border border-slate-100 bg-white p-3">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-slate-800">{s.label}</span>
                      <span className="block text-xs text-slate-500">{s.detail}</span>
                    </span>
                  </li>
                ))}
              </ol>
            )}

            <DemoBadge />

            <div className="mt-1 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={close}>
                Cancel
              </Button>
              {!previewed ? (
                <Button onClick={preview.run} disabled={preview.status === 'pending'}>
                  {preview.status === 'pending' && <Loader2 className="h-4 w-4 animate-spin" />}
                  {preview.status === 'pending' ? 'Reading file…' : 'Preview file'}
                </Button>
              ) : (
                <Button onClick={doImport.run} disabled={doImport.status === 'pending'}>
                  {doImport.status === 'pending' && <Loader2 className="h-4 w-4 animate-spin" />}
                  {doImport.status === 'pending' ? 'Importing…' : 'Import statements'}
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
}
