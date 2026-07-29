import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowUpRight, ChevronRight, AlertTriangle } from 'lucide-react';
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

/**
 * One triage row for the "Needs attention" panel. The page decides whether an
 * item exists at all (each is gated on real dashboard data); this only renders
 * what it is given. Meaning is carried by icon + text + colour together, never
 * colour alone.
 */
export type AttentionItem = {
  tone: KpiTone;
  icon: ReactNode;
  title: string;
  description: string;
  href: string;
  actionLabel: string;
};

/**
 * A compact triage panel surfaced only when something genuinely needs the
 * owner's attention. Renders nothing when the list is empty, so a clean
 * business shows no panel at all.
 */
export function NeedsAttention({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) return null;
  return (
    <section
      aria-labelledby="needs-attention-heading"
      className="mb-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-card"
    >
      <div className="mb-4 flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
        </span>
        <h2 id="needs-attention-heading" className="text-base font-semibold tracking-tight text-slate-900">
          Needs attention
        </h2>
        <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-500">
          {items.length}
        </span>
      </div>
      <ul className="flex flex-col gap-2">
        {items.map((item, i) => {
          const t = TONES[item.tone];
          return (
            <li key={i}>
              <Link
                href={item.href}
                className="group flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/70 p-3 transition hover:border-slate-200 hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', t.chip)}>
                  {item.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-slate-900">{item.title}</span>
                  <span className="block text-sm text-slate-500">{item.description}</span>
                </span>
                <span className="ml-auto hidden shrink-0 items-center gap-1 text-sm font-semibold text-brand-600 group-hover:text-brand-700 sm:inline-flex">
                  {item.actionLabel}
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-slate-400 sm:hidden" aria-hidden="true" />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** A single shortcut tile in the Quick actions row. */
export type QuickAction = { href: string; label: string; icon: ReactNode };

/**
 * A compact row of shortcuts to the pages an owner reaches most often. Links
 * only — no mutations happen here, the destination pages own those.
 */
export function QuickActions({ actions }: { actions: QuickAction[] }) {
  return (
    <section aria-labelledby="quick-actions-heading" className="mb-9">
      <h2
        id="quick-actions-heading"
        className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500"
      >
        Quick actions
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {actions.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className="group flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-card transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 transition group-hover:bg-brand-100">
              {a.icon}
            </span>
            <span className="text-sm font-semibold text-slate-700 group-hover:text-slate-900">{a.label}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
