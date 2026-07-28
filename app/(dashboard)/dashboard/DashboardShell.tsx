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

  return (
    <div>
      {/* Store filter — scopes every figure below. Default: All Stores. */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Store</span>
        <div className="inline-flex flex-wrap items-center gap-1 rounded-full border border-slate-200 bg-white p-1 shadow-card">
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
                    ? 'rounded-full bg-brand-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition disabled:cursor-not-allowed'
                    : 'rounded-full px-4 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-60'
                }
              >
                {o.label}
              </button>
            );
          })}
        </div>

        {isPending && (
          <span
            role="status"
            aria-live="polite"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600"
          >
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Updating dashboard…
          </span>
        )}
      </div>

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
