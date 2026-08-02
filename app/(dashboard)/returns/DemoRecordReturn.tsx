'use client';

import { useRef, useState } from 'react';
import { Plus, Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { Card, CardBody, Field, Input, Select, Table, THead, TH, TD, TRow } from '@/components/ui';
import { useDemoSimulation } from '@/lib/presentation/demo/useDemoSimulation';
import { useDemoCollection } from '@/lib/presentation/demo/useDemoCollection';
import { DemoActionResult } from '@/components/demo/DemoActionResult';
import { DemoBadge } from '@/components/demo/DemoBadge';
import {
  toReturnsPresentationRows,
  type ReturnsPresentationRow,
} from '@/lib/presentation/viewmodels/returns';
import type { PresentationProfile } from '@/lib/presentation/core';

const PRODUCTS = ['Wireless Earbuds Pro', 'Smart LED Strip 5m', 'USB-C Fast Charger', 'Bluetooth Speaker Mini'];
const REASONS = ['Changed mind', 'Damaged in transit', 'Wrong item received', 'Not as described'];

/**
 * Demo-only "Record Return" workflow shown inside active Presentation Safe View.
 * On submit it redacts the entered values through the SAME view-model the real
 * redacted table uses (so money follows the active Operations/Finance profile and
 * identifiers are anonymised/masked) and appends the row to an in-memory list —
 * no real return is created, no return action is called, nothing is written.
 */
export function DemoRecordReturn({ profile }: { profile: PresentationProfile | null }) {
  const [open, setOpen] = useState(false);
  const { status, run, reset: resetSim } = useDemoSimulation();
  const added = useDemoCollection<ReturnsPresentationRow>();
  const seq = useRef(0);

  const ctx = { active: true as const, profile: profile ?? 'OPERATIONS' };

  function openForm() {
    resetSim();
    setOpen(true);
  }
  function close() {
    setOpen(false);
    resetSim();
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const n = ++seq.current;
    // Build a source row from the form, then redact it exactly like a real row.
    // The typed amount is never displayed back — only its profile-safe form is.
    const [row] = toReturnsPresentationRows(
      [
        {
          id: `demo-return-new-${n}`,
          returnDate: String(f.get('date') || '2026-01-25'),
          productName: String(f.get('product') || PRODUCTS[0]),
          storeName: 'Ashu Traderz',
          orderNumber: `DEMO-NEW-${1000 + n}`,
          returnOrderId: `DEMO-RO-NEW-${1000 + n}`,
          trackingNumber: `DEMO-TRK-NEW-${1000 + n}`,
          quantity: Number(f.get('quantity') || 1),
          refundAmount: Number(f.get('amount') || 0),
          chargedTo: String(f.get('chargedTo') || 'PLATFORM'),
          refundStatus: String(f.get('status') || 'PENDING'),
          inventoryStatus: 'PENDING',
          reason: String(f.get('reason') || REASONS[0]),
        },
      ],
      ctx
    );
    added.add(row);
    run();
  }

  return (
    <section aria-labelledby="demo-returns-heading" className="mt-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 id="demo-returns-heading" className="text-sm font-semibold text-slate-800">
          Demo actions
        </h2>
        <DemoBadge />
        <div className="ml-auto flex items-center gap-2">
          {added.count > 0 && (
            <Button variant="outline" size="sm" onClick={added.reset}>
              <RotateCcw className="h-3.5 w-3.5" /> Reset demo changes
            </Button>
          )}
          <Button size="sm" onClick={openForm}>
            <Plus className="h-4 w-4" /> Record Return
          </Button>
        </div>
      </div>

      {added.count > 0 && (
        <Card>
          <CardBody className="p-0">
            <Table>
              <THead>
                <TRow>
                  <TH>Date</TH>
                  <TH>Product</TH>
                  <TH>Customer</TH>
                  <TH align="right">Qty</TH>
                  <TH align="right">Refund</TH>
                  <TH>Status</TH>
                  <TH>Charged To</TH>
                </TRow>
              </THead>
              <tbody>
                {added.items.map((r) => (
                  <TRow key={r.id}>
                    <TD>{r.returnDate}</TD>
                    <TD>{r.productName}</TD>
                    <TD>{r.customer}</TD>
                    <TD align="right">{r.quantity}</TD>
                    <TD align="right">{r.refund}</TD>
                    <TD>{r.refundStatus}</TD>
                    <TD>{r.chargedTo}</TD>
                  </TRow>
                ))}
              </tbody>
            </Table>
          </CardBody>
        </Card>
      )}

      <Modal
        open={open}
        onClose={close}
        title="Record Return"
        description="Demonstration form — no live records are created."
        size="lg"
      >
        {status === 'success' ? (
          <div className="flex flex-col gap-4">
            <DemoActionResult
              title="Demo return recorded successfully"
              subtitle="Refund is shown by the active profile — no exact amount is revealed."
            />
            <div className="flex justify-end">
              <Button onClick={close}>Done</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Product" required>
                <Select name="product" defaultValue={PRODUCTS[0]}>
                  {PRODUCTS.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Quantity" required>
                <Input name="quantity" type="number" min="1" defaultValue={1} />
              </Field>
              <Field label="Reason">
                <Select name="reason" defaultValue={REASONS[0]}>
                  {REASONS.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Refund status">
                <Select name="status" defaultValue="PENDING">
                  <option value="PENDING">Pending</option>
                  <option value="COMPLETED">Completed</option>
                </Select>
              </Field>
              <Field label="Charged to">
                <Select name="chargedTo" defaultValue="PLATFORM">
                  <option value="PLATFORM">Platform</option>
                  <option value="SELLER">Seller</option>
                </Select>
              </Field>
              <Field label="Refund amount">
                <Input name="amount" type="number" min="0" step="0.01" defaultValue={1999} />
              </Field>
            </div>

            <DemoBadge />

            <div className="mt-2 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" disabled={status === 'pending'}>
                {status === 'pending' && <Loader2 className="h-4 w-4 animate-spin" />}
                {status === 'pending' ? 'Recording…' : 'Record return'}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </section>
  );
}
