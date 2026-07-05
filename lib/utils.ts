import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { CURRENCY } from './config';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format a number as currency, e.g. Rs 1,250.00 */
export function formatMoney(value: number | null | undefined): string {
  const n = Number(value ?? 0);
  return `${CURRENCY.symbol} ${n.toLocaleString(CURRENCY.locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Compact currency for tight KPI cards, e.g. Rs 1.25M */
export function formatMoneyCompact(value: number | null | undefined): string {
  const n = Number(value ?? 0);
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000)
    return `${sign}${CURRENCY.symbol} ${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000)
    return `${sign}${CURRENCY.symbol} ${(abs / 1_000).toFixed(1)}K`;
  return formatMoney(n);
}

export function formatNumber(value: number | null | undefined): string {
  return Number(value ?? 0).toLocaleString(CURRENCY.locale);
}

/** Format a date as e.g. 05 Jul 2026 */
export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** Format a datetime as e.g. 05 Jul 2026, 14:30 */
export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** YYYY-MM-DD for <input type="date"> values */
export function toDateInput(date: Date | string | null | undefined): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

/** Turn an enum-like SCREAMING_SNAKE value into a readable label. */
export function humanize(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Safe number parse from form data. */
export function num(value: FormDataEntryValue | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  const n = Number(value);
  return isNaN(n) ? 0 : n;
}

/** Safe integer parse from form data. */
export function int(value: FormDataEntryValue | null | undefined): number {
  return Math.trunc(num(value));
}

/** Trimmed string or null. */
export function str(value: FormDataEntryValue | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}
