'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useState } from 'react';
import { Filter, X } from 'lucide-react';
import { Button } from './Button';

interface StoreOption {
  id: string;
  name: string;
}

const PRESETS = [
  { label: 'Today', days: 0 },
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: 'This month', days: -1 },
];

/**
 * Date-range + store filter bar. Writes `from`, `to`, `store` to the URL
 * query string; server components read them via searchParams.
 */
export function FilterBar({
  stores,
  showStore = true,
}: {
  stores: StoreOption[];
  showStore?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [from, setFrom] = useState(params.get('from') ?? '');
  const [to, setTo] = useState(params.get('to') ?? '');
  const [store, setStore] = useState(params.get('store') ?? '');

  function apply(next?: { from?: string; to?: string; store?: string }) {
    const q = new URLSearchParams();
    const f = next?.from ?? from;
    const t = next?.to ?? to;
    const s = next?.store ?? store;
    if (f) q.set('from', f);
    if (t) q.set('to', t);
    if (s) q.set('store', s);
    router.push(`${pathname}?${q.toString()}`);
  }

  function preset(days: number) {
    const today = new Date();
    let start: Date;
    if (days === -1) {
      start = new Date(today.getFullYear(), today.getMonth(), 1);
    } else {
      start = new Date(today);
      start.setDate(today.getDate() - days);
    }
    const f = start.toISOString().slice(0, 10);
    const t = today.toISOString().slice(0, 10);
    setFrom(f);
    setTo(t);
    apply({ from: f, to: t });
  }

  function clear() {
    setFrom('');
    setTo('');
    setStore('');
    router.push(pathname);
  }

  const hasFilters = from || to || store;

  return (
    <div className="mb-4 rounded-xl border border-slate-200 bg-white p-3 shadow-card">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-1.5 text-sm font-medium text-slate-500">
          <Filter className="h-4 w-4" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-slate-500">From</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-slate-500">To</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          />
        </div>
        {showStore && stores.length > 0 && (
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-slate-500">
              Store
            </label>
            <select
              value={store}
              onChange={(e) => setStore(e.target.value)}
              className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            >
              <option value="">All stores</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <Button size="sm" onClick={() => apply()}>
          Apply
        </Button>
        {hasFilters && (
          <Button size="sm" variant="ghost" onClick={clear}>
            <X className="h-3.5 w-3.5" /> Clear
          </Button>
        )}
        <div className="ml-auto flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => preset(p.days)}
              className="rounded-full border border-slate-200 px-2.5 py-1 text-xs text-slate-600 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
