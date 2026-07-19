'use client';

import { useActionState, useState } from 'react';
import { UploadCloud, AlertTriangle, Lock, CheckCircle2 } from 'lucide-react';
import { previewImport, type PreviewState } from './actions';
import { Button, SubmitButton } from '@/components/Button';
import {
  Card,
  CardBody,
  CardHeader,
  StatCard,
  Field,
  Input,
  Select,
  Table,
  THead,
  TH,
  TD,
  TRow,
  Badge,
  EmptyState,
} from '@/components/ui';
import { formatMoney, formatNumber } from '@/lib/utils';
import { ALL_FEE_CATEGORIES, FEE_CATEGORY_LABEL } from '@/lib/daraz/fees';
import { MAPPING_UNAVAILABLE as UNAVAILABLE, type Unavailable } from '@/lib/daraz/dryrun';

interface Opt {
  id: string;
  name: string;
  sku: string;
}

const initial: PreviewState = {};

export function ImportManager({ products }: { products: Opt[] }) {
  const [state, action] = useActionState(previewImport, initial);
  // In-session SKU→product picks (dry-run only; not persisted in this build).
  const [picks, setPicks] = useState<Record<string, string>>({});

  const r = state.result;

  return (
    <>
      <div className="mb-5">
        <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
          Daraz Orders &amp; Income Import
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Upload the <strong>All Orders</strong> Excel and the{' '}
          <strong>Income Order Details</strong> CSV. This is a{' '}
          <strong>dry-run preview only</strong> — nothing is written to the database.
        </p>
      </div>

      <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        <Lock className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Owner/Admin only. Uploaded customer, phone, national-ID, address and tracking
          data are treated as confidential — masked in the app and never logged or
          committed. <strong>Import is disabled in this build.</strong>
        </span>
      </div>

      <Card className="mb-5">
        <CardBody>
          <form action={action} className="flex flex-col gap-4">
            {state.error && (
              <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {state.error}
              </p>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="All Orders export (.xlsx)" required>
                <Input type="file" name="ordersFile" accept=".xlsx" required />
              </Field>
              <Field label="Income Order Details (.csv)" required>
                <Input type="file" name="incomeFile" accept=".csv" required />
              </Field>
            </div>
            <div>
              <SubmitButton>
                <UploadCloud className="h-4 w-4" /> Run dry-run
              </SubmitButton>
            </div>
          </form>
        </CardBody>
      </Card>

      {r && (
        <>
          {r.batchAlreadyImported && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-slate-300 bg-slate-100 px-4 py-3 text-sm text-slate-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              This exact file pair was already imported (batch fingerprint match). Re-import
              would be a no-op.
            </div>
          )}

          {/* --- headline counts --- */}
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Income lines" value={formatNumber(r.totals.incomeLines)} hint={`${formatNumber(r.totals.orderItems)} order-items in file`} />
            <StatCard label="Matched" value={formatNumber(r.totals.matched)} tone="positive" hint={`${formatNumber(r.totals.unmatched)} unmatched`} />
            <StatCard label="Unresolved SKUs" value={formatNumber(r.totals.unresolvedSkus)} tone={r.totals.unresolvedSkus ? 'warning' : 'positive'} hint={`${formatNumber(r.totals.resolvedSkus)} resolved`} />
            <StatCard label="Duplicates" value={formatNumber(r.totals.duplicates)} tone={r.totals.duplicates ? 'warning' : 'default'} hint="already imported" />
          </div>

          {/* --- reconciliation --- */}
          <Card className="mb-4">
            <CardHeader title="Reconciliation" subtitle="Calculated net must equal the Daraz-authoritative net." />
            <CardBody>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <Mini label="Units" value={formatNumber(r.totals.units)} />
                <Mini label="Total credits" value={formatMoney(r.totals.totalCredits)} />
                <Mini label="Total deductions" value={formatMoney(r.totals.totalDeductions)} tone="neg" />
                <Mini label="Calculated net" value={formatMoney(r.totals.calculatedNet)} />
                <Mini label="Daraz net" value={formatMoney(r.totals.darazNet)} />
                <Mini
                  label="Difference"
                  value={formatMoney(r.totals.reconDiff)}
                  tone={r.totals.reconDiff === 0 ? 'ok' : 'neg'}
                />
              </div>
              {r.totals.reconDiff === 0 ? (
                <p className="mt-3 flex items-center gap-1.5 text-sm text-emerald-600">
                  <CheckCircle2 className="h-4 w-4" /> Exact reconciliation — every line matches Daraz net.
                </p>
              ) : (
                <p className="mt-3 text-sm text-rose-600">
                  Reconciliation difference detected — do not import until resolved.
                </p>
              )}
            </CardBody>
          </Card>

          {/* --- fee categories (every category, credit/deduction/net) --- */}
          <Card className="mb-4">
            <CardHeader
              title="Fee categories — full reconciliation"
              subtitle="Every credit, deduction, VAT and tax category shown with its gross credit, gross deduction and net. Nothing is bucketed away."
            />
            <CardBody className="p-0">
              <Table>
                <THead>
                  <TRow>
                    <TH>Category</TH>
                    <TH align="right">Credit (Rs)</TH>
                    <TH align="right">Deduction (Rs)</TH>
                    <TH align="right">Net (Rs)</TH>
                  </TRow>
                </THead>
                <tbody>
                  {ALL_FEE_CATEGORIES.map((c) => {
                    const credit = r.totals.feeCreditByCategory[c];
                    const deduct = r.totals.feeDeductionByCategory[c];
                    const net = r.totals.feesByCategory[c];
                    if (credit === 0 && deduct === 0 && net === 0) return null;
                    return (
                      <TRow key={c}>
                        <TD className="font-medium">{FEE_CATEGORY_LABEL[c]}</TD>
                        <TD align="right">{credit ? formatMoney(credit) : '—'}</TD>
                        <TD align="right" className="text-rose-600">
                          {deduct ? formatMoney(deduct) : '—'}
                        </TD>
                        <TD align="right" className={net < 0 ? 'text-rose-600' : ''}>
                          {formatMoney(net)}
                        </TD>
                      </TRow>
                    );
                  })}
                </tbody>
                <tfoot>
                  <TRow className="border-t-2 border-slate-200 font-semibold">
                    <TD>Totals</TD>
                    <TD align="right">{formatMoney(r.totals.totalCredits)}</TD>
                    <TD align="right" className="text-rose-600">{formatMoney(r.totals.totalDeductions)}</TD>
                    <TD align="right">{formatMoney(r.totals.darazNet)}</TD>
                  </TRow>
                </tfoot>
              </Table>
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs text-slate-500">
                <span>VAT included in amounts (informational): {formatMoney(r.totals.vatTotal)}</span>
                <span
                  className={
                    r.totals.categorySumCheck === 0 ? 'text-emerald-600' : 'text-rose-600'
                  }
                >
                  Σ category net − Daraz net = {formatMoney(r.totals.categorySumCheck)}
                  {r.totals.categorySumCheck === 0 ? ' ✓ no unexplained balance' : ' — mismatch'}
                </span>
              </div>
            </CardBody>
          </Card>

          {/* --- unresolved SKU mapping --- */}
          <Card className="mb-4">
            <CardHeader
              title={`Unresolved Seller SKUs (${r.unresolvedSkuList.length})`}
              subtitle="Map each Seller SKU to a ledger Product. Never guessed from names. Persisted on import (disabled here)."
            />
            <CardBody className="p-0">
              {r.unresolvedSkuList.length === 0 ? (
                <div className="p-5 text-sm text-emerald-600">All Seller SKUs resolve to a ledger product.</div>
              ) : (
                <Table>
                  <THead>
                    <TRow>
                      <TH>Seller SKU</TH>
                      <TH>Daraz product</TH>
                      <TH align="center">Lines</TH>
                      <TH>Map to ledger product</TH>
                    </TRow>
                  </THead>
                  <tbody>
                    {r.unresolvedSkuList.map((u) => (
                      <TRow key={u.sellerSku}>
                        <TD className="font-mono text-xs">{u.sellerSku || '—'}</TD>
                        <TD className="max-w-[260px] truncate text-slate-500">{u.productName}</TD>
                        <TD align="center">{u.lines}</TD>
                        <TD>
                          <Select
                            value={picks[u.sellerSku] ?? ''}
                            onChange={(e) => setPicks((p) => ({ ...p, [u.sellerSku]: e.target.value }))}
                          >
                            <option value="">— leave blocked —</option>
                            {products.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name} ({p.sku})
                              </option>
                            ))}
                          </Select>
                        </TD>
                      </TRow>
                    ))}
                  </tbody>
                </Table>
              )}
            </CardBody>
          </Card>

          {/* --- stock impact --- */}
          <Card className="mb-4">
            <CardHeader
              title="Projected stock impact"
              subtitle="Delivered, resolved units deduct sellable stock. Returned units are handled by the Returns module."
            />
            <CardBody className="p-0">
              {!r.stockProjectionAvailable || !Array.isArray(r.stockImpact) ? (
                <div className="flex items-start gap-2 p-5 text-sm text-amber-700">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    <strong>{UNAVAILABLE}.</strong> {formatNumber(r.totals.unresolvedSkus)} Seller
                    SKU(s) are unmapped, so stock impact cannot be determined and no
                    negative-stock check can be run. Map every SKU above first.
                  </span>
                </div>
              ) : r.stockImpact.length === 0 ? (
                <div className="p-5 text-sm text-slate-500">No resolved delivered units to deduct.</div>
              ) : (
                <Table>
                  <THead>
                    <TRow>
                      <TH>Product</TH>
                      <TH align="right">Current</TH>
                      <TH align="right">Units out</TH>
                      <TH align="right">Projected</TH>
                      <TH align="center">Status</TH>
                    </TRow>
                  </THead>
                  <tbody>
                    {r.stockImpact.map((s) => (
                      <TRow key={s.productId}>
                        <TD>{s.name} <span className="text-xs text-slate-400">({s.sku})</span></TD>
                        <TD align="right">{s.currentStock}</TD>
                        <TD align="right">−{s.unitsOut}</TD>
                        <TD align="right" className={s.negativeBlocker ? 'font-semibold text-rose-600' : ''}>{s.projectedStock}</TD>
                        <TD align="center">
                          {s.negativeBlocker ? <Badge tone="red">Negative — blocked</Badge> : <Badge tone="green">OK</Badge>}
                        </TD>
                      </TRow>
                    ))}
                  </tbody>
                </Table>
              )}
            </CardBody>
          </Card>

          {/* --- P&L projection --- */}
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Product revenue" value={formatMoney(r.totals.productRevenue)} />
            <ProjectionCard label="Projected COGS" value={r.totals.projectedCOGS} tone="negative" hint="delivered units × unit cost" />
            <ProjectionCard label="Projected gross profit" value={r.totals.projectedGrossProfit} tone="positive" />
            <StatCard label="Net payout (Daraz)" value={formatMoney(r.totals.darazNet)} />
          </div>

          {Array.isArray(r.negativeStockBlockers) && r.negativeStockBlockers.length > 0 && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {r.negativeStockBlockers.length} product(s) would go negative on import — blocked until stock is corrected.
            </div>
          )}

          {/* --- import (disabled) --- */}
          <Card>
            <CardBody className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-slate-600">
                <strong>{formatNumber(r.totals.importable)}</strong> line(s) importable
                (matched, SKU-resolved, not duplicate);{' '}
                <strong>{formatNumber(r.totals.blocked)}</strong> blocked.
                {!r.mappingComplete && (
                  <span className="text-amber-700">
                    {' '}All lines remain blocked until every Seller SKU is mapped.
                  </span>
                )}
              </div>
              <Button disabled title="Import is disabled in this build">
                <Lock className="h-4 w-4" /> Import (disabled)
              </Button>
            </CardBody>
          </Card>
        </>
      )}

      {!r && (
        <EmptyState
          icon={<UploadCloud className="h-10 w-10" />}
          title="No preview yet"
          message="Upload both files and run a dry-run to see the full matching, reconciliation, SKU mapping and stock/P&L projection."
        />
      )}
    </>
  );
}

function ProjectionCard({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: number | Unavailable;
  tone?: 'positive' | 'negative';
  hint?: string;
}) {
  if (typeof value !== 'number') {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <p className="text-[11px] uppercase tracking-wide text-amber-700">{label}</p>
        <p className="mt-1 text-sm font-medium text-amber-800">Cannot calculate</p>
        <p className="mt-0.5 text-[11px] text-amber-600">until product mapping is completed</p>
      </div>
    );
  }
  return <StatCard label={label} value={formatMoney(value)} tone={tone} hint={hint} />;
}

function Mini({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'neg' }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <p
        className={`text-sm font-semibold tabular-nums ${
          tone === 'ok' ? 'text-emerald-600' : tone === 'neg' ? 'text-rose-600' : 'text-slate-800'
        }`}
      >
        {value}
      </p>
    </div>
  );
}
