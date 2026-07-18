import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

// Public, live counts for the landing-page stats band. Computed with the
// service-role client because the source tables are RLS-locked to authenticated
// users, and this endpoint is hit by anonymous visitors. Always fresh so a
// newly-added provider / user / institution shows up on the next poll.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const db = createAdminClient();

  const [providers, users, colleges, schools] = await Promise.all([
    // Service providers = approved, non-deleted agencies.
    db.from('agencies').select('id', { count: 'exact', head: true }).eq('status', 'APPROVED').eq('is_deleted', false),
    // Trusted users = every non-deleted profile (the registered user base).
    db.from('profiles').select('id', { count: 'exact', head: true }).eq('is_deleted', false),
    // Institutions split by kind.
    db.from('institutions').select('id', { count: 'exact', head: true }).eq('kind', 'COLLEGE'),
    db.from('institutions').select('id', { count: 'exact', head: true }).eq('kind', 'SCHOOL'),
  ]);

  return NextResponse.json(
    {
      providers: providers.count ?? 0,
      users: users.count ?? 0,
      colleges: colleges.count ?? 0,
      schools: schools.count ?? 0,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
