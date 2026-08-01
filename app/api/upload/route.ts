import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getSupabaseAdmin, STORAGE_BUCKET } from '@/lib/supabase';
import { isPresentationActive } from '@/lib/presentation/context';
import { PRESENTATION_READONLY_MESSAGE } from '@/lib/presentation/core';

// Handles invoice / receipt uploads (images or PDFs) to Supabase Storage.
export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // No uploads while Presentation Safe View is active — fail closed server-side,
  // independent of middleware. Never write files or return a storage URL.
  if (await isPresentationActive()) {
    return NextResponse.json({ error: PRESENTATION_READONLY_MESSAGE }, { status: 403 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json(
      {
        error:
          'File storage is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to enable uploads.',
      },
      { status: 501 }
    );
  }

  const form = await req.formData();
  const file = form.get('file');
  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }

  const allowed = [
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
    'image/gif',
    'application/pdf',
  ];
  if (!allowed.includes(file.type)) {
    return NextResponse.json(
      { error: 'Unsupported file type. Upload an image or PDF.' },
      { status: 400 }
    );
  }
  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json(
      { error: 'File too large (max 10 MB).' },
      { status: 400 }
    );
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `uploads/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;

  const buffer = Buffer.from(await file.arrayBuffer());
  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, buffer, { contentType: file.type, upsert: false });

  if (error) {
    return NextResponse.json(
      { error: `Upload failed: ${error.message}` },
      { status: 500 }
    );
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);

  return NextResponse.json({ url: publicUrl });
}
