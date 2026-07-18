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
export async function listInstitutions(db: SupabaseClient): Promise<Institution[]> {
  const { data, error } = await db
    .from('institutions')
    .select('id, name, kind, description, image_url, is_verified')
    .eq('is_active', true)
    .order('name');
  if (error) throw error;
  return (data ?? []) as Institution[];
}

export async function getInstitution(
  db: SupabaseClient,
  id: string,
): Promise<Institution | null> {
  // Only active institutions are visible to students — a disabled one 404s even
  // via a direct URL, so students can't apply to an unavailable campus.
  const { data } = await db
    .from('institutions')
    .select('id, name, kind, description, image_url, is_verified')
    .eq('id', id)
    .eq('is_active', true)
    .maybeSingle();
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
export async function listInstitutionRoutes(
  db: SupabaseClient,
  institutionId: string,
): Promise<CampusRoute[]> {
  const { data, error } = await db
    .from('routes')
    .select(
      `id, name, vehicle_type, price_cents, departure_time,
       agencies(name, status, is_deleted),
       vehicles(bus_number, is_ac),
       route_assignments(seat_allocations(total_seats, reserved_seats))`,
    )
    .eq('institution_id', institutionId)
    .eq('is_active', true)
    .order('departure_time', { ascending: true, nullsFirst: false });
  if (error) throw error;

  type AgencyRef = { name: string; status: string; is_deleted: boolean };
  type VehicleRef = { bus_number: string | null; is_ac: boolean | null };
  type AssignRef = {
    seat_allocations: { total_seats: number; reserved_seats: number }[] | null;
  };
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

  const rows: CampusRoute[] = [];
  for (const r of data ?? []) {
    const agency = one(r.agencies as AgencyRef | AgencyRef[] | null);
    // Routes of suspended/soft-deleted agencies are not bookable.
    if (agency && (agency.status !== 'APPROVED' || agency.is_deleted)) continue;
    const vehicle = one(r.vehicles as VehicleRef | VehicleRef[] | null);
    const alloc = (r.route_assignments as AssignRef[] | null)?.[0]?.seat_allocations?.[0];
    const total = alloc?.total_seats ?? 0;
    const reserved = alloc?.reserved_seats ?? 0;
    rows.push({
      id: r.id as string,
      name: r.name as string,
      vehicleType: (r.vehicle_type as VehicleType) ?? 'BUS',
      agencyName: agency?.name ?? null,
      busNumber: vehicle?.bus_number ?? null,
      isAc: vehicle?.is_ac ?? null,
      departureTime: (r.departure_time as string) ?? null,
      price_cents: (r.price_cents as number) ?? null,
      total,
      available: Math.max(total - reserved, 0),
    });
  }
  return rows;
}
