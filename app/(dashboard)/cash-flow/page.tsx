// Cash Flow has been removed from the UI. This route now redirects to the
// dashboard so old bookmarks keep working. The underlying data (investments,
// payouts, Daraz income) and calculation logic (lib/cashflow.ts, getCashFlow)
// are preserved so Cash Flow can be restored later.
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function CashFlowPage() {
  redirect('/dashboard');
}
