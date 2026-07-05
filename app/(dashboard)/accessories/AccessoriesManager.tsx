'use client';

import { useActionState, useEffect, useState } from 'react';
import { Plus, Pencil, Boxes, FileText } from 'lucide-react';
import { saveAccessory, deleteAccessory } from './actions';
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
  Textarea,
  Table,
  THead,
  TH,
  TD,
  TRow,
} from '@/components/ui';
import { formatMoney, formatNumber, formatDate, toDateInput } from '@/lib/utils';

interface AccessoryRow {
  id: string;
  name: string;
  quantityPurchased: number;
  quantityUsed: number;
  unitCost: number;
  totalCost: number;
  purchaseDate: string | null;
  receiptUrl: string | null;
  notes: string | null;
}

export function AccessoriesManager({
  accessories,
  totals,
  meta,
}: {
  accessories: AccessoryRow[];
  totals: { totalCost: number; consumedCost: number; count: number };
  meta: PageMeta;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AccessoryRow | null>(null);
  const [state, formAction] = useActionState(saveAccessory, initialFormState);

  // Live computed total cost preview
  const [quantity, setQuantity] = useState(0);
  const [unitCost, setUnitCost] = useState(0);
  const total = quantity * unitCost;

  useEffect(() => {
    if (state.ok) {
      setOpen(false);
      setEditing(null);
    }
  }, [state.ok, state.ts]);

  function seed(row: AccessoryRow | null) {
    setQuantity(row?.quantityPurchased ?? 0);
    setUnitCost(row?.unitCost ?? 0);
  }
  function openNew() {
    setEditing(null);
    seed(null);
    setOpen(true);
  }
  function openEdit(row: AccessoryRow) {
    setEditing(row);
    seed(row);
    setOpen(true);
  }

  const exportRows = accessories.map((a) => ({
    name: a.name,
    purchased: a.quantityPurchased,
    used: a.quantityUsed,
    current: a.quantityPurchased - a.quantityUsed,
    unitCost: a.unitCost,
    totalCost: a.totalCost,
    purchaseDate: formatDate(a.purchaseDate),
  }));

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
            Accessories &amp; Stationery
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Packing material inventory — boxes, tape, flyers and stationery. Usage
            cost is included in Profit &amp; Loss.
          </p>
        </div>
        <div className="flex gap-2">
          <ExportButtons
            title="Accessories & Stationery"
            filename="accessories"
            columns={[
              { key: 'name', label: 'Item' },
              { key: 'purchased', label: 'Purchased' },
              { key: 'used', label: 'Used' },
              { key: 'current', label: 'Current' },
              { key: 'unitCost', label: 'Unit Cost', money: true },
              { key: 'totalCost', label: 'Total Cost', money: true },
              { key: 'purchaseDate', label: 'Purchase Date' },
            ]}
            rows={exportRows}
          />
          <Button onClick={openNew}>
            <Plus className="h-4 w-4" /> New Item
          </Button>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Total Cost" value={formatMoney(totals.totalCost)} />
        <StatCard
          label="Consumed Cost"
          value={formatMoney(totals.consumedCost)}
          tone="warning"
        />
        <StatCard label="Items" value={formatNumber(totals.count)} />
      </div>

      <div className="mb-3">
        <SearchBar placeholder="Search item or notes…" />
      </div>

      {meta.total === 0 ? (
        meta.q ? (
          <EmptyState
            icon={<Boxes className="h-10 w-10" />}
            title="No matching items"
            message={`No items match “${meta.q}”. Try a different search.`}
          />
        ) : (
          <EmptyState
            icon={<Boxes className="h-10 w-10" />}
            title="No accessories yet"
            message="Track packing material and stationery you buy — boxes, tape, flyers, labels. The cost of what you use is counted in Profit & Loss."
            action={
              <Button onClick={openNew}>
                <Plus className="h-4 w-4" /> New Item
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
                  <TH>Item</TH>
                  <TH align="right">Purchased</TH>
                  <TH align="right">Used</TH>
                  <TH align="right">Current</TH>
                  <TH align="right">Unit Cost</TH>
                  <TH align="right">Total Cost</TH>
                  <TH>Purchase Date</TH>
                  <TH align="center">Receipt</TH>
                  <TH align="right">Actions</TH>
                </TRow>
              </THead>
              <tbody>
                {accessories.map((a) => {
                  const current = a.quantityPurchased - a.quantityUsed;
                  return (
                    <TRow key={a.id}>
                      <TD className="font-medium text-slate-800">
                        {a.name}
                        {a.notes && (
                          <div className="max-w-xs truncate text-xs text-slate-400">
                            {a.notes}
                          </div>
                        )}
                      </TD>
                      <TD align="right">{formatNumber(a.quantityPurchased)}</TD>
                      <TD align="right">{formatNumber(a.quantityUsed)}</TD>
                      <TD align="right">
                        {current <= 0 ? (
                          <Badge tone="red">{formatNumber(current)}</Badge>
                        ) : (
                          <span className="font-medium text-slate-800">
                            {formatNumber(current)}
                          </span>
                        )}
                      </TD>
                      <TD align="right">{formatMoney(a.unitCost)}</TD>
                      <TD align="right" className="font-medium">
                        {formatMoney(a.totalCost)}
                      </TD>
                      <TD>{formatDate(a.purchaseDate)}</TD>
                      <TD align="center">
                        {a.receiptUrl ? (
                          <a
                            href={a.receiptUrl}
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
                            onClick={() => openEdit(a)}
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                            aria-label="Edit"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <ConfirmButton
                            action={deleteAccessory}
                            id={a.id}
                            message={`Delete "${a.name}"? It will be hidden but its history is kept.`}
                          />
                        </div>
                      </TD>
                    </TRow>
                  );
                })}
              </tbody>
            </Table>
          </CardBody>
          <Pagination page={meta.page} pageSize={meta.pageSize} total={meta.total} />
        </Card>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Edit Item' : 'New Item'}
        description="Packing material & stationery. Used quantity cost flows into Profit & Loss."
        size="lg"
      >
        <form action={formAction} className="flex flex-col gap-4">
          {editing && <input type="hidden" name="id" value={editing.id} />}
          {state.error && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {state.error}
            </p>
          )}

          <Field label="Item name" htmlFor="name" required>
            <Input
              id="name"
              name="name"
              defaultValue={editing?.name ?? ''}
              placeholder="e.g. Courier boxes (medium)"
              required
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Quantity purchased" required>
              <Input
                name="quantityPurchased"
                type="number"
                min="0"
                defaultValue={editing?.quantityPurchased ?? ''}
                onChange={(e) => setQuantity(Number(e.target.value) || 0)}
                required
              />
            </Field>
            <Field label="Quantity used">
              <Input
                name="quantityUsed"
                type="number"
                min="0"
                defaultValue={editing?.quantityUsed ?? 0}
              />
            </Field>
            <Field label="Unit cost" required>
              <Input
                name="unitCost"
                type="number"
                step="0.01"
                min="0"
                defaultValue={editing?.unitCost ?? ''}
                onChange={(e) => setUnitCost(Number(e.target.value) || 0)}
                required
              />
            </Field>
            <Field label="Purchase date">
              <Input
                name="purchaseDate"
                type="date"
                defaultValue={toDateInput(editing?.purchaseDate ?? new Date())}
              />
            </Field>
          </div>

          <div className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-3">
            <span className="text-sm font-medium text-slate-700">Total cost</span>
            <span className="text-lg font-bold text-slate-900">
              {formatMoney(total)}
            </span>
          </div>

          <FileUpload
            name="receiptUrl"
            defaultUrl={editing?.receiptUrl}
            label="Receipt / bill (image or PDF)"
          />

          <Field label="Notes">
            <Textarea name="notes" defaultValue={editing?.notes ?? ''} />
          </Field>

          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <SubmitButton>{editing ? 'Save changes' : 'Add item'}</SubmitButton>
          </div>
        </form>
      </Modal>
    </>
  );
}
