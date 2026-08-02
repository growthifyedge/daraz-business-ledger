'use client';

import { useRef, useState } from 'react';
import { Plus, Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { Card, CardBody, Field, Input, Table, THead, TH, TD, TRow } from '@/components/ui';
import { useDemoSimulation } from '@/lib/presentation/demo/useDemoSimulation';
import { useDemoCollection } from '@/lib/presentation/demo/useDemoCollection';
import { DemoActionResult } from '@/components/demo/DemoActionResult';
import { DemoActionsBar } from '@/components/demo/DemoActionsBar';
import { DemoBadge } from '@/components/demo/DemoBadge';
import {
  toAccessoriesPresentationRows,
  type AccessoriesPresentationRow,
} from '@/lib/presentation/viewmodels/accessories';
import type { PresentationProfile } from '@/lib/presentation/core';

/**
 * Demo-only "Record Demo Accessory / Stock Usage" workflow shown inside active
 * Presentation Safe View. On submit it redacts the entered unit/total cost
 * through the SAME accessories view-model as the real redacted table (money →
 * profile status/band) and appends the row to in-memory state — no real accessory
 * is created, no stock moves, no upload, and no accessory action is called.
 */
export function DemoRecordAccessory({ profile }: { profile: PresentationProfile | null }) {
  const [open, setOpen] = useState(false);
  const { status, run, reset: resetSim } = useDemoSimulation();
  const added = useDemoCollection<AccessoriesPresentationRow>();
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
    const purchased = Number(f.get('purchased') || 0);
    const used = Number(f.get('used') || 0);
    const unitCost = Number(f.get('unitCost') || 0);
    const [row] = toAccessoriesPresentationRows(
      [
        {
          id: `demo-accessory-new-${n}`,
          name: String(f.get('name') || `Demo Accessory ${n}`),
          quantityPurchased: purchased,
          quantityUsed: used,
          unitCost,
          totalCost: unitCost * purchased,
          purchaseDate: String(f.get('date') || '2026-01-25'),
        },
      ],
      ctx
    );
    added.add(row);
    run();
  }

  return (
    <section aria-label="Accessories demo actions">
      <DemoActionsBar>
        {added.count > 0 && (
          <Button variant="outline" size="sm" onClick={added.reset}>
            <RotateCcw className="h-3.5 w-3.5" /> Reset demo changes
          </Button>
        )}
        <Button size="sm" onClick={openForm}>
          <Plus className="h-4 w-4" /> Record Demo Accessory / Stock Usage
        </Button>
      </DemoActionsBar>

      {added.count > 0 && (
        <Card>
          <CardBody className="p-0">
            <Table>
              <THead>
                <TRow>
                  <TH>Item</TH>
                  <TH align="right">Purchased</TH>
                  <TH align="right">Used</TH>
                  <TH align="right">Unit Cost</TH>
                  <TH align="right">Total Cost</TH>
                </TRow>
              </THead>
              <tbody>
                {added.items.map((a) => (
                  <TRow key={a.id}>
                    <TD className="font-medium">{a.name}</TD>
                    <TD align="right">{a.quantityPurchased}</TD>
                    <TD align="right">{a.quantityUsed}</TD>
                    <TD align="right">{a.unitCost}</TD>
                    <TD align="right" className="font-medium">{a.totalCost}</TD>
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
        title="Record Demo Accessory / Stock Usage"
        description="Demonstration form — no live records are created."
        size="lg"
      >
        {status === 'success' ? (
          <div className="flex flex-col gap-4">
            <DemoActionResult
              title="Demo accessory recorded successfully"
              subtitle="Cost is shown by the active profile — no exact figure is revealed."
            />
            <div className="flex justify-end">
              <Button onClick={close}>Done</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Item name" required>
                <Input name="name" defaultValue="Packing Tape" />
              </Field>
              <Field label="Purchase date">
                <Input name="date" type="date" defaultValue="2026-01-25" />
              </Field>
              <Field label="Quantity purchased">
                <Input name="purchased" type="number" min="0" defaultValue={100} />
              </Field>
              <Field label="Quantity used">
                <Input name="used" type="number" min="0" defaultValue={40} />
              </Field>
              <Field label="Unit cost">
                <Input name="unitCost" type="number" min="0" step="0.01" defaultValue={60} />
              </Field>
            </div>

            <DemoBadge />

            <div className="mt-2 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" disabled={status === 'pending'}>
                {status === 'pending' && <Loader2 className="h-4 w-4 animate-spin" />}
                {status === 'pending' ? 'Recording…' : 'Record accessory'}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </section>
  );
}
