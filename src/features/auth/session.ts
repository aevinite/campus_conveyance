import { cache } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { roleFromClaims, type Role } from '@/lib/rbac/roles';

export type SessionClaims = {
  userId: string | null;
  role: Role | undefined;
  fullName: string | undefined;
  email: string | undefined;
};

/**
 * Reads the verified JWT claims in a single call. getClaims() validates the
 * access token locally (asymmetric signing keys) and only refreshes over the
 * network when the token is actually expiring — unlike getUser(), which makes a
 * round-trip to the Auth server on EVERY call. Safe to use on every request /
 * navigation without adding latency.
 *
 * The role and full name live in the JWT claims (role is injected by the custom
 * access-token hook; full_name is user metadata), so we read them straight from
 * the verified payload.
 */
export const getSessionClaims = cache(
  async (db: SupabaseClient): Promise<SessionClaims> => {
    const { data } = await db.auth.getClaims();
    const claims = data?.claims as
      | { sub?: string; email?: string; app_metadata?: unknown; user_metadata?: { full_name?: string } }
      | null;
    return {
      userId: claims?.sub ?? null,
      role: roleFromClaims(claims?.app_metadata),
      fullName: claims?.user_metadata?.full_name,
      email: claims?.email,
    };
  },
);

export async function getSessionRole(db: SupabaseClient): Promise<Role | undefined> {
  return (await getSessionClaims(db)).role;
}
