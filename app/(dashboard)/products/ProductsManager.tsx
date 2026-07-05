'use client';

import { useActionState, useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, Pencil, PackagePlus, Package, History } from 'lucide-react';
import { saveProduct, deleteProduct, adjustStock } from './actions';
import { initialFormState } from '@/lib/formState';
import { Button, SubmitButton } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { ConfirmButton } from '@/components/ConfirmButton';
import { SearchBar } from '@/components/SearchBar';
import { Pagination } from '@/components/Pagination';
import type { PageMeta } from '@/lib/pagination';
import {
  Card,
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
import { formatMoney, formatNumber } from '@/lib/utils';
import { PRODUCT_CATEGORY } from '@/lib/config';

interface StoreOpt {
  id: string;
  name: string;
}
interface ProductRow {
  id: string;
  name: string;
  sku: string;
  purchaseCost: number;
  sellingPrice: number;
  currentStock: number;
  minStockLevel: number;
  damagedStock: number;
  lostStock: number;
  returnedStock: number;
  active: boolean;
  notes: string | null;
  storeIds: string[];
  storeNames: string[];
}

const ADJUST_TYPES = [
  { value: 'ADD', label: 'Add stock' },
  { value: 'REDUCE', label: 'Reduce stock' },
  { value: 'ADJUST', label: 'Adjust to exact count' },
  { value: 'RETURNED', label: 'Record returned (back to stock)' },
  { value: 'DAMAGED', label: 'Record damaged' },
  { value: 'LOST', label: 'Record lost' },
  { value: 'TRANSFER', label: 'Transfer between stores' },
];

export function ProductsManager({
  products,
  stores,
  meta,
}: {
  products: ProductRow[];
  stores: StoreOpt[];
  meta: PageMeta;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ProductRow | null>(null);
  const [stockOpen, setStockOpen] = useState(false);
  const [stockProduct, setStockProduct] = useState<ProductRow | null>(null);

  const [saveState, saveAction] = useActionState(saveProduct, initialFormState);
  const [stockState, stockActionFn] = useActionState(adjustStock, initialFormState);
  const [adjustType, setAdjustType] = useState('ADD');

  useEffect(() => {
    if (saveState.ok) {
      setFormOpen(false);
      setEditing(null);
    }
  }, [saveState.ok, saveState.ts]);
  useEffect(() => {
    if (stockState.ok) {
      setStockOpen(false);
      setStockProduct(null);
    }
  }, [stockState.ok, stockState.ts]);

  return (
    <>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
            Products & Inventory
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {PRODUCT_CATEGORY} · {meta.total} products
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus className="h-4 w-4" /> New Product
        </Button>
      </div>

      <div className="mb-3">
        <SearchBar placeholder="Search name or SKU…" />
      </div>

      {meta.total === 0 ? (
        meta.q ? (
          <EmptyState
            icon={<Package className="h-10 w-10" />}
            title="No matching products"
            message={`No products match “${meta.q}”. Try a different search.`}
          />
        ) : (
          <EmptyState
            icon={<Package className="h-10 w-10" />}
            title="No products yet"
            message="Add your products to start tracking stock, costs and sales."
            action={
              <Button
                onClick={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
              >
                <Plus className="h-4 w-4" /> New Product
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
                  <TH>Product</TH>
                  <TH>Stores</TH>
                  <TH align="right">Cost</TH>
                  <TH align="right">Price</TH>
                  <TH align="right">Stock</TH>
                  <TH align="right">Stock Value</TH>
                  <TH align="center">Status</TH>
                  <TH align="right">Actions</TH>
                </TRow>
              </THead>
              <tbody>
                {products.map((p) => {
                  const low = p.currentStock <= p.minStockLevel;
                  return (
                    <TRow key={p.id}>
                      <TD>
                        <div className="font-medium text-slate-800">{p.name}</div>
                        <div className="text-xs text-slate-400">{p.sku}</div>
                      </TD>
                      <TD>
                        <div className="flex flex-wrap gap-1">
                          {p.storeNames.length ? (
                            p.storeNames.map((n) => (
                              <Badge key={n} tone="blue">
                                {n}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-xs text-slate-300">—</span>
                          )}
                        </div>
                      </TD>
                      <TD align="right">{formatMoney(p.purchaseCost)}</TD>
                      <TD align="right">{formatMoney(p.sellingPrice)}</TD>
                      <TD align="right">
                        <span
                          className={
                            low ? 'font-semibold text-amber-600' : 'text-slate-700'
                          }
                        >
                          {formatNumber(p.currentStock)}
                        </span>
                        <span className="text-xs text-slate-400">
                          {' '}
                          / {p.minStockLevel}
                        </span>
                      </TD>
                      <TD align="right">
                        {formatMoney(p.currentStock * p.purchaseCost)}
                      </TD>
                      <TD align="center">
                        {low && (
                          <Badge tone={p.currentStock === 0 ? 'red' : 'amber'}>
                            {p.currentStock === 0 ? 'Out' : 'Low'}
                          </Badge>
                        )}
                        {!low && (
                          <Badge tone={p.active ? 'green' : 'slate'}>
                            {p.active ? 'Active' : 'Inactive'}
                          </Badge>
                        )}
                      </TD>
                      <TD align="right">
                        <div className="flex items-center justify-end gap-0.5">
                          <button
                            onClick={() => {
                              setStockProduct(p);
                              setAdjustType('ADD');
                              setStockOpen(true);
                            }}
                            className="flex h-8 items-center gap-1 rounded-lg px-2 text-xs text-brand-600 transition hover:bg-brand-50"
                          >
                            <PackagePlus className="h-4 w-4" /> Stock
                          </button>
                          <Link
                            href={`/products/${p.id}`}
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                            aria-label="History"
                          >
                            <History className="h-4 w-4" />
                          </Link>
                          <button
                            onClick={() => {
                              setEditing(p);
                              setFormOpen(true);
                            }}
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                            aria-label="Edit"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <ConfirmButton
                            action={deleteProduct}
                            id={p.id}
                            message={`Delete "${p.name}"? Its history is kept.`}
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

      {/* Product form */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? 'Edit Product' : 'New Product'}
        description={PRODUCT_CATEGORY}
        size="lg"
      >
        <form action={saveAction} className="flex flex-col gap-4">
          {editing && <input type="hidden" name="id" value={editing.id} />}
          {saveState.error && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {saveState.error}
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Product name" required>
              <Input name="name" defaultValue={editing?.name ?? ''} required />
            </Field>
            <Field label="SKU / internal code" required>
              <Input name="sku" defaultValue={editing?.sku ?? ''} required />
            </Field>
            <Field label="Purchase cost / unit" required>
              <Input
                name="purchaseCost"
                type="number"
                step="0.01"
                min="0"
                defaultValue={editing?.purchaseCost ?? ''}
              />
            </Field>
            <Field label="Selling price / unit">
              <Input
                name="sellingPrice"
                type="number"
                step="0.01"
                min="0"
                defaultValue={editing?.sellingPrice ?? ''}
              />
            </Field>
            <Field label="Minimum stock alert level">
              <Input
                name="minStockLevel"
                type="number"
                min="0"
                defaultValue={editing?.minStockLevel ?? 0}
              />
            </Field>
            {!editing && (
              <Field label="Opening stock" hint="Recorded as an initial stock movement.">
                <Input name="openingStock" type="number" min="0" defaultValue={0} />
              </Field>
            )}
          </div>

          <Field label="Available in stores">
            {stores.length === 0 ? (
              <p className="text-xs text-slate-400">
                No stores yet — create a store first to assign availability.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {stores.map((s) => (
                  <label
                    key={s.id}
                    className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      name="storeIds"
                      value={s.id}
                      defaultChecked={editing?.storeIds.includes(s.id)}
                      className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                    />
                    {s.name}
                  </label>
                ))}
              </div>
            )}
          </Field>

          <Field label="Notes">
            <Textarea name="notes" defaultValue={editing?.notes ?? ''} />
          </Field>

          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              name="active"
              defaultChecked={editing ? editing.active : true}
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            />
            Active
          </label>

          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <SubmitButton>{editing ? 'Save changes' : 'Create product'}</SubmitButton>
          </div>
        </form>
      </Modal>

      {/* Stock adjust */}
      <Modal
        open={stockOpen}
        onClose={() => setStockOpen(false)}
        title="Adjust Stock"
        description={stockProduct?.name}
      >
        <form action={stockActionFn} className="flex flex-col gap-4">
          <input type="hidden" name="productId" value={stockProduct?.id ?? ''} />
          {stockState.error && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {stockState.error}
            </p>
          )}

          {stockProduct && (
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
              Current stock:{' '}
              <span className="font-semibold text-slate-800">
                {formatNumber(stockProduct.currentStock)}
              </span>
            </div>
          )}

          <Field label="Action" required>
            <Select
              name="type"
              value={adjustType}
              onChange={(e) => setAdjustType(e.target.value)}
            >
              {ADJUST_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label={adjustType === 'ADJUST' ? 'New exact stock count' : 'Quantity'}
            required
          >
            <Input name="quantity" type="number" min="0" required />
          </Field>

          {adjustType === 'TRANSFER' ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="From store">
                <Select name="storeId">
                  <option value="">—</option>
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="To store">
                <Select name="toStoreId">
                  <option value="">—</option>
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          ) : (
            <Field label="Store (optional)">
              <Select name="storeId">
                <option value="">—</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <Field label="Note">
            <Input name="note" placeholder="Reason / reference" />
          </Field>

          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setStockOpen(false)}>
              Cancel
            </Button>
            <SubmitButton>Apply</SubmitButton>
          </div>
        </form>
      </Modal>
    </>
  );
}
