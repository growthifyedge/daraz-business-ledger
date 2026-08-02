import type { ReactNode } from 'react';
import { MonitorPlay } from 'lucide-react';
import { DemoBadge } from './DemoBadge';

/**
 * The shared top toolbar for every demo-capable Presentation Safe View module.
 * It gives all modules one consistent, immediately-visible header band — a
 * "Demo actions" label, the permanent demo notice, and right-aligned action
 * buttons — so demo controls always sit above the search/table and are never
 * hidden below a long list. Renders only when placed by an active-mode view.
 */
export function DemoActionsBar({ children }: { children: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-card">
      <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
        <MonitorPlay className="h-4 w-4 text-brand-500" aria-hidden="true" /> Demo actions
      </span>
      <DemoBadge />
      <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}
