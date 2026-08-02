'use client';

import { useRef, useState } from 'react';
import { Plus, Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { Card, CardBody, Field, Input, Select, Table, THead, TH, TD, TRow } from '@/components/ui';
import { useDemoSimulation } from '@/lib/presentation/demo/useDemoSimulation';
import { useDemoCollection } from '@/lib/presentation/demo/useDemoCollection';
import { DemoActionResult } from '@/components/demo/DemoActionResult';
import { DemoActionsBar } from '@/components/demo/DemoActionsBar';
import { DemoBadge } from '@/components/demo/DemoBadge';
import {
  toSalesPresentationRows,
  type SalesPresentationRow,
} from '@/lib/presentation/viewmodels/sales';
import type { PresentationProfile } from '@/lib/presentation/core';

const PRODUCTS = ['Wireless Earbuds Pro', 'Smart LED Strip 5m', 'USB-C Fast Charger', 'Bluetooth Speaker Mini'];
const STORES = ['Ashu Traderz', 'GrowthifyEdge'];

/**
 * Demo-only "Record Demo Sale" workflow shown inside active Presentation Safe
 * View. On submit it redacts the entered gross/net through the SAME sales
 * view-model as the real redacted table (money → profile status/band) and appends
 * the row to in-memory state — no real sale is created, no stock or COGS changes,
 * and no sales action is called.
 */
export function DemoRecordSale({ profile }: { profile: PresentationProfile | null }) {
  const [open, setOpen] = useState(false);
  const { status, run, reset: resetSim } = useDemoSimulation();
  const added = useDemoCollection<SalesPresentationRow>();
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
    const [row] = toSalesPresentationRows(
      [
        {
          id: `demo-sale-new-${n}`,
          date: String(f.get('date') || '2026-01-25'),
          storeName: String(f.get('store') || STORES[0]),
          productName: String(f.get('product') || PRODUCTS[0]),
          quantitySold: Number(f.get('quantity') || 1),
          grossAmount: Number(f.get('gross') || 0),
          netAmount: Number(f.get('net') || 0),
        },
      ],
      ctx
    );
    added.add(row);
    run();
  }

  return (
    <section aria-label="Manual Sales demo actions">
      <DemoActionsBar>
        {added.count > 0 && (
          <Button variant="outline" size="sm" onClick={added.reset}>
            <RotateCcw className="h-3.5 w-3.5" /> Reset demo changes
          </Button>
        )}
        <Button size="sm" onClick={openForm}>
          <Plus className="h-4 w-4" /> Record Demo Sale
        </Button>
      </DemoActionsBar>

      {added.count > 0 && (
        <Card>
          <CardBody className="p-0">
            <Table>
              <THead>
                <TRow>
                  <TH>Date</TH>
                  <TH>Store</TH>
                  <TH>Product</TH>
                  <TH align="right">Units</TH>
                  <TH align="right">Gross</TH>
                  <TH align="right">Net</TH>
                </TRow>
              </THead>
              <tbody>
                {added.items.map((s) => (
                  <TRow key={s.id}>
                    <TD>{s.date}</TD>
                    <TD className="text-slate-500">{s.storeName}</TD>
                    <TD className="font-medium">{s.productName}</TD>
                    <TD align="right">{s.quantitySold}</TD>
                    <TD align="right">{s.grossAmount}</TD>
                    <TD align="right" className="font-medium">{s.netAmount}</TD>
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
        title="Record Demo Sale"
        description="Demonstration form — no live records are created."
        size="lg"
      >
        {status === 'success' ? (
          <div className="flex flex-col gap-4">
            <DemoActionResult
              title="Demo sale recorded successfully"
              subtitle="Amounts are shown by the active profile — no exact figure is revealed."
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
              <Field label="Store">
                <Select name="store" defaultValue={STORES[0]}>
                  {STORES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Units sold" required>
                <Input name="quantity" type="number" min="1" defaultValue={3} />
              </Field>
              <Field label="Date">
                <Input name="date" type="date" defaultValue="2026-01-25" />
              </Field>
              <Field label="Gross amount">
                <Input name="gross" type="number" min="0" step="0.01" defaultValue={5990} />
              </Field>
              <Field label="Net received">
                <Input name="net" type="number" min="0" step="0.01" defaultValue={5100} />
              </Field>
            </div>

            <DemoBadge />

            <div className="mt-2 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" disabled={status === 'pending'}>
                {status === 'pending' && <Loader2 className="h-4 w-4 animate-spin" />}
                {status === 'pending' ? 'Recording…' : 'Record sale'}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </section>
  );
}
