'use client';

import { useState, useTransition } from 'react';
import { UploadCloud, AlertTriangle, Lock, CheckCircle2, ShieldCheck, Database } from 'lucide-react';
import { Button } from '@/components/Button';
import {
  Card,
  CardBody,
  CardHeader,
  StatCard,
  Field,
  Input,
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
import {
  MAPPING_UNAVAILABLE as UNAVAILABLE,
  type DryRunResult,
  type Unavailable,
} from '@/lib/daraz/dryrun';

interface PreviewMeta {
  ordersFileName: string;
  incomeFileName: string;
  fingerprint: string;
  ordersRows: number;
  incomeFeeRows: number;
  alreadyCommitted: boolean;
}

interface CommitSummary {
  batchId: string;
  orderItems: number;
  customers: number;
  incomeLines: number;
  fees: number;
  distinctOrderItemIds: number;
  statementCount: number;
  netPayout: number;
  reconDiff: number;
}

export function ImportManager({
  piiKeyReady,
  hasCommittedImport,
}: {
  piiKeyReady: boolean;
  hasCommittedImport: boolean;
}) {
  const [files, setFiles] = useState<{ orders: File | null; income: File | null }>({
    orders: null,
    income: null,
  });
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ result: DryRunResult; meta: PreviewMeta } | null>(null);
  const [committed, setCommitted] = useState<CommitSummary | 'already' | null>(null);
  const [pending, startTransition] = useTransition();
  const [committing, setCommitting] = useState(false);

  const r = preview?.result;

  function buildForm(): FormData | null {
    if (!files.orders || !files.income) {
      setError('Select both the Orders .xlsx and the Income .csv.');
      return null;
    }
    const fd = new FormData();
    fd.append('ordersFile', files.orders);
    fd.append('incomeFile', files.income);
    return fd;
  }

  function runPreview() {
    setError(null);
    setCommitted(null);
    const fd = buildForm();
    if (!fd) return;
    startTransition(async () => {
      try {
        const res = await fetch('/api/daraz-import/preview', { method: 'POST', body: fd });
        const json = await res.json();
        if (!res.ok || !json.ok) {
          setPreview(null);
          setError(json.error || 'Preview failed.');
          return;
        }
        setPreview({ result: json.result, meta: json.meta });
      } catch {
        setError('Network error while previewing.');
      }
    });
  }

  function runCommit() {
    setError(null);
    const fd = buildForm();
    if (!fd) return;
    setCommitting(true);
    (async () => {
      try {
        const res = await fetch('/api/daraz-import/commit', { method: 'POST', body: fd });
        const json = await res.json();
        if (!res.ok || !json.ok) {
          setError(json.error || 'Import failed.');
          return;
        }
        setCommitted(json.alreadyImported ? 'already' : json.summary);
      } catch {
        setError('Network error during import.');
      } finally {
        setCommitting(false);
      }
    })();
  }

  return (
    <>
      <div className="mb-5">
        <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
          Daraz Orders &amp; Income Import
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Upload the <strong>All Orders</strong> Excel and the{' '}
          <strong>Income Order Details</strong> CSV. Preview first; importing writes
          statements, orders and encrypted customer data — but never posts stock, COGS or
          P&amp;L until Seller SKUs are mapped.
        </p>
      </div>

      <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        <Lock className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Owner only. Customer, phone, national-ID, address and tracking data are
          encrypted at rest (AES-256-GCM) and masked in the app — never logged, never
          committed, never in audit values.
        </span>
      </div>

      {!piiKeyReady && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <strong>PII encryption key not configured.</strong> Customer import is disabled
            until <code>DARAZ_PII_KEY</code> is set in the environment.
          </span>
        </div>
      )}

      <Card className="mb-5">
        <CardBody>
          <div className="flex flex-col gap-4">
            {error && (
              <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="All Orders export (.xlsx, ≤3 MB)" required>
                <Input
                  type="file"
                  accept=".xlsx"
                  onChange={(e) => setFiles((f) => ({ ...f, orders: e.target.files?.[0] ?? null }))}
                />
              </Field>
              <Field label="Income Order Details (.csv, ≤3 MB)" required>
                <Input
                  type="file"
                  accept=".csv"
                  onChange={(e) => setFiles((f) => ({ ...f, income: e.target.files?.[0] ?? null }))}
                />
              </Field>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={runPreview} disabled={pending || committing}>
                <UploadCloud className="h-4 w-4" /> {pending ? 'Previewing…' : 'Run dry-run'}
              </Button>
            </div>
          </div>
        </CardBody>
      </Card>

      {committed && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          {committed === 'already' ? (
            <span>These exact files were already imported — no duplicates created.</span>
          ) : (
            <span>
              Imported <strong>{formatNumber(committed.orderItems)}</strong> orders,{' '}
              <strong>{formatNumber(committed.incomeLines)}</strong> statement lines across{' '}
              <strong>{committed.statementCount}</strong> statements. Net{' '}
              <strong>{formatMoney(committed.netPayout)}</strong>. No stock/COGS/P&amp;L posted.
            </span>
          )}
        </div>
      )}

      {r && (
        <>
          {preview?.meta.alreadyCommitted && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-slate-300 bg-slate-100 px-4 py-3 text-sm text-slate-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              This exact file pair was already imported (batch fingerprint match). Re-import
              is a no-op.
            </div>
          )}

          {/* --- what WILL and WON'T happen on import --- */}
          <Card className="mb-4">
            <CardHeader title="What import will do" subtitle="Financial and customer records import now; inventory waits for mapping." />
            <CardBody className="grid gap-2 sm:grid-cols-3">
              <PostureRow label="Financial statements imported" value="Yes" tone="ok" />
              <PostureRow label="Orders / customers imported" value="Yes" tone="ok" />
              <PostureRow
                label="Inventory & P&L posted"
                value={r.mappingComplete ? 'Yes' : 'No — waiting for product mapping'}
                tone={r.mappingComplete ? 'ok' : 'wait'}
              />
            </CardBody>
          </Card>

          {/* --- headline counts --- */}
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Statement lines" value={formatNumber(r.totals.incomeLines)} hint={`${formatNumber(r.totals.statementCount)} statements`} />
            <StatCard label="Distinct order-item IDs" value={formatNumber(r.totals.distinctOrderItemIds)} hint={`${formatNumber(r.totals.orderItems)} order rows`} />
            <StatCard label="Matched" value={`${formatNumber(r.totals.matched)} / ${formatNumber(r.totals.distinctOrderItemIds)}`} tone="positive" hint={`${formatNumber(r.totals.unmatched)} unmatched`} />
            <StatCard label="Unresolved SKUs" value={formatNumber(r.totals.unresolvedSkus)} tone={r.totals.unresolvedSkus ? 'warning' : 'positive'} hint={`${formatNumber(r.totals.duplicates)} duplicates`} />
          </div>

          {/* --- reconciliation --- */}
          <Card className="mb-4">
            <CardHeader title="Reconciliation" subtitle="Calculated net must equal the Daraz-authoritative net." />
            <CardBody>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <Mini label="Distinct units" value={formatNumber(r.totals.units)} />
                <Mini label="Total credits" value={formatMoney(r.totals.totalCredits)} />
                <Mini label="Total deductions" value={formatMoney(r.totals.totalDeductions)} tone="neg" />
                <Mini label="Calculated net" value={formatMoney(r.totals.calculatedNet)} />
                <Mini label="Daraz net" value={formatMoney(r.totals.darazNet)} />
                <Mini label="Difference" value={formatMoney(r.totals.reconDiff)} tone={r.totals.reconDiff === 0 ? 'ok' : 'neg'} />
              </div>
              {r.totals.reconDiff === 0 ? (
                <p className="mt-3 flex items-center gap-1.5 text-sm text-emerald-600">
                  <CheckCircle2 className="h-4 w-4" /> Exact reconciliation — every line matches Daraz net.
                </p>
              ) : (
                <p className="mt-3 text-sm text-rose-600">
                  Reconciliation difference detected — import will roll back until resolved.
                </p>
              )}
            </CardBody>
          </Card>

          {/* --- fee categories --- */}
          <Card className="mb-4">
            <CardHeader
              title="Fee categories — full reconciliation"
              subtitle="Every credit, deduction, VAT and tax category with its gross credit, gross deduction and net."
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
                        <TD align="right" className="text-rose-600">{deduct ? formatMoney(deduct) : '—'}</TD>
                        <TD align="right" className={net < 0 ? 'text-rose-600' : ''}>{formatMoney(net)}</TD>
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
                <span className={r.totals.categorySumCheck === 0 ? 'text-emerald-600' : 'text-rose-600'}>
                  Σ category net − Daraz net = {formatMoney(r.totals.categorySumCheck)}
                  {r.totals.categorySumCheck === 0 ? ' ✓ no unexplained balance' : ' — mismatch'}
                </span>
              </div>
            </CardBody>
          </Card>

          {/* --- unresolved SKUs (informational; import does NOT wait) --- */}
          <Card className="mb-4">
            <CardHeader
              title={`Unresolved Seller SKUs (${r.unresolvedSkuList.length})`}
              subtitle="Statements, orders and customers import now with productId = null. Map each SKU (Products → mapping) to later post stock/COGS/P&L."
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
                      <TH align="center">Units</TH>
                    </TRow>
                  </THead>
                  <tbody>
                    {r.unresolvedSkuList.map((u) => (
                      <TRow key={u.sellerSku}>
                        <TD className="font-mono text-xs">{u.sellerSku || '—'}</TD>
                        <TD className="max-w-[320px] truncate text-slate-500">{u.productName}</TD>
                        <TD align="center">{u.units}</TD>
                      </TRow>
                    ))}
                  </tbody>
                </Table>
              )}
            </CardBody>
          </Card>

          {/* --- stock impact (unavailable until mapped) --- */}
          <Card className="mb-4">
            <CardHeader title="Projected stock impact" subtitle="Delivered, mapped units deduct sellable stock. Not posted by this import." />
            <CardBody className="p-0">
              {!r.stockProjectionAvailable || !Array.isArray(r.stockImpact) ? (
                <div className="flex items-start gap-2 p-5 text-sm text-amber-700">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    <strong>{UNAVAILABLE}.</strong> {formatNumber(r.totals.unresolvedSkus)} Seller
                    SKU(s) are unmapped — stock/COGS/profit cannot be determined and none will be
                    posted.
                  </span>
                </div>
              ) : r.stockImpact.length === 0 ? (
                <div className="p-5 text-sm text-slate-500">No mapped delivered units to deduct.</div>
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
                          {s.negativeBlocker ? <Badge tone="red">Negative</Badge> : <Badge tone="green">OK</Badge>}
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

          {/* --- import action --- */}
          <Card>
            <CardBody className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-slate-600">
                Imports <strong>{formatNumber(r.totals.distinctOrderItemIds)}</strong> orders +{' '}
                <strong>{formatNumber(r.totals.incomeLines)}</strong> statement lines. Re-uploading
                identical files is a safe no-op.
              </div>
              <Button
                onClick={runCommit}
                disabled={
                  committing ||
                  !piiKeyReady ||
                  r.totals.reconDiff !== 0 ||
                  r.totals.unmatched > 0 ||
                  preview?.meta.alreadyCommitted
                }
                title={!piiKeyReady ? 'PII key not configured' : 'Import statements + orders + customers'}
              >
                <Database className="h-4 w-4" /> {committing ? 'Importing…' : 'Import statements + orders'}
              </Button>
            </CardBody>
          </Card>
        </>
      )}

      {!r && (
        <EmptyState
          icon={<UploadCloud className="h-10 w-10" />}
          title="No preview yet"
          message="Upload both files and run a dry-run to see matching, reconciliation, statement lines, SKU status and the stock/P&L posture."
        />
      )}

      {hasCommittedImport && !committed && (
        <p className="mt-4 text-xs text-slate-400">A prior import exists. Re-uploading the same files will not duplicate.</p>
      )}
    </>
  );
}

function PostureRow({ label, value, tone }: { label: string; value: string; tone: 'ok' | 'wait' }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${tone === 'ok' ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`text-sm font-semibold ${tone === 'ok' ? 'text-emerald-700' : 'text-amber-700'}`}>{value}</p>
    </div>
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
      <p className={`text-sm font-semibold tabular-nums ${tone === 'ok' ? 'text-emerald-600' : tone === 'neg' ? 'text-rose-600' : 'text-slate-800'}`}>
        {value}
      </p>
    </div>
  );
}
