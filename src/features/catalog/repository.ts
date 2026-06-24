import type { SupabaseClient } from '@supabase/supabase-js';

export type Kind = 'SCHOOL' | 'COLLEGE';
export type VehicleType = 'BUS' | 'VAN';

export interface Institution {
  id: string;
  name: string;
  kind: Kind;
  description: string | null;
  image_url: string | null;
}
export interface AgencyCard {
  id: string;
  name: string;
  description: string | null;
  routeCount: number;
}

export async function listInstitutions(db: SupabaseClient): Promise<Institution[]> {
  const { data, error } = await db
    .from('institutions')
    .select('id, name, kind, description, image_url')
    .eq('is_active', true)
    .order('name');
  if (error) throw error;
  return (data ?? []) as Institution[];
}

export async function getInstitution(
  db: SupabaseClient,
  id: string,
): Promise<Institution | null> {
  const { data } = await db
    .from('institutions')
    .select('id, name, kind, description, image_url')
    .eq('id', id)
    .maybeSingle();
  return (data as Institution) ?? null;
}

/** Distinct agencies offering the given vehicle type at this institution. */
export async function listAgenciesForInstitution(
  db: SupabaseClient,
  institutionId: string,
  type: VehicleType,
): Promise<AgencyCard[]> {
  const { data, error } = await db
    .from('routes')
    .select('agency_id, agencies(id, name, description)')
    .eq('institution_id', institutionId)
    .eq('vehicle_type', type);
  if (error) throw error;

  const byId = new Map<string, AgencyCard>();
  for (const row of data ?? []) {
    const a = row.agencies as
      | { id: string; name: string; description: string | null }
      | { id: string; name: string; description: string | null }[]
      | null;
    const agency = Array.isArray(a) ? a[0] : a;
    if (!agency) continue;
    const existing = byId.get(agency.id);
    if (existing) existing.routeCount += 1;
    else
      byId.set(agency.id, {
        id: agency.id,
        name: agency.name,
        description: agency.description,
        routeCount: 1,
      });
  }
  return [...byId.values()].sort((x, y) => x.name.localeCompare(y.name));
}

export async function getAgency(db: SupabaseClient, id: string) {
  const { data } = await db
    .from('agencies')
    .select('id, name, description, phone, email')
    .eq('id', id)
    .maybeSingle();
  return data as
    | { id: string; name: string; description: string | null; phone: string | null; email: string | null }
    | null;
}

export interface RouteWithSeats {
  id: string;
  name: string;
  total: number;
  available: number;
}

/** Routes for one agency + vehicle type at an institution, with seat counts. */
export async function listAgencyRoutes(
  db: SupabaseClient,
  institutionId: string,
  agencyId: string,
  type: VehicleType,
): Promise<RouteWithSeats[]> {
  const { data, error } = await db
    .from('routes')
    .select(
      'id, name, route_assignments(seat_allocations(total_seats, reserved_seats))',
    )
    .eq('institution_id', institutionId)
    .eq('agency_id', agencyId)
    .eq('vehicle_type', type)
    .order('name');
  if (error) throw error;

  return (data ?? []).map((r) => {
    const assignments = (r.route_assignments ?? []) as {
      seat_allocations: { total_seats: number; reserved_seats: number }[] | null;
    }[];
    const alloc = assignments[0]?.seat_allocations?.[0];
    const total = alloc?.total_seats ?? 0;
    const reserved = alloc?.reserved_seats ?? 0;
    return { id: r.id as string, name: r.name as string, total, available: Math.max(total - reserved, 0) };
  });
}
