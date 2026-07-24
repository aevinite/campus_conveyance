import type { SupabaseClient } from '@supabase/supabase-js';

export type Kind = 'SCHOOL' | 'COLLEGE';
export type VehicleType = 'BUS' | 'VAN';

export interface Institution {
  id: string;
  name: string;
  kind: Kind;
  description: string | null;
  image_url: string | null;
  is_verified: boolean;
}
/** Full active list — used by the agency service-area picker (a one-off form,
 *  not the student catalog). The student catalog uses searchInstitutions. */
export async function listInstitutions(db: SupabaseClient): Promise<Institution[]> {
  const { data, error } = await db
    .from('institutions')
    .select('id, name, kind, description, image_url, is_verified')
    .eq('is_active', true)
    .eq('is_deleted', false)
    .order('name')
    .limit(1000); // defensive cap — this feeds a one-off <select>, not a paged list
  if (error) throw error;
  return (data ?? []) as Institution[];
}

export type KindFilter = Kind | 'ALL';
export interface InstitutionQuery {
  query?: string;
  kind?: KindFilter;
  sort?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

/** The student catalog: filtered + sorted + paginated in the DB, so the browser
 *  gets one page instead of every campus (payload/work no longer ∝ campus count). */
export async function searchInstitutions(
  db: SupabaseClient,
  opts: InstitutionQuery,
): Promise<Institution[]> {
  let q = db
    .from('institutions')
    .select('id, name, kind, description, image_url, is_verified')
    .eq('is_active', true)
    .eq('is_deleted', false);
  if (opts.kind && opts.kind !== 'ALL') q = q.eq('kind', opts.kind);
  const search = opts.query?.trim();
  if (search) q = q.ilike('name', `%${search}%`);
  q = q.order('name', { ascending: opts.sort !== 'desc' });
  if (opts.limit != null) {
    const off = opts.offset ?? 0;
    q = q.range(off, off + opts.limit - 1);
  }
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Institution[];
}

/** Total institutions matching the same filters — for the catalog pager. */
export async function countInstitutions(
  db: SupabaseClient,
  opts: Pick<InstitutionQuery, 'query' | 'kind'>,
): Promise<number> {
  let q = db
    .from('institutions')
    .select('id', { count: 'exact', head: true })
    .eq('is_active', true)
    .eq('is_deleted', false);
  if (opts.kind && opts.kind !== 'ALL') q = q.eq('kind', opts.kind);
  const search = opts.query?.trim();
  if (search) q = q.ilike('name', `%${search}%`);
  const { count, error } = await q;
  if (error) throw error; // don't report 0 (empty pager) over visible cards
  return count ?? 0;
}

/** Active school/college counts (head counts — no full list load). */
export async function institutionKindCounts(
  db: SupabaseClient,
): Promise<{ schools: number; colleges: number }> {
  const [schools, colleges] = await Promise.all([
    db.from('institutions').select('id', { count: 'exact', head: true }).eq('is_active', true).eq('is_deleted', false).eq('kind', 'SCHOOL'),
    db.from('institutions').select('id', { count: 'exact', head: true }).eq('is_active', true).eq('is_deleted', false).eq('kind', 'COLLEGE'),
  ]);
  // Surface a query failure instead of reporting 0/0 — a transient error would
  // otherwise render an empty "0 schools · 0 colleges" band over real data.
  if (schools.error) throw schools.error;
  if (colleges.error) throw colleges.error;
  return { schools: schools.count ?? 0, colleges: colleges.count ?? 0 };
}

/** A few institutions for the home "Explore campuses" strip — not the full list. */
export async function listFeaturedInstitutions(
  db: SupabaseClient,
  limit = 3,
): Promise<Institution[]> {
  const { data, error } = await db
    .from('institutions')
    .select('id, name, kind, description, image_url, is_verified')
    .eq('is_active', true)
    .eq('is_deleted', false)
    .order('name')
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as Institution[];
}

export async function getInstitution(
  db: SupabaseClient,
  id: string,
): Promise<Institution | null> {
  // Only active institutions are visible to students — a disabled one 404s even
  // via a direct URL, so students can't apply to an unavailable campus.
  const { data, error } = await db
    .from('institutions')
    .select('id, name, kind, description, image_url, is_verified')
    .eq('id', id)
    .eq('is_active', true)
    .eq('is_deleted', false)
    .maybeSingle();
  if (error) throw error; // don't 404 an active campus on a transient error
  return (data as Institution) ?? null;
}

/** One bookable ride to a campus — everything the student compares at a glance. */
export interface CampusRoute {
  id: string;
  name: string;
  vehicleType: VehicleType;
  agencyName: string | null;
  busNumber: string | null;
  isAc: boolean | null;
  departureTime: string | null;
  price_cents: number | null;
  total: number;
  available: number;
}

/**
 * Every active route serving an institution, across ALL approved agencies and
 * both vehicle types — the single list the student picks a ride from (replaces
 * the old type-tab → agency → route drill-down).
 */
export interface CampusRouteQuery {
  query?: string;
  vehicleType?: VehicleType;
  limit?: number;
  offset?: number;
}

export async function listInstitutionRoutes(
  db: SupabaseClient,
  institutionId: string,
  opts: CampusRouteQuery = {},
): Promise<CampusRoute[]> {
  // The agency-visibility filter, seat roll-up, name/agency search, vehicle-type
  // filter and pagination all happen in SQL (migrations 0062/0068), so the campus
  // page fetches ONE page server-side — no fetch-everything-then-filter-in-JS.
  const { data, error } = await db.rpc('institution_routes', {
    p_institution_id: institutionId,
    p_query: opts.query?.trim() || null,
    p_vehicle_type: opts.vehicleType ?? null,
    p_limit: opts.limit ?? null,
    p_offset: opts.offset ?? 0,
  });
  if (error) throw error;
  type Row = {
    id: string; name: string; vehicle_type: string | null;
    agency_name: string | null; bus_number: string | null; is_ac: boolean | null;
    departure_time: string | null; price_cents: number | null;
    total: number | null; available: number | null;
  };
  return ((data ?? []) as Row[]).map((r) => ({
    id: r.id,
    name: r.name,
    vehicleType: (r.vehicle_type as VehicleType) ?? 'BUS',
    agencyName: r.agency_name ?? null,
    busNumber: r.bus_number ?? null,
    isAc: r.is_ac ?? null,
    departureTime: r.departure_time ?? null,
    price_cents: r.price_cents ?? null,
    total: r.total ?? 0,
    available: r.available ?? 0,
  }));
}

/** Total routes serving a campus matching the same search/type filters — the
 *  campus-detail pager total. */
export async function countInstitutionRoutes(
  db: SupabaseClient,
  institutionId: string,
  opts: Pick<CampusRouteQuery, 'query' | 'vehicleType'> = {},
): Promise<number> {
  const { data, error } = await db.rpc('institution_routes_count', {
    p_institution_id: institutionId,
    p_query: opts.query?.trim() || null,
    p_vehicle_type: opts.vehicleType ?? null,
  });
  if (error) throw error;
  return Number(data ?? 0);
}
