'use client';

import { useState } from 'react';
import { Eye } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { Badge, StatCard, Table, THead, TH, TD, TRow } from '@/components/ui';
import { DemoBadge } from '@/components/demo/DemoBadge';
import { DEMO_PRODUCT_MOVEMENTS } from '@/lib/presentation/demo/samples';
import type { ProductsPresentationRow } from '@/lib/presentation/viewmodels/products';

/**
 * Read-only product preview shown inside active Presentation Safe View. It only
 * displays fields that are already redacted on the row (cost/price/value are the
 * profile's band/status strings) plus a clearly-illustrative movement history.
 * There are no edit controls and it writes nothing.
 */
export function DemoProductPreview({ row }: { row: ProductsPresentationRow }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-brand-600 transition hover:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        <Eye className="h-3.5 w-3.5" aria-hidden="true" /> Preview
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={row.name}
        description="Read-only preview — confidential values are protected."
        size="lg"
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <span className="font-mono text-xs">{row.sku}</span>
            <span aria-hidden="true">·</span>
            <span>{row.category}</span>
            {row.active ? (
              <Badge tone="green">Active</Badge>
            ) : (
              <Badge tone="slate">Inactive</Badge>
            )}
            {row.lowStock && <Badge tone="amber">Low stock</Badge>}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatCard label="Current Stock" value={String(row.currentStock)} />
            <StatCard label="Min Level" value={String(row.minStockLevel)} />
            <StatCard label="Purchase Cost" value={row.purchaseCost} hint="Protected" />
            <StatCard label="Selling Price" value={row.sellingPrice} hint="Protected" />
            <StatCard label="Stock Value" value={row.stockValue} hint="Protected" />
            <StatCard label="Store(s)" value={String(row.storeNames.length || '—')} />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-800">Stock movement history</h3>
              <DemoBadge />
            </div>
            <Table>
              <THead>
                <TRow>
                  <TH>Date</TH>
                  <TH>Type</TH>
                  <TH align="right">Change</TH>
                  <TH>Note</TH>
                </TRow>
              </THead>
              <tbody>
                {DEMO_PRODUCT_MOVEMENTS.map((m) => (
                  <TRow key={m.id}>
                    <TD>{m.date}</TD>
                    <TD>
                      <Badge tone="slate">{m.type}</Badge>
                    </TD>
                    <TD align="right" className={m.quantity < 0 ? 'text-rose-600' : 'text-emerald-600'}>
                      {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                    </TD>
                    <TD className="text-slate-500">{m.note}</TD>
                  </TRow>
                ))}
              </tbody>
            </Table>
          </div>
        </div>
      </Modal>
    </>
  );
}
