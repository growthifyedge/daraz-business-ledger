'use client';

import { useEffect, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { storeHref, isStoreSwitchBlocked } from '@/lib/dashboard';

export interface StoreOption {
  id: string | null;
  label: string;
}

/**
 * Client wrapper for the Dashboard: renders the store filter and keeps the
 * server-rendered figures ({children}) mounted but visibly dimmed while a store
 * switch is loading. Switching uses a router transition, so the previous numbers
 * stay on screen (never blank) until the new server render arrives.
 *
 * The heavy accounting still runs on the server; this component only owns the
 * loading UX: immediate highlight, disabled buttons, an "Updating dashboard…"
 * spinner, dimmed cards, and double-click prevention. It also prefetches the
 * other store routes so the next switch is fast.
 */
export function DashboardShell({
  storeId,
  options,
  children,
}: {
  storeId: string | null;
  options: StoreOption[];
  children: ReactNode;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // Optimistic highlight: reflect the clicked store immediately, before the
  // server render lands. Re-synced to the real scope once navigation completes.
  const [selected, setSelected] = useState<string | null>(storeId);

  useEffect(() => {
    setSelected(storeId);
  }, [storeId]);

  // Prefetch the other store scopes after the first load so the next click is
  // fast. Safe: prefetch only warms the route; the page stays force-dynamic, so
  // figures are always re-fetched fresh on the actual navigation.
  useEffect(() => {
    for (const o of options) {
      if ((o.id ?? null) !== storeId) router.prefetch(storeHref(o.id));
    }
  }, [options, storeId, router]);

  function switchStore(targetId: string | null) {
    // Ignore double-clicks / repeated navigation while a switch is in flight,
    // and no-op when the target is already active.
    if (isStoreSwitchBlocked(isPending, targetId, storeId)) return;
    setSelected(targetId);
    startTransition(() => {
      router.push(storeHref(targetId));
    });
  }

  // Reflect the optimistically-selected scope in the hero label immediately, so
  // the heading, the store chip and the figures all move together on a switch.
  const activeLabel = options.find((o) => (o.id ?? null) === selected)?.label ?? 'All Stores';

  return (
    <div>
      {/* Compact hero: page identity + scope on the left, store switcher on the
          right. The store filter scopes every figure below. Default: All Stores. */}
      <header className="mb-6 flex flex-col gap-4 border-b border-slate-200 pb-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-[1.7rem]">Business overview</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm">
            <span className="inline-flex items-center rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-700">
              {activeLabel}
            </span>
            <span aria-hidden="true" className="text-slate-300">
              ·
            </span>
            <span className="text-slate-500">All-time</span>
          </div>
        </div>

        <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center">
          <div
            role="group"
            aria-label="Filter by store"
            className="inline-flex flex-wrap items-center gap-1 rounded-full border border-slate-200 bg-white p-1 shadow-card"
          >
            {options.map((o) => {
              const active = (o.id ?? null) === selected;
              return (
                <button
                  key={o.id ?? 'all'}
                  type="button"
                  onClick={() => switchStore(o.id)}
                  disabled={isPending}
                  aria-pressed={active}
                  aria-current={active ? 'true' : undefined}
                  className={
                    active
                      ? 'rounded-full bg-brand-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed'
                      : 'rounded-full px-4 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-60'
                  }
                >
                  {o.label}
                </button>
              );
            })}
          </div>

          <span
            role="status"
            aria-live="polite"
            className={
              isPending
                ? 'inline-flex items-center gap-1.5 text-sm font-medium text-brand-600'
                : 'sr-only'
            }
          >
            {isPending && (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Updating dashboard…
              </>
            )}
          </span>
        </div>
      </header>

      {/* Server-rendered figures — kept visible but dimmed during a switch. */}
      <div
        aria-busy={isPending}
        className={
          isPending
            ? 'pointer-events-none select-none opacity-40 transition-opacity duration-200'
            : 'opacity-100 transition-opacity duration-200'
        }
      >
        {children}
      </div>
    </div>
  );
}
