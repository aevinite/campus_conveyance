import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { roleFromClaims, type Role } from '@/lib/rbac/roles';

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          toSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          toSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options));
        },
      },
    },
  );
  // getClaims() verifies the JWT locally (asymmetric signing keys) and refreshes
  // the session only when the token is actually expiring, so we avoid the
  // guaranteed network round-trip that getUser() makes on every request.
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims as { sub?: string; app_metadata?: unknown } | null;
  const user = claims?.sub ? { id: claims.sub } : null;
  const role: Role | undefined = user
    ? roleFromClaims(claims?.app_metadata)
    : undefined;
  return { response, user, role };
}
