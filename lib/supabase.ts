import { createClient } from '@supabase/supabase-js';

/**
 * Browser/server-safe Supabase client. Anon key only — RLS-protected.
 *
 * The SERVICE key must never reach this file. It belongs to the worker and to
 * server-only route handlers, where it is read from process.env directly.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set — see .env.example',
  );
}

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: false },
});
