// The Cash Flow report has been removed from the UI. This route now redirects
// to the dashboard so old bookmarks keep working. Cash-flow calculation logic
// (lib/cashflow.ts, getCashFlow) and the underlying data are preserved.
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function CashFlowReportPage() {
  redirect('/dashboard');
}
