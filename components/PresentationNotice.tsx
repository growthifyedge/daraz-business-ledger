'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Info, X } from 'lucide-react';

/**
 * Explains, in plain non-technical language, why the owner was just redirected
 * while Presentation Safe View is involved. The blocked-page guards and the
 * enable action append a `?psv=` marker to the destination URL; this reads it,
 * shows a professional dismissible notice, then strips the marker from the URL
 * so a refresh does not repeat it. Renders nothing when no marker is present, so
 * normal operation is completely unaffected.
 */
const MESSAGES: Record<string, { title: string; body: string }> = {
  blocked: {
    title: 'That area is hidden during a presentation',
    body:
      'Presentation Safe View is on, so confidential areas — Backup, Audit Log, Daraz Import and individual record details — are unavailable. Exit Presentation Safe View to open them.',
  },
  unavailable: {
    title: 'Presentation Safe View is not enabled for this workspace',
    body:
      'The demonstration mode has not been switched on for this deployment, so it cannot be started here.',
  },
};

export function PresentationNotice() {
  const router = useRouter();
  const params = useSearchParams();
  const key = params.get('psv');
  const [dismissed, setDismissed] = useState(false);

  // Strip the marker from the URL once, so the notice does not survive a refresh
  // or get shared via a copied link.
  useEffect(() => {
    if (!key) return;
    const next = new URLSearchParams(Array.from(params.entries()));
    next.delete('psv');
    const qs = next.toString();
    router.replace(qs ? `?${qs}` : '?', { scroll: false });
  }, [key, params, router]);

  const msg = key ? MESSAGES[key] : undefined;
  if (!msg || dismissed) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-4 mt-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 sm:mx-6"
    >
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold text-amber-900">{msg.title}</p>
        <p className="mt-0.5 text-amber-800">{msg.body}</p>
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="rounded-md p-1 text-amber-500 transition hover:bg-amber-100 hover:text-amber-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
