'use client';

import { useActionState, useEffect, useState } from 'react';
import { Banknote, X, Ban } from 'lucide-react';
import { Button } from '@/components/Button';
import { ConfirmButton } from '@/components/ConfirmButton';
import { Card, CardBody, Badge, Field, Input, Textarea, Table, THead, TH, TD, TRow } from '@/components/ui';
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

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function YahyaPayments({
  payableTotal,
  payments,
}: {
  payableTotal: number;
  payments: PaymentRecord[];
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [state, action, isPending] = useActionState(recordYahyaPayment, initialFormState);

  useEffect(() => {
    if (state.ok) setAmount('');
  }, [state.ok, state.ts]);

  const amountNum = r2(Number(amount));
  const overPayable = amountNum > r2(payableTotal);
  const valid = amountNum > 0 && !overPayable;

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Banknote className="h-4 w-4" /> Payments
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-6">
          <div className="w-full max-w-3xl">
            <Card>
              <CardBody>
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">Record payment to Yahya</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      Enter one bank transfer. The amount is applied automatically to the oldest
                      unpaid purchases first — no purchase selection.
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

                <div className="mb-4 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  Payable to Yahya: <strong>{formatMoney(payableTotal)}</strong> — a payment cannot
                  exceed this.
                </div>

                <form action={action} className="mb-6 rounded-lg border border-slate-200 p-4">
                  {state.error && (
                    <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{state.error}</p>
                  )}
                  {state.ok && state.message && (
                    <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{state.message}</p>
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
                        'Auto-allocated FIFO to the oldest unpaid / partially-paid purchases.'
                      )}
                    </span>
                    {/* Disable immediately on submit to prevent a duplicate
                        payment; re-enabled automatically when the request
                        succeeds or fails (isPending flips back to false). */}
                    <Button type="submit" disabled={!valid || isPending}>
                      <Banknote className="h-4 w-4" />{' '}
                      {isPending ? 'Recording payment…' : 'Record payment'}
                    </Button>
                  </div>
                </form>

                <h3 className="mb-2 text-sm font-semibold text-slate-700">Recent payments</h3>
                {payments.length === 0 ? (
                  <p className="text-sm text-slate-500">No payments recorded yet.</p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-slate-200">
                    <Table>
                      <THead>
                        <TRow>
                          <TH>Date</TH>
                          <TH align="right">Amount</TH>
                          <TH>Reference</TH>
                          <TH align="center">Status</TH>
                          <TH align="right">Action</TH>
                        </TRow>
                      </THead>
                      <tbody>
                        {payments.map((pay) => (
                          <TRow key={pay.id}>
                            <TD>{formatDate(pay.date)}</TD>
                            <TD align="right" className="font-medium">{formatMoney(pay.amount)}</TD>
                            <TD className="text-xs text-slate-500">{pay.bankReference || '—'}</TD>
                            <TD align="center">
                              {pay.voided ? <Badge tone="slate">Voided</Badge> : <Badge tone="green">Active</Badge>}
                            </TD>
                            <TD align="right">
                              {pay.voided ? (
                                <span className="text-xs text-slate-300">—</span>
                              ) : (
                                <ConfirmButton
                                  action={voidYahyaPayment}
                                  id={pay.id}
                                  icon={false}
                                  message="Void this payment? Its allocations stop counting and the affected purchases revert toward unpaid."
                                  label={
                                    <>
                                      <Ban className="h-4 w-4" /> Void
                                    </>
                                  }
                                  className="h-8 px-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                                />
                              )}
                            </TD>
                          </TRow>
                        ))}
                      </tbody>
                    </Table>
                  </div>
                )}
              </CardBody>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
