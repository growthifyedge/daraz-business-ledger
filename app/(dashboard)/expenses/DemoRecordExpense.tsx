'use client';

import { useRef, useState } from 'react';
import { Plus, Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { Card, CardBody, Field, Input, Select, Textarea, Table, THead, TH, TD, TRow } from '@/components/ui';
import { useDemoSimulation } from '@/lib/presentation/demo/useDemoSimulation';
import { useDemoCollection } from '@/lib/presentation/demo/useDemoCollection';
import { DemoActionResult } from '@/components/demo/DemoActionResult';
import { DemoBadge } from '@/components/demo/DemoBadge';
import {
  toExpensesPresentationRows,
  type ExpensesPresentationRow,
} from '@/lib/presentation/viewmodels/expenses';
import type { PresentationProfile } from '@/lib/presentation/core';

const CATEGORIES = ['PACKAGING', 'DELIVERY_TRANSPORT', 'STATIONERY', 'BANK_CHARGES', 'MISCELLANEOUS'];
const METHODS = ['Cash', 'Bank Transfer', 'Card'];

/**
 * Demo-only "Record Expense" workflow shown inside active Presentation Safe View.
 * On submit it redacts the entered values through the SAME expenses view-model as
 * the real redacted table (money → profile status/band, payer → anonymous label)
 * and appends the row to an in-memory list. The description / payment-method /
 * payer inputs are never carried into the output. No real expense is created and
 * no expense action is called.
 */
export function DemoRecordExpense({ profile }: { profile: PresentationProfile | null }) {
  const [open, setOpen] = useState(false);
  const { status, run, reset: resetSim } = useDemoSimulation();
  const added = useDemoCollection<ExpensesPresentationRow>();
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
    // The payer, description and payment method are intentionally NOT passed into
    // the source row, so the redacted output can never carry them.
    const [row] = toExpensesPresentationRows(
      [
        {
          id: `demo-expense-new-${n}`,
          date: String(f.get('date') || '2026-01-25'),
          category: String(f.get('category') || CATEGORIES[0]),
          storeName: 'Ashu Traderz',
          amount: Number(f.get('amount') || 0),
        },
      ],
      ctx
    );
    added.add(row);
    run();
  }

  return (
    <section aria-labelledby="demo-expenses-heading" className="mt-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 id="demo-expenses-heading" className="text-sm font-semibold text-slate-800">
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
            <Plus className="h-4 w-4" /> Record Expense
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
                  <TH>Category</TH>
                  <TH>Paid By</TH>
                  <TH align="right">Amount</TH>
                </TRow>
              </THead>
              <tbody>
                {added.items.map((e) => (
                  <TRow key={e.id}>
                    <TD>{e.date}</TD>
                    <TD>{e.category}</TD>
                    <TD className="text-slate-500">{e.payer}</TD>
                    <TD align="right" className="font-medium">{e.amount}</TD>
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
        title="Record Expense"
        description="Demonstration form — no live records are created."
        size="lg"
      >
        {status === 'success' ? (
          <div className="flex flex-col gap-4">
            <DemoActionResult
              title="Demo expense recorded successfully"
              subtitle="Amount is shown by the active profile — no exact figure is revealed."
            />
            <div className="flex justify-end">
              <Button onClick={close}>Done</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Category" required>
                <Select name="category" defaultValue={CATEGORIES[0]}>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Date" required>
                <Input name="date" type="date" defaultValue="2026-01-25" />
              </Field>
              <Field label="Payment method">
                <Select name="method" defaultValue={METHODS[0]}>
                  {METHODS.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Amount">
                <Input name="amount" type="number" min="0" step="0.01" defaultValue={1250} />
              </Field>
            </div>
            <Field label="Description">
              <Textarea name="description" placeholder="Demo note (not stored)" />
            </Field>

            <DemoBadge />

            <div className="mt-2 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" disabled={status === 'pending'}>
                {status === 'pending' && <Loader2 className="h-4 w-4 animate-spin" />}
                {status === 'pending' ? 'Recording…' : 'Record expense'}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </section>
  );
}
