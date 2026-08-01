'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { EyeOff, Lock, Clock, LogOut } from 'lucide-react';
import { disablePresentationSafeView } from '@/lib/presentation/actions';
import { PRESENTATION_PROFILE_LABEL, type PresentationContext } from '@/lib/presentation/core';

function timeLeft(expiresAt?: string): string {
  if (!expiresAt) return '';
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'expiring…';
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/**
 * Permanent, sticky, non-dismissible global banner shown whenever Presentation
 * Safe View is active. It pins to the very top of the viewport (above the app
 * header) so it stays visible no matter how far the page is scrolled, and it
 * states the mode, the active profile, that the app is read-only, the time left,
 * and the only way out — the explicit Exit action (or the 4-hour expiry). It has
 * no close control by design. Renders nothing when inactive, so normal operation
 * is visually unchanged.
 */
export function PresentationBanner({ presentation }: { presentation: PresentationContext }) {
  const [left, setLeft] = useState(() => timeLeft(presentation.expiresAt));

  useEffect(() => {
    if (!presentation.active) return;
    setLeft(timeLeft(presentation.expiresAt));
    const id = setInterval(() => setLeft(timeLeft(presentation.expiresAt)), 30_000);
    return () => clearInterval(id);
  }, [presentation.active, presentation.expiresAt]);

  if (!presentation.active) return null;

  const profileLabel = presentation.profile
    ? PRESENTATION_PROFILE_LABEL[presentation.profile]
    : '';

  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-0 z-50 flex h-10 items-center gap-x-3 overflow-hidden whitespace-nowrap bg-emerald-600 px-4 text-sm text-white shadow-sm"
    >
      <EyeOff className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="font-semibold">Presentation Safe View</span>

      <span aria-hidden="true" className="hidden text-emerald-200 sm:inline">·</span>
      <span className="hidden items-center gap-1 sm:inline-flex">
        <Lock className="h-3.5 w-3.5" aria-hidden="true" /> Read-only
      </span>

      {profileLabel && (
        <>
          <span aria-hidden="true" className="hidden text-emerald-200 sm:inline">·</span>
          <span className="hidden sm:inline">
            <span className="text-emerald-200">Profile:</span> {profileLabel}
          </span>
        </>
      )}

      {left && (
        <>
          <span aria-hidden="true" className="hidden text-emerald-200 md:inline">·</span>
          <span className="hidden items-center gap-1 md:inline-flex">
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="text-emerald-200">Exits in</span> {left}
          </span>
        </>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <Link
          href="/presentation"
          className="hidden rounded-md px-2 py-1 text-xs font-medium text-emerald-50 underline-offset-2 transition hover:bg-white/15 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-1 focus-visible:ring-offset-emerald-600 sm:inline-block"
        >
          Readiness
        </Link>
        <form action={disablePresentationSafeView}>
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 rounded-md bg-white/15 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-white/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-1 focus-visible:ring-offset-emerald-600"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            Exit
          </button>
        </form>
      </div>
    </div>
  );
}
