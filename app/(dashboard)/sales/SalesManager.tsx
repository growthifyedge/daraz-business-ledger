'use client';

import { useActionState, useEffect, useState } from 'react';
import { Plus, Pencil, TrendingUp } from 'lucide-react';
import { saveSale, deleteSale } from './actions';
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
interface ProductOpt extends Opt {
  purchaseCost: number;
}
interface SaleRow {
  id: string;
  date: string;
  storeId: string | null;
  storeName: string | null;
  productId: string;
  productName: string;
  quantitySold: number;
  unitCost: number | null;
  grossAmount: number;
  commission: number;
  vat: number;
  otherCharges: number;
  returnsRefunds: number;
  netAmount: number;
  notes: string | null;
}

export function SalesManager({
  sales,
  products,
  stores,
  totals,
  meta,
}: {
  sales: SaleRow[];
  products: ProductOpt[];
  stores: Opt[];
  totals: { gross: number; net: number; units: number };
  meta: PageMeta;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SaleRow | null>(null);
  const [state, formAction] = useActionState(saveSale, initialFormState);

  // Live net preview
  const [gross, setGross] = useState(0);
  const [commission, setCommission] = useState(0);
  const [vat, setVat] = useState(0);
  const [other, setOther] = useState(0);
  const [returns, setReturns] = useState(0);
  const net = gross - commission - vat - other - returns;

  // Cost snapshot. `unitCostOriginal` records what was loaded so the server can
  // tell whether the operator changed it (preserve-unless-changed).
  const [productId, setProductId] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [unitCostOriginal, setUnitCostOriginal] = useState('');

  function onProductChange(id: string) {
    setProductId(id);
    // Suggest the newly-selected product's current purchase cost.
    const p = products.find((x) => x.id === id);
    if (p) setUnitCost(String(p.purchaseCost));
  }

  useEffect(() => {
    if (state.ok) {
      setOpen(false);
      setEditing(null);
    }
  }, [state.ok, state.ts]);

  function seed(row: SaleRow | null) {
    setGross(row?.grossAmount ?? 0);
    setCommission(row?.commission ?? 0);
    setVat(row?.vat ?? 0);
    setOther(row?.otherCharges ?? 0);
    setReturns(row?.returnsRefunds ?? 0);
    setProductId(row?.productId ?? '');
    // Editing: show the stored snapshot (blank for legacy null, so an untouched
    // save preserves the null). New: blank until a product is chosen.
    const loaded = row && row.unitCost !== null ? String(row.unitCost) : '';
    setUnitCost(loaded);
    setUnitCostOriginal(loaded);
  }
  function openNew() {
    setEditing(null);
    seed(null);
    setOpen(true);
  }
  function openEdit(row: SaleRow) {
    setEditing(row);
    seed(row);
    setOpen(true);
  }

  const exportRows = sales.map((s) => ({
    date: formatDate(s.date),
    product: s.productName,
    store: s.storeName ?? '',
    qty: s.quantitySold,
    gross: s.grossAmount,
    commission: s.commission,
    vat: s.vat,
    other: s.otherCharges,
    returns: s.returnsRefunds,
    net: s.netAmount,
  }));

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
            Manual Sales
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Optional manual sales, separate from imported Daraz income. Stock reduces automatically.
            Imported Daraz sales are not shown here — see the Business Profit &amp; Loss statement.
          </p>
        </div>
        <div className="flex gap-2">
          <ExportButtons
            title="Sales Report"
            filename="sales"
            columns={[
              { key: 'date', label: 'Date' },
              { key: 'product', label: 'Product' },
              { key: 'store', label: 'Store' },
              { key: 'qty', label: 'Qty' },
              { key: 'gross', label: 'Gross', money: true },
              { key: 'commission', label: 'Commission', money: true },
              { key: 'vat', label: 'VAT', money: true },
              { key: 'other', label: 'Other', money: true },
              { key: 'returns', label: 'Returns (legacy)', money: true },
              { key: 'net', label: 'Net', money: true },
            ]}
            rows={exportRows}
          />
          <Button onClick={openNew}>
            <Plus className="h-4 w-4" /> New Sale
          </Button>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-3">
        <StatCard label="Gross Sales" value={formatMoney(totals.gross)} tone="positive" />
        <StatCard label="Net Received" value={formatMoney(totals.net)} />
        <StatCard label="Units Sold" value={formatNumber(totals.units)} />
      </div>

      <div className="mb-3">
        <SearchBar placeholder="Search product or notes…" />
      </div>

      {meta.total === 0 ? (
        meta.q ? (
          <EmptyState
            icon={<TrendingUp className="h-10 w-10" />}
            title="No matching sales"
            message={`No sales match “${meta.q}”. Try a different search.`}
          />
        ) : (
          <EmptyState
            icon={<TrendingUp className="h-10 w-10" />}
            title="No sales recorded"
            message="Enter Daraz sales here. Each entry reduces product stock automatically."
            action={
              <Button onClick={openNew}>
                <Plus className="h-4 w-4" /> New Sale
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
                  <TH>Product</TH>
                  <TH>Store</TH>
                  <TH align="right">Qty</TH>
                  <TH align="right">Gross</TH>
                  <TH align="right">Deductions</TH>
                  <TH align="right">Net</TH>
                  <TH align="right">Actions</TH>
                </TRow>
              </THead>
              <tbody>
                {sales.map((s) => (
                  <TRow key={s.id}>
                    <TD>{formatDate(s.date)}</TD>
                    <TD className="max-w-[160px] truncate font-medium text-slate-800">
                      {s.productName}
                    </TD>
                    <TD className="text-slate-500">{s.storeName ?? '—'}</TD>
                    <TD align="right">{formatNumber(s.quantitySold)}</TD>
                    <TD align="right">{formatMoney(s.grossAmount)}</TD>
                    <TD align="right" className="text-rose-500">
                      −{formatMoney(s.commission + s.vat + s.otherCharges + s.returnsRefunds)}
                    </TD>
                    <TD align="right" className="font-semibold text-emerald-600">
                      {formatMoney(s.netAmount)}
                    </TD>
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
                          action={deleteSale}
                          id={s.id}
                          message="Delete this sale? Sold stock will be returned."
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
        title={editing ? 'Edit Sale' : 'New Sale'}
        description="Net settlement is calculated from gross minus deductions."
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
            <Field label="Product" required>
              <Select
                name="productId"
                value={productId}
                onChange={(e) => onProductChange(e.target.value)}
                required
              >
                <option value="">Select product…</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Quantity sold" required>
              <Input
                name="quantitySold"
                type="number"
                min="1"
                defaultValue={editing?.quantitySold ?? ''}
                required
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Cost per unit (Rs)"
              hint="Snapshotted at sale time — later product cost changes won't alter this sale's profit. Defaults from the product; correct it if needed."
            >
              <input type="hidden" name="unitCostOriginal" value={unitCostOriginal} />
              <Input
                name="unitCost"
                type="number"
                step="0.01"
                min="0"
                value={unitCost}
                onChange={(e) => setUnitCost(e.target.value)}
                placeholder="0.00"
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Gross sale amount" required>
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
            <Field label="Other Daraz charges">
              <Input
                name="otherCharges"
                type="number"
                step="0.01"
                min="0"
                defaultValue={editing?.otherCharges ?? 0}
                onChange={(e) => setOther(Number(e.target.value) || 0)}
              />
            </Field>
            {editing && editing.returnsRefunds > 0 && (
              <Field
                label="Returns / refunds (legacy — read only)"
                hint="Recorded before the Returns module existed. Preserved as-is and still deducted from this sale's net amount."
              >
                <Input
                  type="text"
                  value={formatMoney(editing.returnsRefunds)}
                  readOnly
                  disabled
                />
              </Field>
            )}
          </div>

          <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            Recording a refund? Add it in <strong>Returns &amp; Refunds</strong>, not here.
            Returns is the single source for every new refund — it tracks who bears the
            cost and where the returned unit ended up, and only seller-borne completed
            refunds reduce profit.
          </p>

          <div className="flex items-center justify-between rounded-lg bg-emerald-50 px-4 py-3">
            <span className="text-sm font-medium text-emerald-800">
              Net received / settlement
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
            <SubmitButton>{editing ? 'Save changes' : 'Record sale'}</SubmitButton>
          </div>
        </form>
      </Modal>
    </>
  );
}
