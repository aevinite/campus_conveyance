import { createClient } from '@supabase/supabase-js';

// Service-role client — bypasses RLS. SERVER ONLY.
// Never import this into a Client Component or expose the key to the browser;
// it grants full read/write to every table. Used for public aggregates (counts)
// that must be visible to anonymous visitors even though the underlying tables
// are locked down to authenticated users by RLS.
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
