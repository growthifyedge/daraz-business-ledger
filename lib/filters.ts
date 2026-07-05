import type { Filter } from './calculations';

export type SearchParams = { [key: string]: string | string[] | undefined };

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** Parse `from`, `to`, `store` query params into a Filter object. */
export function parseFilter(sp: SearchParams): Filter {
  const from = one(sp.from);
  const to = one(sp.to);
  const store = one(sp.store);
  return {
    from: from ? new Date(from) : null,
    to: to ? new Date(to) : null,
    storeId: store || null,
  };
}

/** A human label for the active date range, e.g. "05 Jul 2026 – 12 Jul 2026". */
export function rangeLabel(f: Filter): string {
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  if (f.from && f.to) return `${fmt(f.from)} – ${fmt(f.to)}`;
  if (f.from) return `From ${fmt(f.from)}`;
  if (f.to) return `Until ${fmt(f.to)}`;
  return 'All time';
}
