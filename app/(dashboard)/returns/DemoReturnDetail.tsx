'use client';

import { useState } from 'react';
import { Eye, CheckCircle2, Circle } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { Badge } from '@/components/ui';
import { DemoBadge } from '@/components/demo/DemoBadge';
import { DEMO_RETURN_TIMELINE } from '@/lib/presentation/demo/samples';
import type { ReturnsPresentationRow } from '@/lib/presentation/viewmodels/returns';

/**
 * Read-only return detail drawer shown inside active Presentation Safe View. It
 * displays only the already-redacted row fields (anonymised customer / masked
 * ids / profile-protected refund) plus an illustrative status timeline. No
 * create / edit / restore / delete — it writes nothing.
 */
export function DemoReturnDetail({ row }: { row: ReturnsPresentationRow }) {
  const [open, setOpen] = useState(false);

  const facts: Array<[string, string | number]> = [
    ['Date', row.returnDate],
    ['Product', row.productName],
    ['Store', row.storeName],
    ['Customer', row.customer],
    ['Order No.', row.orderNumber],
    ['Return ID', row.returnId],
    ['Tracking', row.tracking],
    ['Quantity', row.quantity],
    ['Refund', row.refund],
    ['Charged To', row.chargedTo],
  ];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-brand-600 transition hover:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        <Eye className="h-3.5 w-3.5" aria-hidden="true" /> View
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Return detail"
        description="Read-only tracking — identifiers and money are protected."
        size="lg"
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="slate">{row.refundStatus}</Badge>
            <Badge tone="slate">{row.inventoryStatus}</Badge>
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
            {facts.map(([label, value]) => (
              <div key={label}>
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
                <dd className="mt-0.5 text-sm text-slate-800">{value}</dd>
              </div>
            ))}
          </dl>

          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-800">Return progress</h3>
              <DemoBadge />
            </div>
            <ol className="flex flex-col gap-2">
              {DEMO_RETURN_TIMELINE.map((step) => (
                <li key={step.label} className="flex items-center gap-2 text-sm">
                  {step.done ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden="true" />
                  ) : (
                    <Circle className="h-4 w-4 text-slate-300" aria-hidden="true" />
                  )}
                  <span className={step.done ? 'text-slate-700' : 'text-slate-400'}>{step.label}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </Modal>
    </>
  );
}
