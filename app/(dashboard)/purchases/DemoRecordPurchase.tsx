'use client';

import { useState } from 'react';
import { Plus, Loader2 } from 'lucide-react';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { Field, Input } from '@/components/ui';
import { useDemoSimulation } from '@/lib/presentation/demo/useDemoSimulation';
import { DemoActionResult } from '@/components/demo/DemoActionResult';
import { DemoBadge } from '@/components/demo/DemoBadge';
import { DEMO_PURCHASE_PLACEHOLDER } from '@/lib/presentation/demo/samples';

/**
 * Demo-only "Record Purchase" control shown inside active Presentation Safe View.
 * It opens a fully functional-looking form pre-filled with anonymised
 * placeholders (money stays masked) and, on submit, plays a short simulated save
 * that lands on a polished success state. It never imports or calls the real
 * purchase server action, and it writes nothing — the real purchase path stays
 * blocked by the server guard regardless.
 */
export function DemoRecordPurchase() {
  const [open, setOpen] = useState(false);
  const { status, run, reset } = useDemoSimulation();
  const p = DEMO_PURCHASE_PLACEHOLDER;

  function openForm() {
    reset();
    setOpen(true);
  }
  function close() {
    setOpen(false);
    reset();
  }

  return (
    <>
      <Button onClick={openForm}>
        <Plus className="h-4 w-4" /> Record Purchase
      </Button>

      <Modal
        open={open}
        onClose={close}
        title="Record Purchase"
        description="Demonstration form — no live records are created."
        size="lg"
      >
        {status === 'success' ? (
          <div className="flex flex-col gap-4">
            <DemoActionResult
              title="Demo purchase recorded successfully"
              subtitle="This is exactly how a real purchase would be saved in normal mode."
            />
            <div className="flex justify-end">
              <Button onClick={close}>Done</Button>
            </div>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run();
            }}
            className="flex flex-col gap-4"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Product">
                <Input defaultValue={p.product} readOnly />
              </Field>
              <Field label="Store">
                <Input defaultValue={p.store} readOnly />
              </Field>
              <Field label="Supplier">
                <Input defaultValue={p.supplier} readOnly />
              </Field>
              <Field label="Quantity">
                <Input defaultValue={p.quantity} readOnly />
              </Field>
              <Field label="Unit cost">
                <Input defaultValue={p.unitCost} readOnly />
              </Field>
              <Field label="Total">
                <Input defaultValue={p.total} readOnly />
              </Field>
            </div>

            <DemoBadge />

            <div className="mt-2 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" disabled={status === 'pending'}>
                {status === 'pending' && <Loader2 className="h-4 w-4 animate-spin" />}
                {status === 'pending' ? 'Recording…' : 'Record purchase'}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
