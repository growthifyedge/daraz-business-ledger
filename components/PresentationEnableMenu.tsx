'use client';

import { MonitorPlay } from 'lucide-react';
import { enablePresentationSafeView } from '@/lib/presentation/actions';

/**
 * OWNER-only control (rendered inside the user menu) to enter Presentation Safe
 * View in either profile. Only shown when the kill switch is on and the mode is
 * not already active — otherwise it is not rendered at all.
 */
export function PresentationEnableMenu() {
  return (
    <div className="border-t border-slate-100 px-4 py-3">
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        <MonitorPlay className="h-3.5 w-3.5" aria-hidden="true" />
        Presentation Safe View
      </p>
      <div className="flex gap-2">
        <form action={enablePresentationSafeView} className="flex-1">
          <input type="hidden" name="profile" value="OPERATIONS" />
          <button
            type="submit"
            className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          >
            Operations
          </button>
        </form>
        <form action={enablePresentationSafeView} className="flex-1">
          <input type="hidden" name="profile" value="FINANCE" />
          <button
            type="submit"
            className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          >
            Finance
          </button>
        </form>
      </div>
    </div>
  );
}
