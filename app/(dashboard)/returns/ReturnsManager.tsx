'use client';

import { useActionState, useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, Pencil, Undo2, RotateCcw, AlertTriangle } from 'lucide-react';
import { saveReturn, deleteReturn, restoreReturn } from './actions';
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
  Badge,
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

type ChargedTo = 'SELLER' | 'PLATFORM' | 'PENDING';
type RefundStatus = 'PENDING' | 'COMPLETED' | 'CANCELLED';
type InventoryStatus =
  | 'NOT_RECEIVED'
  | 'RECEIVED_PENDING_QC'
  | 'RESTOCKED'
  | 'DAMAGED'
  | 'LOST';

interface Opt {
  id: string;
  name: string;
}
interface ProductOpt extends Opt {
  purchaseCost: number;
}
interface SaleOpt {
  id: string;
  label: string;
  productId: string;
  storeId: string | null;
  legacyRefund: number;
  unitCost: number | null;
  productPurchaseCost: number;
}
interface ReturnRow {
  id: string;
  returnDate: string;
  orderDate: string | null;
  receivedAt: string | null;
  storeId: string | null;
  storeName: string | null;
  productId: string | null;
  productName: string | null;
  saleId: string | null;
  buyerName: string | null;
  sellerSku: string | null;
  orderNumber: string | null;
  returnOrderId: string | null;
  returnItemId: string | null;
  orderItemId: string | null;
  quantity: number;
  paidAmount: number;
  refundAmount: number;
  unitCost: number | null;
  chargedTo: ChargedTo;
  refundStatus: RefundStatus;
  inventoryStatus: InventoryStatus;
  reason: string | null;
  status: string | null;
  trackingNumber: string | null;
  logisticStatus: string | null;
  notes: string | null;
  deleted: boolean;
}

const CHARGE_LABEL: Record<ChargedTo, string> = {
  SELLER: 'Seller',
  PLATFORM: 'Platform',
  PENDING: 'Undecided',
};
const CHARGE_TONE: Record<ChargedTo, 'red' | 'green' | 'amber'> = {
  SELLER: 'red',
  PLATFORM: 'green',
  PENDING: 'amber',
};

const REFUND_LABEL: Record<RefundStatus, string> = {
  PENDING: 'Pending',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};
const REFUND_TONE: Record<RefundStatus, 'amber' | 'blue' | 'slate'> = {
  PENDING: 'amber',
  COMPLETED: 'blue',
  CANCELLED: 'slate',
};

const INV_LABEL: Record<InventoryStatus, string> = {
  NOT_RECEIVED: 'Not received',
  RECEIVED_PENDING_QC: 'Received – QC',
  RESTOCKED: 'Restocked',
  DAMAGED: 'Damaged',
  LOST: 'Lost',
};
const INV_TONE: Record<InventoryStatus, 'slate' | 'amber' | 'green' | 'red' | 'purple'> = {
  NOT_RECEIVED: 'slate',
  RECEIVED_PENDING_QC: 'amber',
  RESTOCKED: 'green',
  DAMAGED: 'red',
  LOST: 'purple',
};

/** True when this row's refund reduces seller profit. */
const isSellerLoss = (r: ReturnRow) =>
  r.refundStatus === 'COMPLETED' && r.chargedTo === 'SELLER';

export function ReturnsManager({
  returns,
  products,
  stores,
  sales,
  totals,
  meta,
  showDeleted,
  deletedCount,
  error,
}: {
  returns: ReturnRow[];
  products: ProductOpt[];
  stores: Opt[];
  sales: SaleOpt[];
  totals: {
    refund: number;
    units: number;
    count: number;
    sellerLoss: number;
    platformCovered: number;
    pending: number;
  };
  meta: PageMeta;
  showDeleted: boolean;
  deletedCount: number;
  error: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ReturnRow | null>(null);
  const [state, formAction] = useActionState(saveReturn, initialFormState);

  // Live form state — drives conditional hints/requirements.
  const [inv, setInv] = useState<InventoryStatus>('NOT_RECEIVED');
  const [saleId, setSaleId] = useState('');
  const [productId, setProductId] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [refundStatus, setRefundStatus] = useState<RefundStatus>('PENDING');
  const [chargedTo, setChargedTo] = useState<ChargedTo>('PENDING');

  useEffect(() => {
    if (state.ok) {
      setOpen(false);
      setEditing(null);
    }
  }, [state.ok, state.ts]);

  function seed(r: ReturnRow | null) {
    setInv(r?.inventoryStatus ?? 'NOT_RECEIVED');
    setSaleId(r?.saleId ?? '');
    setProductId(r?.productId ?? '');
    setRefundStatus(r?.refundStatus ?? 'PENDING');
    setChargedTo(r?.chargedTo ?? 'PENDING');
    setUnitCost(r && r.unitCost !== null ? String(r.unitCost) : '');
  }

  // Suggest a cost snapshot when the product changes and nothing is set yet.
  function onProductChange(id: string) {
    setProductId(id);
    const p = products.find((x) => x.id === id);
    if (p && !unitCost) setUnitCost(String(p.purchaseCost));
  }
  // When a sale is linked, suggest its snapshotted cost (legacy fallback).
  function onSaleChange(id: string) {
    setSaleId(id);
    const s = sales.find((x) => x.id === id);
    if (s) setUnitCost(String(s.unitCost ?? s.productPurchaseCost));
  }
  function openNew() {
    setEditing(null);
    seed(null);
    setOpen(true);
  }
  function openEdit(row: ReturnRow) {
    setEditing(row);
    seed(row);
    setOpen(true);
  }

  const needsReceipt =
    inv === 'RECEIVED_PENDING_QC' || inv === 'RESTOCKED' || inv === 'DAMAGED';
  const linkedSale = sales.find((s) => s.id === saleId);
  const legacyClash =
    !!linkedSale &&
    linkedSale.legacyRefund > 0 &&
    refundStatus === 'COMPLETED' &&
    chargedTo === 'SELLER';

  const exportRows = returns.map((r) => ({
    returnDate: formatDate(r.returnDate),
    product: r.productName ?? r.sellerSku ?? '',
    store: r.storeName ?? '',
    orderNumber: r.orderNumber ?? '',
    returnOrderId: r.returnOrderId ?? '',
    qty: r.quantity,
    refund: r.refundAmount,
    sellerLoss: isSellerLoss(r) ? r.refundAmount : 0,
    refundStatus: REFUND_LABEL[r.refundStatus],
    chargedTo: CHARGE_LABEL[r.chargedTo],
    inventoryStatus: INV_LABEL[r.inventoryStatus],
    receivedAt: r.receivedAt ? formatDate(r.receivedAt) : '',
    reason: r.reason ?? '',
  }));

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
            Returns &amp; Refunds
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Only <strong>completed</strong> refunds <strong>charged to the seller</strong>{' '}
            reduce profit. Platform-covered and pending refunds never do.
          </p>
        </div>
        <div className="flex gap-2">
          <ExportButtons
            title="Returns Report"
            filename="returns"
            columns={[
              { key: 'returnDate', label: 'Return Date' },
              { key: 'product', label: 'Product' },
              { key: 'store', label: 'Store' },
              { key: 'orderNumber', label: 'Order No.' },
              { key: 'returnOrderId', label: 'Return Order ID' },
              { key: 'qty', label: 'Qty' },
              { key: 'refund', label: 'Refund', money: true },
              { key: 'sellerLoss', label: 'Seller Loss', money: true },
              { key: 'refundStatus', label: 'Refund Status' },
              { key: 'chargedTo', label: 'Charged To' },
              { key: 'inventoryStatus', label: 'Inventory' },
              { key: 'receivedAt', label: 'Received' },
              { key: 'reason', label: 'Reason' },
            ]}
            rows={exportRows}
          />
          <Button onClick={openNew}>
            <Plus className="h-4 w-4" /> New Return
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Seller Loss"
          value={formatMoney(totals.sellerLoss)}
          tone="negative"
          hint="Completed + charged to seller — reduces profit"
        />
        <StatCard
          label="Platform Covered"
          value={formatMoney(totals.platformCovered)}
          tone="positive"
          hint="Absorbed by Daraz — no profit impact"
        />
        <StatCard
          label="Pending Refunds"
          value={formatMoney(totals.pending)}
          tone="warning"
          hint="Not settled — not counted as a loss"
        />
        <StatCard
          label="Total Refunds"
          value={formatMoney(totals.refund)}
          hint={`${formatNumber(totals.count)} return(s) · ${formatNumber(totals.units)} unit(s)`}
        />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="min-w-[220px] flex-1">
          <SearchBar placeholder="Search product, order no, return ID, reason…" />
        </div>
        <Link
          href={showDeleted ? '/returns' : '/returns?deleted=1'}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
        >
          {showDeleted
            ? '← Back to active returns'
            : `View deleted (${formatNumber(deletedCount)})`}
        </Link>
      </div>

      {showDeleted && (
        <p className="mb-3 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600">
          Showing deleted returns. Their stock effects have been reversed. Restoring one
          re-applies its inventory effect.
        </p>
      )}

      {meta.total === 0 ? (
        <EmptyState
          icon={<Undo2 className="h-10 w-10" />}
          title={
            showDeleted
              ? 'No deleted returns'
              : meta.q
                ? 'No matching returns'
                : 'No returns recorded'
          }
          message={
            meta.q
              ? `No returns match “${meta.q}”. Try a different search.`
              : showDeleted
                ? 'Deleted returns will appear here and can be restored.'
                : 'Record each Daraz return here to track refunds, who bears the cost, and where the returned unit ended up.'
          }
          action={
            !showDeleted && !meta.q ? (
              <Button onClick={openNew}>
                <Plus className="h-4 w-4" /> New Return
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card>
          <CardBody className="p-0">
            <Table>
              <THead>
                <TRow>
                  <TH>Return Date</TH>
                  <TH>Product</TH>
                  <TH align="center">Qty</TH>
                  <TH align="right">Refund</TH>
                  <TH align="right">Seller Loss</TH>
                  <TH align="center">Refund</TH>
                  <TH align="center">Charged</TH>
                  <TH align="center">Inventory</TH>
                  <TH>Received</TH>
                  <TH align="right">Actions</TH>
                </TRow>
              </THead>
              <tbody>
                {returns.map((r) => (
                  <TRow key={r.id}>
                    <TD>{formatDate(r.returnDate)}</TD>
                    <TD>
                      <div className="max-w-[200px] truncate font-medium text-slate-800">
                        {r.productName ?? '—'}
                      </div>
                      {r.sellerSku && (
                        <div className="max-w-[200px] truncate text-xs text-slate-400">
                          {r.sellerSku}
                        </div>
                      )}
                      {(r.status || r.logisticStatus) && (
                        <div className="max-w-[200px] truncate text-xs text-slate-400">
                          Daraz: {[r.status, r.logisticStatus].filter(Boolean).join(' · ')}
                        </div>
                      )}
                    </TD>
                    <TD align="center">{r.quantity}</TD>
                    <TD align="right">{formatMoney(r.refundAmount)}</TD>
                    <TD align="right" className="font-semibold">
                      {isSellerLoss(r) ? (
                        <span className="text-rose-600">
                          −{formatMoney(r.refundAmount)}
                        </span>
                      ) : (
                        <span className="text-slate-400">{formatMoney(0)}</span>
                      )}
                    </TD>
                    <TD align="center">
                      <Badge tone={REFUND_TONE[r.refundStatus]}>
                        {REFUND_LABEL[r.refundStatus]}
                      </Badge>
                    </TD>
                    <TD align="center">
                      <Badge tone={CHARGE_TONE[r.chargedTo]}>
                        {CHARGE_LABEL[r.chargedTo]}
                      </Badge>
                    </TD>
                    <TD align="center">
                      <Badge tone={INV_TONE[r.inventoryStatus]}>
                        {INV_LABEL[r.inventoryStatus]}
                      </Badge>
                    </TD>
                    <TD className="text-slate-500">
                      {r.receivedAt ? formatDate(r.receivedAt) : '—'}
                    </TD>
                    <TD align="right">
                      <div className="flex items-center justify-end gap-1">
                        {r.deleted ? (
                          <ConfirmButton
                            action={restoreReturn}
                            id={r.id}
                            icon={false}
                            label={
                              <span className="inline-flex items-center gap-1">
                                <RotateCcw className="h-3.5 w-3.5" /> Restore
                              </span>
                            }
                            message="Restore this return? Its inventory effect will be re-applied."
                            className="h-8 px-2 text-emerald-600 hover:bg-emerald-50"
                          />
                        ) : (
                          <>
                            <button
                              onClick={() => openEdit(r)}
                              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                              aria-label="Edit"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <ConfirmButton
                              action={deleteReturn}
                              id={r.id}
                              message="Delete this return? Its inventory effect will be reversed."
                            />
                          </>
                        )}
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
        title={editing ? 'Edit Return' : 'New Return'}
        description="Refund status and who bears the cost drive Profit & Loss. Inventory status drives stock."
        size="lg"
      >
        <form action={formAction} className="flex flex-col gap-4">
          {editing && <input type="hidden" name="id" value={editing.id} />}
          {state.error && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {state.error}
            </p>
          )}

          {/* --- identity --- */}
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Daraz identity
            </p>
            <p className="mb-3 text-xs text-slate-400">
              Provide a Return Item ID, or both a Return Order ID and an Order Item ID.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Return Item ID">
                <Input
                  name="returnItemId"
                  type="text"
                  defaultValue={editing?.returnItemId ?? ''}
                />
              </Field>
              <Field label="Order Item ID">
                <Input
                  name="orderItemId"
                  type="text"
                  defaultValue={editing?.orderItemId ?? ''}
                />
              </Field>
              <Field label="Return Order ID">
                <Input
                  name="returnOrderId"
                  type="text"
                  defaultValue={editing?.returnOrderId ?? ''}
                />
              </Field>
              <Field label="Order number">
                <Input
                  name="orderNumber"
                  type="text"
                  defaultValue={editing?.orderNumber ?? ''}
                />
              </Field>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Return date" required hint="Used as the Profit & Loss period">
              <Input
                name="returnDate"
                type="date"
                defaultValue={toDateInput(editing?.returnDate ?? new Date())}
                required
              />
            </Field>
            <Field label="Original order date">
              <Input
                name="orderDate"
                type="date"
                defaultValue={toDateInput(editing?.orderDate ?? '')}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Product" hint="Required for any physical inventory status">
              <Select
                name="productId"
                value={productId}
                onChange={(e) => onProductChange(e.target.value)}
              >
                <option value="">— not identified —</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Store" hint="Leave blank if the store is unknown">
              <Select name="storeId" defaultValue={editing?.storeId ?? ''}>
                <option value="">— not identified —</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field
            label="Linked sale (optional)"
            hint="Links the refund to its original sale and guards against double-counting."
          >
            <Select
              name="saleId"
              value={saleId}
              onChange={(e) => onSaleChange(e.target.value)}
            >
              <option value="">— none —</option>
              {sales.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                  {s.legacyRefund > 0 ? ' — has legacy refund' : ''}
                </option>
              ))}
            </Select>
          </Field>

          {legacyClash && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              This sale already records {formatMoney(linkedSale!.legacyRefund)} in its
              legacy “Returns / refunds” field. Set that field to 0 on the sale first —
              otherwise the refund would be counted twice in Profit &amp; Loss.
            </p>
          )}

          {/* --- financial --- */}
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Quantity" required>
              <Input
                name="quantity"
                type="number"
                min="1"
                step="1"
                defaultValue={editing?.quantity ?? 1}
                required
              />
            </Field>
            <Field label="Paid + shipping (Rs)">
              <Input
                name="paidAmount"
                type="number"
                step="0.01"
                min="0"
                defaultValue={editing?.paidAmount ?? ''}
              />
            </Field>
            <Field label="Refund amount (Rs)">
              <Input
                name="refundAmount"
                type="number"
                step="0.01"
                min="0"
                defaultValue={editing?.refundAmount ?? ''}
              />
            </Field>
          </div>

          <Field
            label="Cost per unit (Rs)"
            hint="Used to recover COGS when the item is restocked. Defaults from the linked sale or the product; correct it if needed. Frozen once saved."
          >
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

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Refund status" required>
              <Select
                name="refundStatus"
                value={refundStatus}
                onChange={(e) => setRefundStatus(e.target.value as RefundStatus)}
              >
                <option value="PENDING">Pending — not settled</option>
                <option value="COMPLETED">Completed — refund settled</option>
                <option value="CANCELLED">Cancelled — no refund</option>
              </Select>
            </Field>
            <Field label="Charged to" required>
              <Select
                name="chargedTo"
                value={chargedTo}
                onChange={(e) => setChargedTo(e.target.value as ChargedTo)}
              >
                <option value="PENDING">Undecided</option>
                <option value="SELLER">Seller — our cost</option>
                <option value="PLATFORM">Platform — Daraz absorbs</option>
              </Select>
            </Field>
          </div>

          <div
            className={`flex items-center justify-between rounded-lg px-4 py-3 ${
              refundStatus === 'COMPLETED' && chargedTo === 'SELLER'
                ? 'bg-rose-50'
                : 'bg-slate-50'
            }`}
          >
            <span className="text-sm font-medium text-slate-700">
              Effect on Profit &amp; Loss
            </span>
            <span
              className={`text-sm font-bold ${
                refundStatus === 'COMPLETED' && chargedTo === 'SELLER'
                  ? 'text-rose-700'
                  : 'text-slate-500'
              }`}
            >
              {refundStatus === 'COMPLETED' && chargedTo === 'SELLER'
                ? 'Reduces profit'
                : 'No profit impact'}
            </span>
          </div>

          {/* --- inventory --- */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Inventory / QC status" required>
              <Select
                name="inventoryStatus"
                value={inv}
                onChange={(e) => setInv(e.target.value as InventoryStatus)}
              >
                <option value="NOT_RECEIVED">Not received — no stock effect</option>
                <option value="RECEIVED_PENDING_QC">
                  Received, pending QC — returned stock
                </option>
                <option value="RESTOCKED">Restocked — back to sellable stock</option>
                <option value="DAMAGED">Damaged — damaged stock</option>
                <option value="LOST">Lost — lost stock</option>
              </Select>
            </Field>
            <Field
              label={needsReceipt ? 'Received date (required)' : 'Received date'}
              hint={
                needsReceipt
                  ? 'Required once the unit is physically back'
                  : 'Leave blank while the unit is not received'
              }
            >
              <Input
                name="receivedAt"
                type="date"
                defaultValue={toDateInput(editing?.receivedAt ?? '')}
                required={needsReceipt}
              />
            </Field>
          </div>

          {/* --- raw Daraz info --- */}
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Daraz information (no effect on stock or profit)
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Daraz status">
                <Input
                  name="status"
                  type="text"
                  placeholder="Refunded, Return Shipped…"
                  defaultValue={editing?.status ?? ''}
                />
              </Field>
              <Field label="Logistic status">
                <Input
                  name="logisticStatus"
                  type="text"
                  defaultValue={editing?.logisticStatus ?? ''}
                />
              </Field>
              <Field label="Buyer name">
                <Input
                  name="buyerName"
                  type="text"
                  defaultValue={editing?.buyerName ?? ''}
                />
              </Field>
              <Field label="Tracking number">
                <Input
                  name="trackingNumber"
                  type="text"
                  defaultValue={editing?.trackingNumber ?? ''}
                />
              </Field>
              <Field label="Seller SKU / variant">
                <Input
                  name="sellerSku"
                  type="text"
                  defaultValue={editing?.sellerSku ?? ''}
                />
              </Field>
              <Field label="Return reason">
                <Input name="reason" type="text" defaultValue={editing?.reason ?? ''} />
              </Field>
            </div>
          </div>

          <Field label="Notes">
            <Textarea name="notes" defaultValue={editing?.notes ?? ''} />
          </Field>

          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <SubmitButton>{editing ? 'Save changes' : 'Record return'}</SubmitButton>
          </div>
        </form>
      </Modal>
    </>
  );
}
