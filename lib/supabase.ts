import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Server-only Supabase client for Storage uploads. Uses the SERVICE ROLE key,
// which must never be exposed to the browser — this module is only imported by
// server-side code (the /api/upload route handler).

export const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'uploads';

/**
 * Returns a configured Supabase client, or null when storage env vars are not
 * set (so the upload route can degrade gracefully like it did with Blob).
 */
export function getSupabaseAdmin(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
