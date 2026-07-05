'use client';

import { useActionState, useEffect, useState } from 'react';
import { Plus, Pencil, Banknote } from 'lucide-react';
import { saveSettlement, deleteSettlement } from './actions';
import { initialFormState } from '@/lib/formState';
import { Button, SubmitButton } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { ConfirmButton } from '@/components/ConfirmButton';
import { ExportButtons } from '@/components/ExportButtons';
import { SearchBar } from '@/components/SearchBar';
import { Pagination } from '@/components/Pagination';
import type { PageMeta } from '@/lib/pagination';
import {
  Card,
  CardBody,
  StatCard,
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
import { formatMoney, formatNumber, formatDate, toDateInput } from '@/lib/utils';

interface Opt {
  id: string;
  name: string;
}
interface SettlementRow {
  id: string;
  date: string;
  storeId: string | null;
  storeName: string | null;
  grossAmount: number;
  vat: number;
  commission: number;
  otherCharges: number;
  deductions: number;
  netAmount: number;
  bankReference: string | null;
  notes: string | null;
}

export function SettlementsManager({
  settlements,
  stores,
  totals,
  meta,
}: {
  settlements: SettlementRow[];
  stores: Opt[];
  totals: { gross: number; net: number; count: number };
  meta: PageMeta;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SettlementRow | null>(null);
  const [state, formAction] = useActionState(saveSettlement, initialFormState);

  // Live net preview
  const [gross, setGross] = useState(0);
  const [commission, setCommission] = useState(0);
  const [vat, setVat] = useState(0);
  const [other, setOther] = useState(0);
  const [deductions, setDeductions] = useState(0);
  const net = gross - vat - commission - other - deductions;

  useEffect(() => {
    if (state.ok) {
      setOpen(false);
      setEditing(null);
    }
  }, [state.ok, state.ts]);

  function seed(row: SettlementRow | null) {
    setGross(row?.grossAmount ?? 0);
    setCommission(row?.commission ?? 0);
    setVat(row?.vat ?? 0);
    setOther(row?.otherCharges ?? 0);
    setDeductions(row?.deductions ?? 0);
  }
  function openNew() {
    setEditing(null);
    seed(null);
    setOpen(true);
  }
  function openEdit(row: SettlementRow) {
    setEditing(row);
    seed(row);
    setOpen(true);
  }

  const exportRows = settlements.map((s) => ({
    date: formatDate(s.date),
    store: s.storeName ?? '',
    gross: s.grossAmount,
    vat: s.vat,
    commission: s.commission,
    otherCharges: s.otherCharges,
    deductions: s.deductions,
    net: s.netAmount,
    bankRef: s.bankReference ?? '',
  }));

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
            Weekly Settlements
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Weekly Daraz payouts. Net received is gross minus VAT, commission and other deductions.
          </p>
        </div>
        <div className="flex gap-2">
          <ExportButtons
            title="Settlements Report"
            filename="settlements"
            columns={[
              { key: 'date', label: 'Date' },
              { key: 'store', label: 'Store' },
              { key: 'gross', label: 'Gross', money: true },
              { key: 'vat', label: 'VAT', money: true },
              { key: 'commission', label: 'Commission', money: true },
              { key: 'otherCharges', label: 'Other Charges', money: true },
              { key: 'deductions', label: 'Deductions', money: true },
              { key: 'net', label: 'Net', money: true },
              { key: 'bankRef', label: 'Bank Ref' },
            ]}
            rows={exportRows}
          />
          <Button onClick={openNew}>
            <Plus className="h-4 w-4" /> New Settlement
          </Button>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-3">
        <StatCard label="Total Gross" value={formatMoney(totals.gross)} />
        <StatCard label="Net Received" value={formatMoney(totals.net)} tone="positive" />
        <StatCard label="Settlements" value={formatNumber(totals.count)} />
      </div>

      <div className="mb-3">
        <SearchBar placeholder="Search bank ref or notes…" />
      </div>

      {meta.total === 0 ? (
        meta.q ? (
          <EmptyState
            icon={<Banknote className="h-10 w-10" />}
            title="No matching settlements"
            message={`No settlements match “${meta.q}”. Try a different search.`}
          />
        ) : (
          <EmptyState
            icon={<Banknote className="h-10 w-10" />}
            title="No settlements recorded"
            message="Record each weekly Daraz payout here to track net amounts received in your bank."
            action={
              <Button onClick={openNew}>
                <Plus className="h-4 w-4" /> New Settlement
              </Button>
            }
          />
        )
      ) : (
        <Card>
          <CardBody className="p-0">
            <Table>
              <THead>
                <TRow>
                  <TH>Date</TH>
                  <TH>Store</TH>
                  <TH align="right">Gross</TH>
                  <TH align="right">Deductions</TH>
                  <TH align="right">Net</TH>
                  <TH>Bank Ref</TH>
                  <TH align="right">Actions</TH>
                </TRow>
              </THead>
              <tbody>
                {settlements.map((s) => (
                  <TRow key={s.id}>
                    <TD>{formatDate(s.date)}</TD>
                    <TD className="text-slate-500">{s.storeName ?? '—'}</TD>
                    <TD align="right">{formatMoney(s.grossAmount)}</TD>
                    <TD align="right" className="text-rose-500">
                      −{formatMoney(s.vat + s.commission + s.otherCharges + s.deductions)}
                    </TD>
                    <TD align="right" className="font-semibold text-emerald-600">
                      {formatMoney(s.netAmount)}
                    </TD>
                    <TD className="text-slate-500">{s.bankReference ?? '—'}</TD>
                    <TD align="right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openEdit(s)}
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                          aria-label="Edit"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <ConfirmButton
                          action={deleteSettlement}
                          id={s.id}
                          message="Delete this settlement?"
                        />
                      </div>
                    </TD>
                  </TRow>
                ))}
              </tbody>
            </Table>
          </CardBody>
          <Pagination page={meta.page} pageSize={meta.pageSize} total={meta.total} />
        </Card>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Edit Settlement' : 'New Settlement'}
        description="Net amount received is calculated from gross minus deductions."
        size="lg"
      >
        <form action={formAction} className="flex flex-col gap-4">
          {editing && <input type="hidden" name="id" value={editing.id} />}
          {state.error && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {state.error}
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Date" required>
              <Input
                name="date"
                type="date"
                defaultValue={toDateInput(editing?.date ?? new Date())}
                required
              />
            </Field>
            <Field label="Store (optional)">
              <Select name="storeId" defaultValue={editing?.storeId ?? ''}>
                <option value="">—</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Gross settlement amount" required>
              <Input
                name="grossAmount"
                type="number"
                step="0.01"
                min="0"
                defaultValue={editing?.grossAmount ?? ''}
                onChange={(e) => setGross(Number(e.target.value) || 0)}
                required
              />
            </Field>
            <Field label="Daraz commission">
              <Input
                name="commission"
                type="number"
                step="0.01"
                min="0"
                defaultValue={editing?.commission ?? 0}
                onChange={(e) => setCommission(Number(e.target.value) || 0)}
              />
            </Field>
            <Field label="VAT">
              <Input
                name="vat"
                type="number"
                step="0.01"
                min="0"
                defaultValue={editing?.vat ?? 0}
                onChange={(e) => setVat(Number(e.target.value) || 0)}
              />
            </Field>
            <Field label="Other charges">
              <Input
                name="otherCharges"
                type="number"
                step="0.01"
                min="0"
                defaultValue={editing?.otherCharges ?? 0}
                onChange={(e) => setOther(Number(e.target.value) || 0)}
              />
            </Field>
            <Field label="Other deductions">
              <Input
                name="deductions"
                type="number"
                step="0.01"
                min="0"
                defaultValue={editing?.deductions ?? 0}
                onChange={(e) => setDeductions(Number(e.target.value) || 0)}
              />
            </Field>
            <Field label="Bank reference">
              <Input
                name="bankReference"
                type="text"
                defaultValue={editing?.bankReference ?? ''}
              />
            </Field>
          </div>

          <div className="flex items-center justify-between rounded-lg bg-emerald-50 px-4 py-3">
            <span className="text-sm font-medium text-emerald-800">
              Net amount received
            </span>
            <span className="text-lg font-bold text-emerald-700">
              {formatMoney(net)}
            </span>
          </div>

          <Field label="Notes">
            <Textarea name="notes" defaultValue={editing?.notes ?? ''} />
          </Field>

          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <SubmitButton>{editing ? 'Save changes' : 'Record settlement'}</SubmitButton>
          </div>
        </form>
      </Modal>
    </>
  );
}
