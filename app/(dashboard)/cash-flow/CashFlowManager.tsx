'use client';

import { useActionState, useEffect, useState } from 'react';
import { Plus, Wallet, PiggyBank } from 'lucide-react';
import {
  saveInvestment,
  deleteInvestment,
  savePayout,
  deletePayout,
} from './actions';
import { initialFormState } from '@/lib/formState';
import { Button, SubmitButton } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { ConfirmButton } from '@/components/ConfirmButton';
import {
  Card,
  CardHeader,
  CardBody,
  Badge,
  EmptyState,
  Field,
  Input,
  Select,
  Textarea,
  Table,
  THead,
  TH,
  TD,
  TRow,
} from '@/components/ui';
import { formatMoney, formatDate, toDateInput } from '@/lib/utils';

interface InvestmentRow {
  id: string;
  date: string;
  amount: number;
  note: string | null;
}

interface PayoutRow {
  id: string;
  date: string;
  party: 'YAHYA' | 'OWNER';
  amount: number;
  note: string | null;
}

export function CashFlowManager({
  investments,
  payouts,
}: {
  investments: InvestmentRow[];
  payouts: PayoutRow[];
}) {
  const [invOpen, setInvOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);

  const [invState, invAction] = useActionState(saveInvestment, initialFormState);
  const [payState, payAction] = useActionState(savePayout, initialFormState);

  useEffect(() => {
    if (invState.ok) setInvOpen(false);
  }, [invState.ok, invState.ts]);

  useEffect(() => {
    if (payState.ok) setPayOpen(false);
  }, [payState.ok, payState.ts]);

  return (
    <>
      <div className="grid gap-3 lg:grid-cols-2">
        {/* Owner Investments */}
        <Card>
          <CardHeader
            title={
              <span className="flex items-center gap-1.5">
                <Wallet className="h-4 w-4 text-brand-500" /> Owner Investments
              </span>
            }
            subtitle="Money the owner put into the business"
            action={
              <Button size="sm" onClick={() => setInvOpen(true)}>
                <Plus className="h-4 w-4" /> Add Investment
              </Button>
            }
          />
          <CardBody className="p-0">
            {investments.length === 0 ? (
              <EmptyState
                title="No investments yet"
                message="Record money the owner puts into the business."
              />
            ) : (
              <Table>
                <THead>
                  <TRow>
                    <TH>Date</TH>
                    <TH align="right">Amount</TH>
                    <TH>Note</TH>
                    <TH align="right">Actions</TH>
                  </TRow>
                </THead>
                <tbody>
                  {investments.map((i) => (
                    <TRow key={i.id}>
                      <TD>{formatDate(i.date)}</TD>
                      <TD align="right" className="font-medium">
                        {formatMoney(i.amount)}
                      </TD>
                      <TD className="max-w-[220px] truncate text-slate-500">
                        {i.note ?? '—'}
                      </TD>
                      <TD align="right">
                        <div className="flex items-center justify-end">
                          <ConfirmButton
                            action={deleteInvestment}
                            id={i.id}
                            message="Delete this investment record?"
                          />
                        </div>
                      </TD>
                    </TRow>
                  ))}
                </tbody>
              </Table>
            )}
          </CardBody>
        </Card>

        {/* Profit Payouts */}
        <Card>
          <CardHeader
            title={
              <span className="flex items-center gap-1.5">
                <PiggyBank className="h-4 w-4 text-brand-500" /> Profit Payouts
              </span>
            }
            subtitle="Profit-share paid out to Yahya or the Owner"
            action={
              <Button size="sm" onClick={() => setPayOpen(true)}>
                <Plus className="h-4 w-4" /> Record Payout
              </Button>
            }
          />
          <CardBody className="p-0">
            {payouts.length === 0 ? (
              <EmptyState
                title="No payouts yet"
                message="Record profit-share money paid out."
              />
            ) : (
              <Table>
                <THead>
                  <TRow>
                    <TH>Date</TH>
                    <TH align="center">Party</TH>
                    <TH align="right">Amount</TH>
                    <TH>Note</TH>
                    <TH align="right">Actions</TH>
                  </TRow>
                </THead>
                <tbody>
                  {payouts.map((p) => (
                    <TRow key={p.id}>
                      <TD>{formatDate(p.date)}</TD>
                      <TD align="center">
                        <Badge tone={p.party === 'YAHYA' ? 'purple' : 'blue'}>
                          {p.party === 'YAHYA' ? 'Yahya' : 'Owner'}
                        </Badge>
                      </TD>
                      <TD align="right" className="font-medium">
                        {formatMoney(p.amount)}
                      </TD>
                      <TD className="max-w-[220px] truncate text-slate-500">
                        {p.note ?? '—'}
                      </TD>
                      <TD align="right">
                        <div className="flex items-center justify-end">
                          <ConfirmButton
                            action={deletePayout}
                            id={p.id}
                            message="Delete this payout record?"
                          />
                        </div>
                      </TD>
                    </TRow>
                  ))}
                </tbody>
              </Table>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Add Investment modal */}
      <Modal
        open={invOpen}
        onClose={() => setInvOpen(false)}
        title="Add Investment"
        description="Money the owner puts into the business."
      >
        <form action={invAction} className="flex flex-col gap-4">
          {invState.error && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {invState.error}
            </p>
          )}

          <Field label="Date" required>
            <Input name="date" type="date" defaultValue={toDateInput(new Date())} required />
          </Field>

          <Field label="Amount" required>
            <Input name="amount" type="number" step="0.01" min="0" required />
          </Field>

          <Field label="Note">
            <Textarea name="note" placeholder="e.g. Initial capital, top-up…" />
          </Field>

          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setInvOpen(false)}>
              Cancel
            </Button>
            <SubmitButton>Add investment</SubmitButton>
          </div>
        </form>
      </Modal>

      {/* Record Payout modal */}
      <Modal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        title="Record Payout"
        description="Profit-share money paid out."
      >
        <form action={payAction} className="flex flex-col gap-4">
          {payState.error && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {payState.error}
            </p>
          )}

          <Field label="Date" required>
            <Input name="date" type="date" defaultValue={toDateInput(new Date())} required />
          </Field>

          <Field label="Party" required>
            <Select name="party" defaultValue="" required>
              <option value="">Select party…</option>
              <option value="YAHYA">Yahya</option>
              <option value="OWNER">Owner</option>
            </Select>
          </Field>

          <Field label="Amount" required>
            <Input name="amount" type="number" step="0.01" min="0" required />
          </Field>

          <Field label="Note">
            <Textarea name="note" placeholder="e.g. Monthly profit share…" />
          </Field>

          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setPayOpen(false)}>
              Cancel
            </Button>
            <SubmitButton>Record payout</SubmitButton>
          </div>
        </form>
      </Modal>
    </>
  );
}
