import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';

// Presentational-only building blocks for the Dashboard redesign. No data, no
// business logic — the page supplies already-computed, already-formatted values.
// Kept local to the Dashboard route so the shared UI kit (and every other page)
// is untouched.

export type KpiTone = 'brand' | 'positive' | 'warning' | 'negative' | 'default';

const TONES: Record<KpiTone, { chip: string; value: string; border: string }> = {
  brand: { chip: 'bg-brand-50 text-brand-600', value: 'text-slate-900', border: 'hover:border-brand-300' },
  positive: { chip: 'bg-emerald-50 text-emerald-600', value: 'text-emerald-600', border: 'hover:border-emerald-300' },
  warning: { chip: 'bg-amber-50 text-amber-600', value: 'text-amber-600', border: 'hover:border-amber-300' },
  negative: { chip: 'bg-rose-50 text-rose-600', value: 'text-rose-600', border: 'hover:border-rose-300' },
  default: { chip: 'bg-slate-100 text-slate-500', value: 'text-slate-900', border: 'hover:border-slate-300' },
};

/**
 * A premium KPI tile: tinted icon chip, uppercase label, large tabular figure,
 * and a hint line. The whole tile links to a related page; an arrow reveals on
 * hover to signal that. Colour is used semantically only (green = positive,
 * amber = pending/warning, red = cost/negative, blue = brand/neutral emphasis).
 */
export function KpiCard({
  href,
  label,
  value,
  hint,
  icon,
  tone = 'default',
}: {
  href: string;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon: ReactNode;
  tone?: KpiTone;
}) {
  const t = TONES[tone];
  return (
    <Link
      href={href}
      className={cn(
        'group relative flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-card transition',
        'hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
        t.border
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span className={cn('flex h-10 w-10 items-center justify-center rounded-xl', t.chip)}>{icon}</span>
        <ArrowUpRight className="h-4 w-4 text-slate-300 opacity-0 transition group-hover:opacity-100" aria-hidden="true" />
      </div>
      <p className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className={cn('mt-1 text-2xl font-bold tabular-nums sm:text-[1.7rem] sm:leading-9', t.value)}>{value}</p>
      {hint && <p className="mt-1.5 text-xs text-slate-400">{hint}</p>}
    </Link>
  );
}

/** A section heading with a tinted icon chip, title and supporting note. */
export function SectionHeader({
  icon,
  tone = 'brand',
  title,
  note,
}: {
  icon: ReactNode;
  tone?: KpiTone;
  title: string;
  note: ReactNode;
}) {
  const t = TONES[tone];
  return (
    <div className="mb-4 flex items-start gap-3">
      <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', t.chip)}>{icon}</span>
      <div>
        <h2 className="text-base font-semibold tracking-tight text-slate-900 sm:text-lg">{title}</h2>
        <p className="mt-0.5 max-w-3xl text-sm leading-relaxed text-slate-500">{note}</p>
      </div>
    </div>
  );
}
