'use client';

import { useActionState, useEffect, useState } from 'react';
import { Plus, Pencil, ShoppingCart, FileText } from 'lucide-react';
import type { PaymentStatus } from '@prisma/client';
import { savePurchase, deletePurchase } from './actions';
import { BulkPurchaseUpload } from './BulkPurchaseUpload';
import { YahyaPayments, type PaymentRecord } from './YahyaPayments';
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
  remaining: number;
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
  totals: { total: number; payable: number; reconciliationPending: number; count: number };
  payments: PaymentRecord[];
  meta: PageMeta;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PurchaseRow | null>(null);
  // The manual New Purchase form does not offer PARTIALLY_PAID (that is derived
  // from Yahya payment allocations, never set by hand).
  const [status, setStatus] = useState<NewPurchaseStatus>('UNPAID');
  const [state, formAction] = useActionState(savePurchase, initialFormState);

  useEffect(() => {
    if (state.ok) {
      setOpen(false);
      setEditing(null);
    }
  }, [state.ok, state.ts]);

  function openNew() {
    setEditing(null);
    setStatus('UNPAID');
    setOpen(true);
  }
  function openEdit(row: PurchaseRow) {
    setEditing(row);
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
    status: humanize(p.paymentStatus),
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
              { key: 'status', label: 'Status' },
              { key: 'bankRef', label: 'Bank Ref' },
            ]}
            rows={exportRows}
          />
          <BulkPurchaseUpload />
          <YahyaPayments payableTotal={totals.payable} payments={payments} />
          <Button onClick={openNew}>
            <Plus className="h-4 w-4" /> New Purchase
          </Button>
        </div>
      </div>

      {/* The "Payment reconciliation pending" summary card is intentionally
          hidden from the Purchases page. The underlying RECONCILIATION_PENDING
          purchases, stock, costs and statuses are unchanged. */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Total Purchased" value={formatMoney(totals.total)} />
        <StatCard
          label="Payable to Yahya"
          value={formatMoney(totals.payable)}
          hint="Outstanding balance (unpaid + partially paid)"
          tone={totals.payable > 0 ? 'warning' : 'default'}
        />
        <StatCard label="Purchase Records" value={formatNumber(totals.count)} />
      </div>

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
                  <TH align="right">Remaining</TH>
                  <TH align="center">Status</TH>
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
                    <TD align="right" className={p.remaining > 0 ? 'text-amber-700' : 'text-slate-400'}>
                      {p.paymentStatus === 'RECONCILIATION_PENDING' ? '—' : formatMoney(p.remaining)}
                    </TD>
                    <TD align="center">
                      <Badge
                        tone={
                          p.paymentStatus === 'PAID'
                            ? 'green'
                            : p.paymentStatus === 'RECONCILIATION_PENDING'
                              ? 'blue'
                              : p.paymentStatus === 'PARTIALLY_PAID'
                                ? 'purple'
                                : 'amber'
                        }
                      >
                        {p.paymentStatus === 'RECONCILIATION_PENDING'
                          ? 'Reconciliation pending'
                          : humanize(p.paymentStatus)}
                      </Badge>
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
      </Modal>
    </>
  );
}
