'use client';

import Link from 'next/link';
import { useActionState, useEffect, useState } from 'react';
import { MonitorPlay, ArrowUpRight, Loader2 } from 'lucide-react';
import { enablePresentationSafeView } from '@/lib/presentation/actions';
import { initialFormState } from '@/lib/formState';
import { PresentationOverlay } from './PresentationOverlay';

/**
 * OWNER-only control (rendered inside the user menu) to enter Presentation Safe
 * View in either profile. Only shown when the kill switch is on and the mode is
 * not already active — otherwise it is not rendered at all.
 *
 * Activation is not instant: the server signs the cookie, writes an audit event
 * and then re-renders the whole dashboard in redacted mode. To keep that from
 * feeling stuck, clicking a profile immediately disables both buttons, spins the
 * chosen one, and drops a non-dismissible protective overlay over the page until
 * the redacted server render arrives (which unmounts this menu). A failure
 * re-enables the buttons and shows a concise retry message — it never sticks.
 */
export function PresentationEnableMenu() {
  const [state, formAction, isPending] = useActionState(
    enablePresentationSafeView,
    initialFormState
  );
  // Which profile is mid-activation, so only that button spins. Cleared once a
  // run settles (a failure returns a state; success unmounts this component).
  const [profile, setProfile] = useState<string | null>(null);
  useEffect(() => {
    if (!isPending) setProfile(null);
  }, [isPending, state]);

  const spinning = (p: string) => isPending && profile === p;

  return (
    <div className="border-t border-slate-100 px-4 py-3">
      <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        <MonitorPlay className="h-3.5 w-3.5" aria-hidden="true" />
        Presentation Safe View
      </p>
      <p className="mb-2 text-[11px] leading-snug text-slate-500">
        Hides confidential figures and makes the app read-only. Pick how money is shown:
      </p>
      <form action={formAction} className="flex gap-2">
        <button
          type="submit"
          name="profile"
          value="OPERATIONS"
          disabled={isPending}
          aria-busy={spinning('OPERATIONS')}
          onClick={() => setProfile('OPERATIONS')}
          title="Money shown as status only (Positive / Negative)"
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {spinning('OPERATIONS') && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
          Operations
        </button>
        <button
          type="submit"
          name="profile"
          value="FINANCE"
          disabled={isPending}
          aria-busy={spinning('FINANCE')}
          onClick={() => setProfile('FINANCE')}
          title="Money shown as safe ranges (e.g. Rs 10k–25k)"
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {spinning('FINANCE') && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
          Finance
        </button>
      </form>

      {isPending && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-emerald-700">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          Starting Presentation Safe View…
        </p>
      )}

      {state.error && !isPending && (
        <p role="alert" className="mt-2 text-[11px] font-medium text-rose-600">
          {state.error}
        </p>
      )}

      <Link
        href="/presentation"
        className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-brand-600 hover:underline"
      >
        Readiness &amp; pre-demo checklist
        <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
      </Link>

      {isPending && (
        <PresentationOverlay
          title="Starting Presentation Safe View…"
          subtitle="Preparing protected view"
        />
      )}
    </div>
  );
}
