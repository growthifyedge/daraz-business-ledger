'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import { Banknote, X, Plus, Trash2, Ban } from 'lucide-react';
import { Button } from '@/components/Button';
import { ConfirmButton } from '@/components/ConfirmButton';
import { Card, CardBody, Badge, Field, Input, Select, Textarea, Table, THead, TH, TD, TRow } from '@/components/ui';
import { formatMoney, formatDate } from '@/lib/utils';
import { initialFormState } from '@/lib/formState';
import { recordYahyaPayment, voidYahyaPayment } from './paymentActions';

export interface PayablePurchase {
  id: string;
  label: string;
  remaining: number;
}
export interface PaymentRecord {
  id: string;
  date: string;
  amount: number;
  bankAccount: string | null;
  bankReference: string | null;
  notes: string | null;
  voided: boolean;
  allocations: { productName: string; amount: number }[];
}

interface AllocRow {
  purchaseId: string;
  amount: string;
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function YahyaPayments({
  payablePurchases,
  payments,
}: {
  payablePurchases: PayablePurchase[];
  payments: PaymentRecord[];
}) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState('');
  const [amount, setAmount] = useState('');
  const [rows, setRows] = useState<AllocRow[]>([{ purchaseId: '', amount: '' }]);
  const [state, action] = useActionState(recordYahyaPayment, initialFormState);

  const remainingById = useMemo(
    () => new Map(payablePurchases.map((p) => [p.id, p.remaining])),
    [payablePurchases]
  );

  useEffect(() => {
    if (state.ok) {
      setDate('');
      setAmount('');
      setRows([{ purchaseId: '', amount: '' }]);
    }
  }, [state.ok, state.ts]);

  const clean = rows
    .filter((r) => r.purchaseId && Number(r.amount) > 0)
    .map((r) => ({ purchaseId: r.purchaseId, amount: r2(Number(r.amount)) }));
  const allocTotal = r2(clean.reduce((s, r) => s + r.amount, 0));
  const amountNum = r2(Number(amount));
  const dupIds = new Set(clean.map((r) => r.purchaseId)).size !== clean.length;
  const overCap = clean.some((r) => r.amount > r2(remainingById.get(r.purchaseId) ?? 0));
  const valid =
    !!date && amountNum > 0 && clean.length > 0 && !dupIds && !overCap && allocTotal === amountNum;

  function setRow(i: number, patch: Partial<AllocRow>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Banknote className="h-4 w-4" /> Payments
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-6">
          <div className="w-full max-w-4xl">
            <Card>
              <CardBody>
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">Yahya payments</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      One bank transfer, allocated across one or more purchases. The payment amount
                      must equal the allocation total exactly.
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

                {/* --- record a payment --- */}
                <form action={action} className="mb-6 rounded-lg border border-slate-200 p-4">
                  {state.error && (
                    <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{state.error}</p>
                  )}
                  <div className="grid gap-3 sm:grid-cols-4">
                    <Field label="Payment date" required>
                      <Input type="date" name="date" value={date} onChange={(e) => setDate(e.target.value)} required />
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

                  <div className="mt-3">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-sm font-medium text-slate-700">Allocations</span>
                      <button
                        type="button"
                        onClick={() => setRows((p) => [...p, { purchaseId: '', amount: '' }])}
                        className="inline-flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700"
                      >
                        <Plus className="h-3.5 w-3.5" /> Add row
                      </button>
                    </div>
                    {payablePurchases.length === 0 ? (
                      <p className="text-sm text-slate-500">No payable purchases. Nothing is owed to Yahya.</p>
                    ) : (
                      <div className="space-y-2">
                        {rows.map((row, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <Select
                              value={row.purchaseId}
                              onChange={(e) => setRow(i, { purchaseId: e.target.value })}
                              className="flex-1"
                            >
                              <option value="">— choose purchase —</option>
                              {payablePurchases.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.label} · bal {formatMoney(p.remaining)}
                                </option>
                              ))}
                            </Select>
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              placeholder="amount"
                              value={row.amount}
                              onChange={(e) => setRow(i, { amount: e.target.value })}
                              className="w-32"
                            />
                            <button
                              type="button"
                              onClick={() => setRows((p) => p.filter((_, idx) => idx !== i))}
                              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-rose-600"
                              aria-label="Remove row"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <input type="hidden" name="allocations" value={JSON.stringify(clean)} />

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span
                        className={
                          allocTotal === amountNum && amountNum > 0 ? 'text-emerald-600' : 'text-slate-500'
                        }
                      >
                        Allocated {formatMoney(allocTotal)} / {formatMoney(amountNum || 0)}
                        {overCap && <span className="ml-2 text-rose-600">— an allocation exceeds its balance</span>}
                        {dupIds && <span className="ml-2 text-rose-600">— duplicate purchase</span>}
                      </span>
                      <Button type="submit" disabled={!valid}>
                        <Banknote className="h-4 w-4" /> Record payment
                      </Button>
                    </div>
                  </div>
                </form>

                {/* --- recent payments --- */}
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
                          <TH>Allocated to</TH>
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
                            <TD className="max-w-[260px] text-xs text-slate-500">
                              {pay.allocations.map((a) => `${a.productName} (${formatMoney(a.amount)})`).join(', ')}
                            </TD>
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
