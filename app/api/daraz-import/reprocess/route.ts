// POST /api/daraz-import/reprocess — owner-only. Update-only reprocess of an
// already-imported batch using the SAME official CSV with the current parser.
// Updates existing store-scoped statement lines + fees (and existing order-line
// descriptive fields) in place. Creates nothing new; posts NO stock/COGS/P&L.
import { NextResponse } from 'next/server';
import { reprocessImport } from '@/lib/daraz/persist';
import { requireOwnerApi, readUpload, HttpError } from '../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const user = await requireOwnerApi();
    const parsed = await readUpload(req);
    const result = await reprocessImport(parsed, user);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 422 });
    }
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    }
    return NextResponse.json({ ok: false, error: 'Reprocess failed.' }, { status: 500 });
  }
}
