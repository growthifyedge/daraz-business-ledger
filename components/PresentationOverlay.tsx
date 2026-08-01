'use client';

import { Loader2 } from 'lucide-react';

/**
 * Full-screen, non-dismissible protective overlay shown only while a Presentation
 * Safe View transition is in flight (enter or exit). It dims and blurs the
 * current page and captures all pointer input, so the previous screen stays
 * visible but cannot be interacted with until the server confirms the new state.
 * It has no close control and no fake success state — it simply says what is
 * happening, then unmounts when the redirected server render arrives.
 */
export function PresentationOverlay({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-busy="true"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm"
    >
      <div className="mx-4 flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-xl">
        <Loader2 className="h-5 w-5 shrink-0 animate-spin text-brand-600" aria-hidden="true" />
        <div className="leading-tight">
          <p className="text-sm font-semibold text-slate-900">{title}</p>
          <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>
        </div>
      </div>
    </div>
  );
}
