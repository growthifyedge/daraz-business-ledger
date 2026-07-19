// POST /api/daraz-import/preview — owner-only dry-run. Never writes.
import { NextResponse } from 'next/server';
import { buildPreview } from '@/lib/daraz/persist';
import { requireOwnerApi, readUpload, HttpError } from '../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    await requireOwnerApi();
    const parsed = await readUpload(req);
    const preview = await buildPreview(parsed);
    return NextResponse.json({ ok: true, ...preview });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    }
    return NextResponse.json({ ok: false, error: 'Preview failed.' }, { status: 500 });
  }
}
