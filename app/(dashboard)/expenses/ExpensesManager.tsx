'use client';

import { useActionState, useEffect, useState } from 'react';
import { Plus, Pencil, Receipt, FileText } from 'lucide-react';
import { saveExpense, deleteExpense } from './actions';
import { initialFormState } from '@/lib/formState';
import { Button, SubmitButton } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { ConfirmButton } from '@/components/ConfirmButton';
import { FileUpload } from '@/components/FileUpload';
import { ExportButtons } from '@/components/ExportButtons';
import { SearchBar } from '@/components/SearchBar';
import { Pagination } from '@/components/Pagination';
import type { PageMeta } from '@/lib/pagination';
import {
  Card,
  CardBody,
  StatCard,
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
import { formatMoney, formatNumber, formatDate, toDateInput, humanize } from '@/lib/utils';

const CATEGORIES = [
  'PRODUCT_COST',
  'VAT',
  'DARAZ_COMMISSION',
  'OTHER_DARAZ_CHARGES',
  'PACKAGING',
  'FLYERS',
  'TAPE',
  'STICKERS',
  'SCISSORS',
  'STATIONERY',
  'BANK_CHARGES',
  'DELIVERY_TRANSPORT',
  'MISCELLANEOUS',
] as const;

const PAYMENT_METHODS = ['Cash', 'Bank Transfer', 'Card', 'Other'] as const;

interface Opt {
  id: string;
  name: string;
}
interface ExpenseRow {
  id: string;
  date: string;
  category: string;
  storeId: string | null;
  storeName: string | null;
  amount: number;
  paidBy: string | null;
  paymentMethod: string | null;
  receiptUrl: string | null;
  notes: string | null;
}

export function ExpensesManager({
  expenses,
  stores,
  totals,
  meta,
}: {
  expenses: ExpenseRow[];
  stores: Opt[];
  totals: { total: number; month: number; count: number };
  meta: PageMeta;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ExpenseRow | null>(null);
  const [state, formAction] = useActionState(saveExpense, initialFormState);

  useEffect(() => {
    if (state.ok) {
      setOpen(false);
      setEditing(null);
    }
  }, [state.ok, state.ts]);

  function openNew() {
    setEditing(null);
    setOpen(true);
  }
  function openEdit(row: ExpenseRow) {
    setEditing(row);
    setOpen(true);
  }

  const exportRows = expenses.map((e) => ({
    date: formatDate(e.date),
    category: humanize(e.category),
    store: e.storeName ?? '',
    amount: e.amount,
    paidBy: e.paidBy ?? '',
    method: e.paymentMethod ?? '',
  }));

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
            Expenses
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Operating costs, Daraz charges, packaging and stationery.
          </p>
        </div>
        <div className="flex gap-2">
          <ExportButtons
            title="Expense Report"
            filename="expenses"
            columns={[
              { key: 'date', label: 'Date' },
              { key: 'category', label: 'Category' },
              { key: 'store', label: 'Store' },
              { key: 'amount', label: 'Amount', money: true },
              { key: 'paidBy', label: 'Paid By' },
              { key: 'method', label: 'Method' },
            ]}
            rows={exportRows}
          />
          <Button onClick={openNew}>
            <Plus className="h-4 w-4" /> New Expense
          </Button>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Total Expenses" value={formatMoney(totals.total)} tone="negative" />
        <StatCard label="This Month" value={formatMoney(totals.month)} tone="warning" />
        <StatCard label="Records" value={formatNumber(totals.count)} />
      </div>

      <div className="mb-3">
        <SearchBar placeholder="Search notes, paid by, method…" />
      </div>

      {meta.total === 0 ? (
        meta.q ? (
          <EmptyState
            icon={<Receipt className="h-10 w-10" />}
            title="No matching expenses"
            message={`No expenses match “${meta.q}”. Try a different search.`}
          />
        ) : (
          <EmptyState
            icon={<Receipt className="h-10 w-10" />}
            title="No expenses yet"
            message="Record operating costs, Daraz charges, packaging and stationery with receipts."
            action={
              <Button onClick={openNew}>
                <Plus className="h-4 w-4" /> New Expense
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
                  <TH>Category</TH>
                  <TH>Store</TH>
                  <TH align="right">Amount</TH>
                  <TH>Paid By</TH>
                  <TH>Method</TH>
                  <TH align="center">Receipt</TH>
                  <TH align="right">Actions</TH>
                </TRow>
              </THead>
              <tbody>
                {expenses.map((e) => (
                  <TRow key={e.id}>
                    <TD>{formatDate(e.date)}</TD>
                    <TD>
                      <Badge tone="slate">{humanize(e.category)}</Badge>
                    </TD>
                    <TD className="text-slate-500">{e.storeName ?? '—'}</TD>
                    <TD align="right" className="font-medium">
                      {formatMoney(e.amount)}
                    </TD>
                    <TD className="text-slate-500">{e.paidBy ?? '—'}</TD>
                    <TD className="text-slate-500">{e.paymentMethod ?? '—'}</TD>
                    <TD align="center">
                      {e.receiptUrl ? (
                        <a
                          href={e.receiptUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex text-brand-600 hover:text-brand-700"
                        >
                          <FileText className="h-4 w-4" />
                        </a>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </TD>
                    <TD align="right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openEdit(e)}
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                          aria-label="Edit"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <ConfirmButton
                          action={deleteExpense}
                          id={e.id}
                          message="Delete this expense?"
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
        title={editing ? 'Edit Expense' : 'New Expense'}
        description="Record an operating cost or Daraz charge."
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
            <Field label="Expense date" required>
              <Input
                name="date"
                type="date"
                defaultValue={toDateInput(editing?.date ?? new Date())}
                required
              />
            </Field>
            <Field label="Category" required>
              <Select name="category" defaultValue={editing?.category ?? ''} required>
                <option value="">Select category…</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {humanize(c)}
                  </option>
                ))}
              </Select>
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
            <Field label="Amount" required>
              <Input
                name="amount"
                type="number"
                step="0.01"
                min="0"
                defaultValue={editing?.amount ?? ''}
                required
              />
            </Field>
            <Field label="Paid by">
              <Input name="paidBy" defaultValue={editing?.paidBy ?? ''} />
            </Field>
            <Field label="Payment method">
              <Select name="paymentMethod" defaultValue={editing?.paymentMethod ?? ''}>
                <option value="">—</option>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <FileUpload
            name="receiptUrl"
            defaultUrl={editing?.receiptUrl}
            label="Receipt / invoice"
          />

          <Field label="Notes">
            <Textarea name="notes" defaultValue={editing?.notes ?? ''} />
          </Field>

          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <SubmitButton>{editing ? 'Save changes' : 'Record expense'}</SubmitButton>
          </div>
        </form>
      </Modal>
    </>
  );
}
