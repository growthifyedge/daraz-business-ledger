'use client';

import { useActionState, useEffect, useState, type ReactNode } from 'react';
import { Banknote, X, Trash2, Plus } from 'lucide-react';
import { Button } from '@/components/Button';
import { ConfirmButton } from '@/components/ConfirmButton';
import { Card, CardBody, Field, Input, Textarea, Table, THead, TH, TD, TRow } from '@/components/ui';
import { formatMoney, formatDate } from '@/lib/utils';
import { initialFormState } from '@/lib/formState';
import { recordYahyaPayment, voidYahyaPayment } from './paymentActions';

export interface PaymentRecord {
  id: string;
  date: string;
  amount: number;
  bankAccount: string | null;
  bankReference: string | null;
  notes: string | null;
  voided: boolean;
}

/** Which payment dialog is open. `null` = closed. */
export type PaymentView = 'record' | 'history' | null;

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// The confirmation shown before a payment is removed. Uses the owner-facing word
// "Remove" (never "Void"). Removing takes it out of Paid to Yahya and FIFO
// settlement; Yahya Debt rises again. The record is kept only in the AuditLog.
const REMOVE_MESSAGE =
  'Remove this mistaken payment? It will be removed from Paid to Yahya and Yahya Debt will increase again.';

function Overlay({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-6">
      <div className="w-full max-w-3xl">
        <Card>
          <CardBody>{children}</CardBody>
        </Card>
      </div>
    </div>
  );
}

/**
 * Yahya payment dialogs — fully controlled by the parent via `view`.
 *  - 'record'  → "Record New Payment" only (opened by the top Payments button).
 *  - 'history' → "Payment History — Yahya": active payments + Remove, plus a
 *    "Record New Payment" shortcut (opened by clicking the Paid to Yahya card).
 * FIFO allocation stays internal — no purchase-allocation detail is shown.
 */
export function YahyaPayments({
  view,
  onChangeView,
  payableTotal,
  payments,
}: {
  view: PaymentView;
  onChangeView: (v: PaymentView) => void;
  payableTotal: number;
  payments: PaymentRecord[];
}) {
  const [amount, setAmount] = useState('');
  const [state, action, isPending] = useActionState(recordYahyaPayment, initialFormState);

  useEffect(() => {
    if (state.ok) setAmount('');
  }, [state.ok, state.ts]);

  const amountNum = r2(Number(amount));
  const overPayable = amountNum > r2(payableTotal);
  const valid = amountNum > 0 && !overPayable;

  const close = () => onChangeView(null);

  if (view === 'record') {
    return (
      <Overlay>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Record New Payment</h2>
            <p className="mt-1 text-sm text-slate-500">
              Enter one bank transfer to Yahya. It is applied automatically to the oldest
              outstanding purchases first — no purchase selection.
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

        <div className="mb-4 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
          Payable to Yahya: <strong>{formatMoney(payableTotal)}</strong> — a payment cannot exceed
          this.
        </div>

        <form action={action} className="rounded-lg border border-slate-200 p-4">
          {state.error && (
            <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{state.error}</p>
          )}
          {state.ok && state.message && (
            <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {state.message}
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Payment date" required>
              <Input type="date" name="date" required />
            </Field>
            <Field label="Amount (Rs)" required>
              <Input
                type="number"
                name="amount"
                step="0.01"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
            </Field>
            <Field label="Bank account">
              <Input name="bankAccount" placeholder="e.g. HBL ****1234" />
            </Field>
            <Field label="Bank reference">
              <Input name="bankReference" placeholder="Txn / slip no." />
            </Field>
          </div>
          <Field label="Notes">
            <Textarea name="notes" rows={2} />
          </Field>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-slate-500">
              {overPayable ? (
                <span className="text-rose-600">Amount exceeds the total payable.</span>
              ) : (
                'Applied automatically to the oldest outstanding purchases.'
              )}
            </span>
            {/* Disable immediately on submit to prevent a duplicate payment;
                re-enabled automatically when the request settles. */}
            <Button type="submit" disabled={!valid || isPending}>
              <Banknote className="h-4 w-4" />{' '}
              {isPending ? 'Recording payment…' : 'Record payment'}
            </Button>
          </div>
        </form>
      </Overlay>
    );
  }

  if (view === 'history') {
    return (
      <Overlay>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Payment History — Yahya</h2>
            <p className="mt-1 text-sm text-slate-500">
              Active payments counted in Paid to Yahya. Removing one raises Yahya Debt again.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => onChangeView('record')}>
              <Plus className="h-4 w-4" /> Record New Payment
            </Button>
            <button
              onClick={close}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {payments.length === 0 ? (
          <p className="text-sm text-slate-500">No payments recorded yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <Table>
              <THead>
                <TRow>
                  <TH>Date</TH>
                  <TH align="right">Amount</TH>
                  <TH>Bank Account</TH>
                  <TH>Bank Reference</TH>
                  <TH>Notes</TH>
                  <TH align="right">Remove</TH>
                </TRow>
              </THead>
              <tbody>
                {payments.map((pay) => (
                  <TRow key={pay.id}>
                    <TD>{formatDate(pay.date)}</TD>
                    <TD align="right" className="font-medium">
                      {formatMoney(pay.amount)}
                    </TD>
                    <TD className="text-slate-500">{pay.bankAccount || '—'}</TD>
                    <TD className="text-xs text-slate-500">{pay.bankReference || '—'}</TD>
                    <TD className="max-w-[220px] truncate text-xs text-slate-500">
                      {pay.notes || '—'}
                    </TD>
                    <TD align="right">
                      <ConfirmButton
                        action={voidYahyaPayment}
                        id={pay.id}
                        icon={false}
                        message={REMOVE_MESSAGE}
                        label={
                          <>
                            <Trash2 className="h-4 w-4" /> Remove
                          </>
                        }
                        className="h-8 px-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                      />
                    </TD>
                  </TRow>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Overlay>
    );
  }

  return null;
}
