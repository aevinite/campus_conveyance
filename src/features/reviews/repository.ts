import type { SupabaseClient } from '@supabase/supabase-js';

export interface AgencyRating {
  avg: number;
  count: number;
}
export interface MyReview {
  rating: number;
  comment: string | null;
}
export interface PublicReview {
  id: string;
  rating: number;
  comment: string | null;
  created_at: string;
}
export interface AgencyReview extends PublicReview {
  reviewer: string;
}

/**
 * The caller's own reviews, keyed by agency id — used to prefill/label the
 * "Rate this agency" widget on the bookings page. Readable via the
 * `reviews_own_read` RLS policy (works even if a review was hidden by an admin).
 */
export async function getMyReviews(db: SupabaseClient): Promise<Map<string, MyReview>> {
  const out = new Map<string, MyReview>();
  const { data: students, error: sErr } = await db.from('students').select('id');
  if (sErr || !students || students.length === 0) return out;
  const ids = students.map((s) => s.id as string);
  const { data, error } = await db
    .from('reviews')
    .select('agency_id, rating, comment')
    .in('student_id', ids);
  if (error || !data) return out;
  for (const r of data) {
    out.set(r.agency_id as string, {
      rating: r.rating as number,
      comment: (r.comment as string) ?? null,
    });
  }
  return out;
}

/** Aggregate rating for a set of agencies (denormalized on `agencies`). */
export async function getAgencyRatings(
  db: SupabaseClient,
  agencyIds: string[],
): Promise<Map<string, AgencyRating>> {
  const out = new Map<string, AgencyRating>();
  const uniq = [...new Set(agencyIds.filter(Boolean))];
  if (uniq.length === 0) return out;
  const { data, error } = await db
    .from('agencies')
    .select('id, rating_avg, rating_count')
    .in('id', uniq);
  if (error || !data) return out;
  for (const a of data) {
    out.set(a.id as string, {
      avg: Number(a.rating_avg) || 0,
      count: (a.rating_count as number) ?? 0,
    });
  }
  return out;
}

/** Recent VISIBLE reviews for an agency (no reviewer identity) — for the public
 *  route-detail page. Readable via the `reviews_public_read` RLS policy. */
export async function listPublicReviews(
  db: SupabaseClient,
  agencyId: string,
  limit = 5,
): Promise<PublicReview[]> {
  const { data, error } = await db
    .from('reviews')
    .select('id, rating, comment, created_at')
    .eq('agency_id', agencyId)
    .eq('is_hidden', false)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return data as PublicReview[];
}

/** Agency name + aggregate rating + recent visible reviews for a route — the
 *  read-only "reviews" block on the public route-detail page. */
export async function getRouteAgencyReviews(
  db: SupabaseClient,
  routeId: string,
): Promise<{ agencyName: string; rating: AgencyRating; reviews: PublicReview[] } | null> {
  const { data: route } = await db
    .from('routes')
    .select('agency_id, agencies(id, name, rating_avg, rating_count)')
    .eq('id', routeId)
    .maybeSingle();
  const agRel = (route as { agencies: unknown } | null)?.agencies;
  const ag = (Array.isArray(agRel) ? agRel[0] : agRel) as
    | { id: string; name: string | null; rating_avg: number | string; rating_count: number }
    | null
    | undefined;
  if (!ag?.id) return null;
  const reviews = await listPublicReviews(db, ag.id, 5);
  return {
    agencyName: ag.name ?? 'the agency',
    rating: { avg: Number(ag.rating_avg) || 0, count: ag.rating_count ?? 0 },
    reviews,
  };
}

/** The owning agency's (or admin's) reviews WITH reviewer first name, via the
 *  `agency_reviews` security-definer RPC. */
export async function listAgencyReviews(
  db: SupabaseClient,
  agencyId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<AgencyReview[]> {
  const { data, error } = await db.rpc('agency_reviews', {
    p_agency_id: agencyId,
    p_limit: opts.limit ?? 50,
    p_offset: opts.offset ?? 0,
  });
  if (error || !data) return [];
  return data as AgencyReview[];
}
