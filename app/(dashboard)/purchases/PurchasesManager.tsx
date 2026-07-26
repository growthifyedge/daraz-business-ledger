'use client';

import { useActionState, useEffect, useState } from 'react';
import { Plus, Pencil, ShoppingCart, FileText, Banknote, Tag } from 'lucide-react';
import type { PaymentStatus } from '@prisma/client';
import { savePurchase, saveNewProductPurchase, deletePurchase } from './actions';
import { BulkPurchaseUpload } from './BulkPurchaseUpload';
import { YahyaPayments, type PaymentRecord, type PaymentView } from './YahyaPayments';
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
interface PurchaseRow {
  id: string;
  date: string;
  purchasedBy: string;
  storeId: string | null;
  storeName: string | null;
  productId: string;
  productName: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  paymentStatus: PaymentStatus;
  reimbursementDate: string | null;
  bankReference: string | null;
  invoiceUrl: string | null;
  notes: string | null;
}

type NewPurchaseStatus = 'PAID' | 'UNPAID' | 'RECONCILIATION_PENDING';

export function PurchasesManager({
  purchases,
  products,
  stores,
  totals,
  payments,
  meta,
}: {
  purchases: PurchaseRow[];
  products: Opt[];
  stores: Opt[];
  totals: { total: number; payable: number; paid: number; reconciliationPending: number; count: number };
  payments: PaymentRecord[];
  meta: PageMeta;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PurchaseRow | null>(null);
  // Which Yahya payment dialog is open: 'record' (top button) or 'history'
  // (clicking the Paid to Yahya card). null = closed.
  const [paymentView, setPaymentView] = useState<PaymentView>(null);
  // The manual New Purchase form does not offer PARTIALLY_PAID (that is derived
  // from Yahya payment allocations, never set by hand).
  const [status, setStatus] = useState<NewPurchaseStatus>('UNPAID');
  // Which purchase mode the modal shows when creating: an existing ledger
  // product (default) or create a brand-new product while recording the purchase.
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [state, formAction] = useActionState(savePurchase, initialFormState);
  const [newState, newFormAction] = useActionState(saveNewProductPurchase, initialFormState);

  useEffect(() => {
    if (state.ok || newState.ok) {
      setOpen(false);
      setEditing(null);
    }
  }, [state.ok, state.ts, newState.ok, newState.ts]);

  function openNew() {
    setEditing(null);
    setStatus('UNPAID');
    setMode('existing');
    setOpen(true);
  }
  function openEdit(row: PurchaseRow) {
    setEditing(row);
    setMode('existing'); // editing is always an existing product
    // PARTIALLY_PAID is derived from payments — the manual select can't set it.
    setStatus(row.paymentStatus === 'PARTIALLY_PAID' ? 'UNPAID' : row.paymentStatus);
    setOpen(true);
  }

  const exportRows = purchases.map((p) => ({
    date: formatDate(p.date),
    product: p.productName,
    store: p.storeName ?? '',
    qty: p.quantity,
    unitCost: p.unitCost,
    total: p.totalCost,
    bankRef: p.bankReference ?? '',
  }));

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
            Purchases
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Stock bought by Yahya and reimbursed by bank transfer.
          </p>
        </div>
        <div className="flex gap-2">
          <ExportButtons
            title="Purchase Report"
            filename="purchases"
            columns={[
              { key: 'date', label: 'Date' },
              { key: 'product', label: 'Product' },
              { key: 'store', label: 'Store' },
              { key: 'qty', label: 'Qty' },
              { key: 'unitCost', label: 'Unit Cost', money: true },
              { key: 'total', label: 'Total', money: true },
              { key: 'bankRef', label: 'Bank Ref' },
            ]}
            rows={exportRows}
          />
          <BulkPurchaseUpload />
          {/* Top Payments button opens only "Record New Payment". */}
          <Button variant="outline" onClick={() => setPaymentView('record')}>
            <Banknote className="h-4 w-4" /> Payments
          </Button>
          <Button onClick={openNew}>
            <Plus className="h-4 w-4" /> New Purchase
          </Button>
        </div>
      </div>

      {/* Three summary cards only. Per-row payment status / balances stay
          hidden. The Paid to Yahya card opens Payment History; recording and
          removing payments live there. "Payment Reconciliation Pending" is
          intentionally not shown. */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Total Purchased" value={formatMoney(totals.total)} />
        <StatCard label="Yahya Debt" value={formatMoney(totals.payable)} />
        <StatCard
          label="Paid to Yahya"
          value={formatMoney(totals.paid)}
          hint="View payment history →"
          onClick={() => setPaymentView('history')}
        />
      </div>

      <YahyaPayments
        view={paymentView}
        onChangeView={setPaymentView}
        payableTotal={totals.payable}
        payments={payments}
      />

      <div className="mb-3">
        <SearchBar placeholder="Search product, bank ref, notes…" />
      </div>

      {meta.total === 0 ? (
        meta.q ? (
          <EmptyState
            icon={<ShoppingCart className="h-10 w-10" />}
            title="No matching purchases"
            message={`No purchases match “${meta.q}”. Try a different search.`}
          />
        ) : (
          <EmptyState
            icon={<ShoppingCart className="h-10 w-10" />}
            title="No purchases yet"
            message="Record stock Yahya buys from the market, with invoice and payment status."
            action={
              <Button onClick={openNew}>
                <Plus className="h-4 w-4" /> New Purchase
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
                  <TH align="right">Unit</TH>
                  <TH align="right">Total</TH>
                  <TH align="center">Invoice</TH>
                  <TH align="right">Actions</TH>
                </TRow>
              </THead>
              <tbody>
                {purchases.map((p) => (
                  <TRow key={p.id}>
                    <TD>{formatDate(p.date)}</TD>
                    <TD className="max-w-[160px] truncate font-medium text-slate-800">
                      {p.productName}
                    </TD>
                    <TD className="text-slate-500">{p.storeName ?? '—'}</TD>
                    <TD align="right">{formatNumber(p.quantity)}</TD>
                    <TD align="right">{formatMoney(p.unitCost)}</TD>
                    <TD align="right" className="font-medium">
                      {formatMoney(p.totalCost)}
                    </TD>
                    <TD align="center">
                      {p.invoiceUrl ? (
                        <a
                          href={p.invoiceUrl}
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
                          onClick={() => openEdit(p)}
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                          aria-label="Edit"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <ConfirmButton
                          action={deletePurchase}
                          id={p.id}
                          message="Delete this purchase? Stock added will be reversed."
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
        title={editing ? 'Edit Purchase' : 'New Purchase'}
        description="Recording adds stock to the product automatically."
        size="lg"
      >
        {/* Mode toggle — only when creating. Editing is always existing-product. */}
        {!editing && (
          <div className="mb-4 inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-sm">
            <button
              type="button"
              onClick={() => setMode('existing')}
              className={
                mode === 'existing'
                  ? 'rounded-md bg-white px-3 py-1.5 font-medium text-slate-900 shadow-sm'
                  : 'rounded-md px-3 py-1.5 text-slate-500 hover:text-slate-700'
              }
            >
              Existing product
            </button>
            <button
              type="button"
              onClick={() => setMode('new')}
              className={
                mode === 'new'
                  ? 'rounded-md bg-white px-3 py-1.5 font-medium text-slate-900 shadow-sm'
                  : 'rounded-md px-3 py-1.5 text-slate-500 hover:text-slate-700'
              }
            >
              Create new product
            </button>
          </div>
        )}

        {mode === 'existing' || editing ? (
          <form action={formAction} className="flex flex-col gap-4">
            {editing && <input type="hidden" name="id" value={editing.id} />}
            {state.error && (
              <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {state.error}
              </p>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Purchase date" required>
                <Input
                  name="date"
                  type="date"
                  defaultValue={toDateInput(editing?.date ?? new Date())}
                  required
                />
              </Field>
              <Field label="Purchased by">
                <Input name="purchasedBy" defaultValue={editing?.purchasedBy ?? 'Yahya'} />
              </Field>
              <Field label="Product" required>
                <Select name="productId" defaultValue={editing?.productId ?? ''} required>
                  <option value="">Select product…</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
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
              <Field label="Quantity" required>
                <Input
                  name="quantity"
                  type="number"
                  min="1"
                  defaultValue={editing?.quantity ?? ''}
                  required
                />
              </Field>
              <Field label="Unit cost" required>
                <Input
                  name="unitCost"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={editing?.unitCost ?? ''}
                  required
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Payment status">
                <Select
                  name="paymentStatus"
                  value={status}
                  onChange={(e) =>
                    setStatus(e.target.value as 'PAID' | 'UNPAID' | 'RECONCILIATION_PENDING')
                  }
                >
                  <option value="UNPAID">Unpaid</option>
                  <option value="PAID">Paid (reimbursed)</option>
                  <option value="RECONCILIATION_PENDING">Payment reconciliation pending</option>
                </Select>
              </Field>
              {status === 'PAID' && (
                <Field label="Reimbursement date">
                  <Input
                    name="reimbursementDate"
                    type="date"
                    defaultValue={toDateInput(editing?.reimbursementDate)}
                  />
                </Field>
              )}
              <Field label="Bank transfer reference">
                <Input name="bankReference" defaultValue={editing?.bankReference ?? ''} />
              </Field>
            </div>

            {/* Optional Daraz listing details — creates the store-scoped SKU
                mapping in the same save, so nobody has to open Daraz Import. A
                plain restock leaves these empty and behaves exactly as before. */}
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
              <div className="mb-1 flex items-center gap-1.5 text-sm font-medium text-slate-700">
                <Tag className="h-4 w-4 text-brand-500" /> Daraz listing details (optional)
              </div>
              <p className="mb-3 text-xs text-slate-500">
                Map this product&rsquo;s Daraz Seller SKU for a store now. Daraz Import will resolve it
                automatically — no later mapping step. Leave empty for a normal restock.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Store">
                  <Select name="mapStoreId" defaultValue="">
                    <option value="">—</option>
                    {stores.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Daraz Seller SKU">
                  <Input name="mapSellerSku" placeholder="e.g. 812954-Black" />
                </Field>
              </div>
            </div>

            <FileUpload name="invoiceUrl" defaultUrl={editing?.invoiceUrl} label="Invoice / bill (image or PDF)" />

            <Field label="Notes">
              <Textarea name="notes" defaultValue={editing?.notes ?? ''} />
            </Field>

            <div className="mt-2 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <SubmitButton>{editing ? 'Save changes' : 'Record purchase'}</SubmitButton>
            </div>
          </form>
        ) : (
          <form action={newFormAction} className="flex flex-col gap-4">
            {newState.error && (
              <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {newState.error}
              </p>
            )}
            <p className="rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-700">
              Creates the product, records this purchase, adds stock, and maps the Daraz Seller SKU —
              all in one atomic save.
            </p>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="New product name" required>
                <Input name="productName" placeholder="Product name" required />
              </Field>
              <Field label="Internal product code (optional)">
                <Input name="productCode" placeholder="Auto-generated if blank" />
              </Field>
              <Field label="Purchase date" required>
                <Input name="date" type="date" defaultValue={toDateInput(new Date())} required />
              </Field>
              <Field label="Purchased by">
                <Input name="purchasedBy" defaultValue="Yahya" />
              </Field>
              <Field label="Quantity" required>
                <Input name="quantity" type="number" min="1" required />
              </Field>
              <Field label="Unit purchase cost" required>
                <Input name="unitCost" type="number" step="0.01" min="0" required />
              </Field>
            </div>

            {/* Store + Seller SKU are required here — this flow exists to map a
                new Daraz listing atomically with its first purchase. */}
            <div className="rounded-xl border border-brand-100 bg-brand-50/40 p-4">
              <div className="mb-3 flex items-center gap-1.5 text-sm font-medium text-slate-700">
                <Tag className="h-4 w-4 text-brand-500" /> Daraz listing (required)
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Store" required>
                  <Select name="mapStoreId" defaultValue="" required>
                    <option value="">Select store…</option>
                    {stores.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Daraz Seller SKU" required>
                  <Input name="mapSellerSku" placeholder="e.g. 812954-Black" required />
                </Field>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Payment status">
                <Select
                  name="paymentStatus"
                  value={status}
                  onChange={(e) =>
                    setStatus(e.target.value as 'PAID' | 'UNPAID' | 'RECONCILIATION_PENDING')
                  }
                >
                  <option value="UNPAID">Unpaid</option>
                  <option value="PAID">Paid (reimbursed)</option>
                  <option value="RECONCILIATION_PENDING">Payment reconciliation pending</option>
                </Select>
              </Field>
              {status === 'PAID' && (
                <Field label="Reimbursement date">
                  <Input name="reimbursementDate" type="date" />
                </Field>
              )}
              <Field label="Bank transfer reference">
                <Input name="bankReference" />
              </Field>
            </div>

            <FileUpload name="invoiceUrl" label="Invoice / bill (image or PDF)" />

            <Field label="Notes">
              <Textarea name="notes" />
            </Field>

            <div className="mt-2 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <SubmitButton>Create product &amp; record purchase</SubmitButton>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
