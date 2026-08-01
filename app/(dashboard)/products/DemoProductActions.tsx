'use client';

import { useMemo, useRef, useState } from 'react';
import { Plus, PackagePlus, Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { Card, CardBody, Field, Input, Select, Badge, Table, THead, TH, TD, TRow } from '@/components/ui';
import { useDemoSimulation } from '@/lib/presentation/demo/useDemoSimulation';
import { useDemoCollection } from '@/lib/presentation/demo/useDemoCollection';
import { DemoActionResult } from '@/components/demo/DemoActionResult';
import { DemoBadge } from '@/components/demo/DemoBadge';

const CATEGORIES = ['Lifestyle Gadgets', 'Audio', 'Charging', 'Home', 'Accessories'];
const MOVE_TYPES = ['ADD', 'PURCHASE', 'RETURNED'];

type DemoProduct = { id: string; name: string; sku: string; category: string; stock: number; active: boolean };
type DemoMovement = { id: string; date: string; product: string; type: string; quantity: number };

/**
 * Demo-only Products & Inventory actions shown inside active Presentation Safe
 * View: "Add Product" and "Add Stock". Both append to in-memory lists and show a
 * running demo stock tally — no real product is created, no stock moves, no
 * server action is called. No real cost / supplier / note value is used or shown.
 */
export function DemoProductActions({ productNames }: { productNames: string[] }) {
  const [mode, setMode] = useState<null | 'product' | 'stock'>(null);
  const product = useDemoSimulation();
  const stock = useDemoSimulation();
  const products = useDemoCollection<DemoProduct>();
  const movements = useDemoCollection<DemoMovement>();
  const seq = useRef(0);

  const stockOptions = useMemo(
    () => Array.from(new Set([...products.items.map((p) => p.name), ...productNames])),
    [products.items, productNames]
  );
  const stockAdded = movements.items.reduce((s, m) => s + m.quantity, 0);
  const hasChanges = products.count > 0 || movements.count > 0;

  function openProduct() {
    product.reset();
    setMode('product');
  }
  function openStock() {
    stock.reset();
    setMode('stock');
  }
  function close() {
    setMode(null);
    product.reset();
    stock.reset();
  }
  function resetAll() {
    products.reset();
    movements.reset();
  }

  function submitProduct(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const n = ++seq.current;
    products.add({
      id: `demo-product-${n}`,
      name: String(f.get('name') || `Demo Product ${n}`),
      sku: String(f.get('sku') || `DEMO-SKU-${100 + n}`),
      category: String(f.get('category') || CATEGORIES[0]),
      stock: Number(f.get('stock') || 0),
      active: true,
    });
    product.run();
  }

  function submitStock(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const n = ++seq.current;
    movements.add({
      id: `demo-move-${n}`,
      date: String(f.get('date') || '2026-01-25'),
      product: String(f.get('product') || stockOptions[0] || 'Demo Product'),
      type: String(f.get('type') || 'ADD'),
      quantity: Number(f.get('quantity') || 0),
    });
    stock.run();
  }

  return (
    <section aria-labelledby="demo-products-heading" className="mt-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 id="demo-products-heading" className="text-sm font-semibold text-slate-800">
          Demo actions
        </h2>
        <DemoBadge />
        {stockAdded > 0 && (
          <span className="text-xs font-medium text-emerald-700">Demo stock added: +{stockAdded} units</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {hasChanges && (
            <Button variant="outline" size="sm" onClick={resetAll}>
              <RotateCcw className="h-3.5 w-3.5" /> Reset demo changes
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={openStock}>
            <PackagePlus className="h-4 w-4" /> Add Stock
          </Button>
          <Button size="sm" onClick={openProduct}>
            <Plus className="h-4 w-4" /> Add Product
          </Button>
        </div>
      </div>

      {products.count > 0 && (
        <Card className="mb-3">
          <CardBody className="p-0">
            <Table>
              <THead>
                <TRow>
                  <TH>Product</TH>
                  <TH>SKU</TH>
                  <TH>Category</TH>
                  <TH align="right">Stock</TH>
                  <TH>Status</TH>
                </TRow>
              </THead>
              <tbody>
                {products.items.map((p) => (
                  <TRow key={p.id}>
                    <TD className="font-medium">{p.name}</TD>
                    <TD className="font-mono text-xs text-slate-500">{p.sku}</TD>
                    <TD>{p.category}</TD>
                    <TD align="right">{p.stock}</TD>
                    <TD><Badge tone="green">Active</Badge></TD>
                  </TRow>
                ))}
              </tbody>
            </Table>
          </CardBody>
        </Card>
      )}

      {movements.count > 0 && (
        <Card>
          <CardBody className="p-0">
            <Table>
              <THead>
                <TRow>
                  <TH>Date</TH>
                  <TH>Product</TH>
                  <TH>Type</TH>
                  <TH align="right">Change</TH>
                </TRow>
              </THead>
              <tbody>
                {movements.items.map((m) => (
                  <TRow key={m.id}>
                    <TD>{m.date}</TD>
                    <TD>{m.product}</TD>
                    <TD><Badge tone="slate">{m.type}</Badge></TD>
                    <TD align="right" className="text-emerald-600">+{m.quantity}</TD>
                  </TRow>
                ))}
              </tbody>
            </Table>
          </CardBody>
        </Card>
      )}

      {/* Add Product */}
      <Modal
        open={mode === 'product'}
        onClose={close}
        title="Add Product"
        description="Demonstration form — no live records are created."
        size="lg"
      >
        {product.status === 'success' ? (
          <div className="flex flex-col gap-4">
            <DemoActionResult title="Demo product added successfully" subtitle="It appears in the demo additions below." />
            <div className="flex justify-end"><Button onClick={close}>Done</Button></div>
          </div>
        ) : (
          <form onSubmit={submitProduct} className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Product name" required>
                <Input name="name" defaultValue="New Demo Product" />
              </Field>
              <Field label="SKU / internal code" required>
                <Input name="sku" defaultValue="DEMO-SKU-200" />
              </Field>
              <Field label="Category">
                <Select name="category" defaultValue={CATEGORIES[0]}>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Opening stock">
                <Input name="stock" type="number" min="0" defaultValue={25} />
              </Field>
            </div>
            <DemoBadge />
            <div className="mt-2 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={close}>Cancel</Button>
              <Button type="submit" disabled={product.status === 'pending'}>
                {product.status === 'pending' && <Loader2 className="h-4 w-4 animate-spin" />}
                {product.status === 'pending' ? 'Adding…' : 'Add product'}
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* Add Stock */}
      <Modal
        open={mode === 'stock'}
        onClose={close}
        title="Add Stock"
        description="Demonstration form — no live inventory is changed."
        size="lg"
      >
        {stock.status === 'success' ? (
          <div className="flex flex-col gap-4">
            <DemoActionResult title="Demo stock recorded successfully" subtitle="The demo stock tally updated above." />
            <div className="flex justify-end"><Button onClick={close}>Done</Button></div>
          </div>
        ) : (
          <form onSubmit={submitStock} className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Product" required>
                <Select name="product" defaultValue={stockOptions[0] ?? ''}>
                  {stockOptions.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Movement type">
                <Select name="type" defaultValue="ADD">
                  {MOVE_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Quantity" required>
                <Input name="quantity" type="number" min="1" defaultValue={10} />
              </Field>
              <Field label="Date">
                <Input name="date" type="date" defaultValue="2026-01-25" />
              </Field>
            </div>
            <DemoBadge />
            <div className="mt-2 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={close}>Cancel</Button>
              <Button type="submit" disabled={stock.status === 'pending'}>
                {stock.status === 'pending' && <Loader2 className="h-4 w-4 animate-spin" />}
                {stock.status === 'pending' ? 'Recording…' : 'Record inventory'}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </section>
  );
}
