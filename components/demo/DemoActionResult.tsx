import { CheckCircle2 } from 'lucide-react';
import { DemoBadge } from './DemoBadge';

/**
 * A polished, satisfying completion state for a simulated demo action. Reused by
 * every demo flow so the success moment looks consistent and intentional.
 */
export function DemoActionResult({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-6 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-8 ring-emerald-50/60">
        <CheckCircle2 className="h-7 w-7" aria-hidden="true" />
      </span>
      <div>
        <p className="text-base font-semibold text-slate-900">{title}</p>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      <DemoBadge className="mt-1" />
    </div>
  );
}
