import type { SupabaseClient } from '@supabase/supabase-js';
import { getSessionClaims } from '@/features/auth/session';

export interface RouteSummary {
  id: string;
  name: string;
  price_cents: number | null;
}
export interface Stop {
  id: string;
  name: string;
  sequence: number;
  lat: number | null;
  lng: number | null;
  address: string | null;
  description: string | null;
}
export interface VehicleInfo {
  bus_number: string | null;
  capacity: number | null;
  registration_no: string | null;
  is_ac: boolean | null;
  bus_model: string | null;
  bus_color: string | null;
  image_url: string | null;
  photos: string[] | null;
  driver_name: string | null;
  driver_phone: string | null;
  driver_license_no: string | null;
  driver_experience_years: number | null;
  driver_photo_url: string | null;
}
export interface Availability {
  total: number;
  reserved: number;
  available: number;
}
export interface BookingRow {
  id: string;
  status: string;
  created_at: string;
  routeId: string | null;
  routeName: string;
  price_cents: number | null;
  is_paid: boolean;
  approved_at: string | null;
  expires_at: string | null;
  /** Why a CANCELLED booking was cancelled: 'STUDENT' | 'PAYMENT_TIMEOUT' | null. */
  cancel_cause: string | null;
}

/** Routes for the caller's institution (RLS-scoped). */
export async function listRoutes(db: SupabaseClient): Promise<RouteSummary[]> {
  const { data, error } = await db
    .from('routes')
    .select('id, name, price_cents')
    .eq('is_active', true)
    .order('name');
  if (error) throw error;
  return (data ?? []) as RouteSummary[];
}

/**
 * Release every approved-but-unpaid booking whose 20-minute payment window has
 * passed (RPC, trigger frees the seats). Called before availability/booking
 * reads so a lapsed window never blocks a seat. Best-effort — a failure must
 * not break the page.
 */
export async function expireStaleHolds(db: SupabaseClient): Promise<void> {
  await db.rpc('expire_stale_holds');
}

/** The caller's active (PENDING/CONFIRMED/WAITLISTED) booking on a route, if any. */
export interface ActiveBooking {
  id: string;
  status: string;
  is_paid: boolean;
  approved_at: string | null;
  expires_at: string | null;
  pickup_stop_id: string | null;
}

export async function getMyActiveBookingForRoute(
  db: SupabaseClient,
  routeId: string,
): Promise<ActiveBooking | null> {
  // Scope to THIS student explicitly rather than trusting RLS alone: resolve the
  // caller's students row and filter by it, so the query means "my booking" even
  // if a policy is ever loosened.
  const { userId } = await getSessionClaims(db);
  if (!userId) return null;
  const { data: student } = await db
    .from('students')
    .select('id')
    .eq('profile_id', userId)
    .maybeSingle();
  if (!student) return null;
  const { data } = await db
    .from('bookings')
    .select('id, status, is_paid, approved_at, expires_at, pickup_stop_id')
    .eq('route_id', routeId)
    .eq('student_id', (student as { id: string }).id)
    .in('status', ['PENDING', 'CONFIRMED', 'WAITLISTED'])
    .limit(1)
    .maybeSingle();
  return (data as ActiveBooking | null) ?? null;
}

export async function getRouteWithStops(
  db: SupabaseClient,
  routeId: string,
): Promise<{
  route: RouteSummary;
  stops: Stop[];
  vehicle: VehicleInfo | null;
  institutionName: string | null;
} | null> {
  const { data: route } = await db
    .from('routes')
    .select(
      'id, name, price_cents, is_active, institutions(name, is_active, is_deleted), agencies(status, is_deleted), vehicles(bus_number, capacity, registration_no, is_ac, bus_model, bus_color, image_url, photos, driver_name, driver_phone, driver_license_no, driver_experience_years, driver_photo_url)',
    )
    .eq('id', routeId)
    .maybeSingle();
  if (!route) return null;

  // A route reachable via an old bookmark must still be LIVE, or the student
  // could book a delisted ride. Mirror the listing visibility: the route itself
  // active, its institution active and not deleted, and (if it belongs to an
  // agency) that agency APPROVED and not deleted. Seeded routes have no agency.
  if ((route as { is_active?: boolean }).is_active === false) return null;
  const instRel = (route as { institutions: { is_active: boolean; is_deleted: boolean } | { is_active: boolean; is_deleted: boolean }[] | null }).institutions;
  const institution = Array.isArray(instRel) ? instRel[0] : instRel;
  if (institution && (institution.is_active === false || institution.is_deleted === true)) return null;
  const agencyRel = (route as { agencies: { status: string; is_deleted: boolean } | { status: string; is_deleted: boolean }[] | null }).agencies;
  const agency = Array.isArray(agencyRel) ? agencyRel[0] : agencyRel;
  if (agency && (agency.status !== 'APPROVED' || agency.is_deleted === true)) return null;
  const { data: stops } = await db
    .from('route_stops')
    .select('id, name, sequence, lat, lng, address, description')
    .eq('route_id', routeId)
    .order('sequence');
  const v = (route as { vehicles: VehicleInfo | VehicleInfo[] | null }).vehicles;
  const vehicle = (Array.isArray(v) ? v[0] : v) ?? null;
  const inst = (route as { institutions: { name: string } | { name: string }[] | null }).institutions;
  const institutionName = (Array.isArray(inst) ? inst[0]?.name : inst?.name) ?? null;
  return {
    route: {
      id: route.id as string,
      name: route.name as string,
      price_cents: (route.price_cents as number) ?? null,
    },
    stops: (stops ?? []) as Stop[],
    vehicle,
    institutionName,
  };
}

export async function getAvailability(
  db: SupabaseClient,
  routeId: string,
): Promise<Availability> {
  const { data } = await db
    .from('seat_allocations')
    .select('total_seats, reserved_seats, route_assignments!inner(route_id)')
    .eq('route_assignments.route_id', routeId)
    .limit(1)
    .maybeSingle();
  const total = (data?.total_seats as number) ?? 0;
  const reserved = (data?.reserved_seats as number) ?? 0;
  return { total, reserved, available: Math.max(total - reserved, 0) };
}

export async function listMyBookings(db: SupabaseClient): Promise<BookingRow[]> {
  const { data, error } = await db
    .from('bookings')
    .select('id, status, created_at, is_paid, approved_at, expires_at, cancel_cause, routes(id, name, price_cents)')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((b) => {
    type RouteRef = { id: string; name: string; price_cents: number | null };
    const routes = b.routes as RouteRef | RouteRef[] | null;
    const route = Array.isArray(routes) ? routes[0] : routes;
    return {
      id: b.id as string,
      status: b.status as string,
      created_at: b.created_at as string,
      routeId: route?.id ?? null,
      routeName: route?.name ?? 'Route',
      price_cents: route?.price_cents ?? null,
      is_paid: (b.is_paid as boolean) ?? false,
      approved_at: (b.approved_at as string) ?? null,
      expires_at: (b.expires_at as string) ?? null,
      cancel_cause: (b.cancel_cause as string) ?? null,
    };
  });
}
