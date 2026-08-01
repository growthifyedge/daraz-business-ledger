import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The single, subtle label that marks every simulated demo result. Kept as one
 * exported constant + component so the wording is identical everywhere and the
 * tests can assert it. Deliberately understated — a small pill, not a warning
 * box — so the demo still looks like a capable working ERP.
 */
export const DEMO_NOTICE = 'Demo simulation — no live records changed.';

export function DemoBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600',
        className
      )}
    >
      <Sparkles className="h-3 w-3 text-brand-500" aria-hidden="true" />
      {DEMO_NOTICE}
    </span>
  );
}
