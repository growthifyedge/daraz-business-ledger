// POST /api/daraz-import/commit — owner-only atomic import for the selected
// store. Writes store-tagged statements + sanitized order lines only. NO customer
// data of any kind. Posts NO stock/COGS/P&L.
import { NextResponse } from 'next/server';
import { commitImport } from '@/lib/daraz/persist';
import { requireOwnerApi, readUpload, HttpError } from '../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const user = await requireOwnerApi();
    const parsed = await readUpload(req);
    const result = await commitImport(parsed, user);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 422 });
    }
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    }
    return NextResponse.json({ ok: false, error: 'Import failed.' }, { status: 500 });
  }
}
