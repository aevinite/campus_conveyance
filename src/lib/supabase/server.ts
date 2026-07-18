import { cache } from 'react';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// Memoized per server request (React cache): every caller in a single request
// shares one Supabase client instead of constructing a new one each time. This
// also lets request-scoped reads (getSessionClaims, getMyAgency) dedupe, since
// they receive the same client instance.
export const createClient = cache(async () => {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          try {
            toSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options));
          } catch {
            // Called from a Server Component; the middleware refreshes the session.
          }
        },
      },
    },
  );
});
