'use client';

import { useEffect, useState } from 'react';
import { EyeOff, LogOut } from 'lucide-react';
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
 * Permanent, non-dismissible global banner shown whenever Presentation Safe View
 * is active. There is deliberately no close control — the only way out is the
 * explicit Exit action (or the 4-hour expiry). Renders nothing when inactive, so
 * normal operation is visually unchanged.
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
      className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-emerald-600 px-4 py-2 text-sm text-white shadow-sm"
    >
      <EyeOff className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="font-semibold">Presentation Safe View — ON</span>
      <span aria-hidden="true" className="text-emerald-200">·</span>
      <span>confidential values hidden</span>
      {profileLabel && (
        <>
          <span aria-hidden="true" className="text-emerald-200">·</span>
          <span>{profileLabel} profile</span>
        </>
      )}
      {left && (
        <>
          <span aria-hidden="true" className="text-emerald-200">·</span>
          <span>exits in {left}</span>
        </>
      )}
      <form action={disablePresentationSafeView} className="ml-auto">
        <button
          type="submit"
          className="inline-flex items-center gap-1.5 rounded-md bg-white/15 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-white/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-1 focus-visible:ring-offset-emerald-600"
        >
          <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
          Exit
        </button>
      </form>
    </div>
  );
}
