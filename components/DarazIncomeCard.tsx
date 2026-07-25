import { Card, CardBody, CardHeader, Badge } from '@/components/ui';
import { formatMoney, formatNumber } from '@/lib/utils';
import type { DarazIncomeRollup } from '@/lib/daraz/income';

/**
 * Presentational summary of the imported Daraz income channel, clearly labelled
 * as source "Daraz Import" (distinct from manually-entered Sales/Settlements).
 * Shows the reconciled net and its fee breakdown. Read-only; no calculations.
 */
export function DarazIncomeCard({ rollup, subtitle }: { rollup: DarazIncomeRollup; subtitle?: string }) {
  const r = rollup;
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            Daraz Import income
            <Badge tone="blue">Source: Daraz Import</Badge>
          </span>
        }
        subtitle={
          subtitle ??
          `${formatNumber(r.statements)} statement(s) · ${formatNumber(r.lines)} lines · ${formatNumber(r.orderItems)} order lines`
        }
      />
      <CardBody className="p-0">
        <dl className="divide-y divide-slate-100 text-sm">
          <Row label="Gross revenue (buyer-paid)" value={r.grossRevenue} />
          <Row label="Daraz fees (commission, payment, shipping, handling, coins, voucher…)" value={r.darazFees} deduction />
          <Row label="Taxes withheld (income + sales)" value={r.taxesWithheld} deduction />
          <Row label="Refunds (already in Daraz net — not deducted again via Returns)" value={r.refunds} deduction />
          <Row label="Reversals (credit)" value={r.reversals} />
          {r.otherFees !== 0 && <Row label="Other (uncategorised — review)" value={r.otherFees} />}
          <div className="flex items-center justify-between gap-3 border-t-2 border-slate-300 px-4 py-3">
            <dt className="text-sm font-bold uppercase tracking-wide text-slate-800">Daraz net</dt>
            <dd className="text-lg font-bold tabular-nums text-brand-700">{formatMoney(r.net)}</dd>
          </div>
        </dl>
        <p className="px-4 py-2 text-xs text-slate-400">
          {r.reconciles ? (
            <span className="text-emerald-600">✓ Reconciles: category totals equal the Daraz net exactly.</span>
          ) : (
            <span className="text-rose-600">Reconciliation difference: {formatMoney(r.reconDiff)}.</span>
          )}{' '}
          Product cost (COGS) for these orders is not applied here.
        </p>
      </CardBody>
    </Card>
  );
}

function Row({ label, value, deduction }: { label: string; value: number; deduction?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5">
      <dt className="text-slate-600">{label}</dt>
      <dd className={`tabular-nums ${deduction || value < 0 ? 'text-rose-600' : 'text-slate-800'}`}>
        {formatMoney(value)}
      </dd>
    </div>
  );
}
