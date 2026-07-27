import type { SupabaseClient } from '@supabase/supabase-js';
import { getSessionClaims } from '@/features/auth/session';
import { todayIST } from '@/lib/today-ist';
import type { BillingPeriod } from '@/lib/billing';
import { planPrice } from '@/lib/billing';

/** Today's substitute staff member for a bus (null when the regular one is on duty). */
export interface DriverChange {
  name: string;
  phone: string | null;
  reason: string | null;
  govtId: string | null;
  bloodGroup: string | null;
  altPhone: string | null;
}

export interface RouteSummary {
  id: string;
  name: string;
  price_cents: number | null;
  price_monthly_cents: number | null;
  price_semester_cents: number | null;
  price_yearly_cents: number | null;
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
  driver_govt_id: string | null;
  driver_alt_phone: string | null;
  driver_blood_group: string | null;
  driver_verified: boolean | null;
  conductor_name: string | null;
  conductor_phone: string | null;
  conductor_govt_id: string | null;
  conductor_blood_group: string | null;
  conductor_alt_phone: string | null;
  conductor_verified: boolean | null;
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
  /** Price of the plan this booking was made under (falls back to the flat fare). */
  price_cents: number | null;
  /** The plan (MONTHLY/SEMESTER/YEARLY) chosen at booking, if any. */
  billing_period: BillingPeriod | null;
  is_paid: boolean;
  approved_at: string | null;
  expires_at: string | null;
  /** Why a CANCELLED booking was cancelled: 'STUDENT' | 'PAYMENT_TIMEOUT' | null. */
  cancel_cause: string | null;
  bus_number: string | null;
  /** Effective driver for today (substitute if changed, else the regular one). */
  driver_name: string | null;
  driver_phone: string | null;
  driver_changed: boolean;
  /** The agency operating this route — for the "rate this agency" widget. */
  agencyId: string | null;
  agencyName: string | null;
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
  /** The plan this booking was made under (MONTHLY/SEMESTER/YEARLY). */
  billing_period: BillingPeriod | null;
}

/** The caller's single active booking on ANY route (one bus at a time). */
export interface CurrentBooking extends ActiveBooking {
  routeId: string | null;
  routeName: string | null;
}

export async function getMyActiveBooking(
  db: SupabaseClient,
): Promise<CurrentBooking | null> {
  const { userId } = await getSessionClaims(db);
  if (!userId) return null;
  // One round-trip: resolve the caller's student row via an inner embed instead
  // of a separate students lookup, then the active booking, in a single query.
  const { data, error } = await db
    .from('bookings')
    .select('id, status, is_paid, approved_at, expires_at, pickup_stop_id, billing_period, routes(id, name), students!inner(profile_id)')
    .eq('students.profile_id', userId)
    .in('status', ['PENDING', 'CONFIRMED', 'WAITLISTED'])
    // The one-active-booking unique index already guarantees ≤1 match; the
    // explicit order makes the pick deterministic even if that ever loosened.
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  // Surface a real query failure instead of swallowing it — returning null here
  // would falsely report "no active booking" and could invite a second booking.
  if (error) throw error;
  if (!data) return null;
  // A PENDING hold whose payment window has lapsed is effectively dead: the row
  // is swept by the pg_cron job and by reserve_seat's own internal sweep, but
  // until then it still reads as PENDING. Treat it as "no active booking" here so
  // the student can re-request immediately — WITHOUT issuing a table-wide expiry
  // UPDATE on this hot browse path (that's the cron's job; see migration 0052).
  const pendingExpiresAt = (data.expires_at as string) ?? null;
  if (
    data.status === 'PENDING' &&
    !data.is_paid &&
    pendingExpiresAt &&
    new Date(pendingExpiresAt).getTime() <= Date.now()
  ) {
    return null;
  }
  const r = data.routes as { id: string; name: string } | { id: string; name: string }[] | null;
  const route = Array.isArray(r) ? r[0] : r;
  return {
    id: data.id as string,
    status: data.status as string,
    is_paid: (data.is_paid as boolean) ?? false,
    approved_at: (data.approved_at as string) ?? null,
    expires_at: (data.expires_at as string) ?? null,
    pickup_stop_id: (data.pickup_stop_id as string) ?? null,
    billing_period: ((data.billing_period as string) ?? null) as BillingPeriod | null,
    routeId: route?.id ?? null,
    routeName: route?.name ?? null,
  };
}


export async function getRouteWithStops(
  db: SupabaseClient,
  routeId: string,
): Promise<{
  route: RouteSummary;
  stops: Stop[];
  vehicle: VehicleInfo | null;
  institutionName: string | null;
  driverChange: DriverChange | null;
  conductorChange: DriverChange | null;
} | null> {
  // Route and its stops both key only off routeId, so fetch them together
  // rather than serially (one round-trip instead of two on the hot detail page).
  const [{ data: route, error: routeErr }, { data: stops, error: stopsErr }] = await Promise.all([
    db
      .from('routes')
      .select(
        // Only the vehicle columns the detail page actually renders (dropped the
        // never-shown driver_address/driver_dob/conductor_address/conductor_dob).
        'id, name, price_cents, price_monthly_cents, price_semester_cents, price_yearly_cents, is_active, institutions(name, is_active, is_deleted), agencies(status, is_deleted), vehicles(id, bus_number, capacity, registration_no, is_ac, bus_model, bus_color, image_url, photos, driver_name, driver_phone, driver_license_no, driver_experience_years, driver_photo_url, driver_govt_id, driver_alt_phone, driver_blood_group, driver_verified, conductor_name, conductor_phone, conductor_govt_id, conductor_alt_phone, conductor_blood_group, conductor_verified, bus_driver_changes(role, driver_name, driver_phone, reason, driver_govt_id, driver_blood_group, driver_alt_phone, effective_date))',
      )
      .eq('id', routeId)
      // Only TODAY's substitute rows are embedded (bus_driver_changes accumulate
      // daily) — this replaces a separate third round-trip for the changes.
      .eq('vehicles.bus_driver_changes.effective_date', todayIST())
      .maybeSingle(),
    db
      .from('route_stops')
      .select('id, name, sequence, lat, lng, address, description')
      .eq('route_id', routeId)
      .order('sequence'),
  ]);
  // Surface a transient failure instead of masking it as a 404 (route not found)
  // or a bookable route rendered with zero pickup stops.
  if (routeErr) throw routeErr;
  if (stopsErr) throw stopsErr;
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
  type ChangeRow = {
    role: string; driver_name: string; driver_phone: string | null; reason: string | null;
    driver_govt_id: string | null; driver_blood_group: string | null; driver_alt_phone: string | null;
  };
  type VehicleRow = VehicleInfo & { id?: string; bus_driver_changes?: ChangeRow[] };
  const v = (route as { vehicles: VehicleRow | VehicleRow[] | null }).vehicles;
  const vehicleRow = (Array.isArray(v) ? v[0] : v) ?? null;
  const inst = (route as { institutions: { name: string } | { name: string }[] | null }).institutions;
  const institutionName = (Array.isArray(inst) ? inst[0]?.name : inst?.name) ?? null;

  // Today's substitutes (driver and/or conductor) — embedded in the route query
  // above (filtered to today's effective_date), so no separate round-trip.
  let driverChange: DriverChange | null = null;
  let conductorChange: DriverChange | null = null;
  for (const c of vehicleRow?.bus_driver_changes ?? []) {
    const change: DriverChange = {
      name: c.driver_name,
      phone: c.driver_phone ?? null,
      reason: c.reason ?? null,
      govtId: c.driver_govt_id ?? null,
      bloodGroup: c.driver_blood_group ?? null,
      altPhone: c.driver_alt_phone ?? null,
    };
    if (c.role === 'CONDUCTOR') conductorChange = change;
    else driverChange = change;
  }
  // Strip the embed so the returned vehicle matches VehicleInfo.
  const vehicle: VehicleInfo | null = vehicleRow
    ? (() => {
        const { bus_driver_changes: _bdc, ...rest } = vehicleRow;
        void _bdc;
        return rest as VehicleInfo;
      })()
    : null;

  return {
    route: {
      id: route.id as string,
      name: route.name as string,
      price_cents: (route.price_cents as number) ?? null,
      price_monthly_cents: ((route as { price_monthly_cents?: number }).price_monthly_cents as number) ?? null,
      price_semester_cents: ((route as { price_semester_cents?: number }).price_semester_cents as number) ?? null,
      price_yearly_cents: ((route as { price_yearly_cents?: number }).price_yearly_cents as number) ?? null,
    },
    stops: (stops ?? []) as Stop[],
    vehicle,
    institutionName,
    driverChange,
    conductorChange,
  };
}

export async function getAvailability(
  db: SupabaseClient,
  routeId: string,
): Promise<Availability> {
  const { data: alloc, error: allocErr } = await db
    .from('seat_allocations')
    .select('id, total_seats, route_assignments!inner(route_id)')
    .eq('route_assignments.route_id', routeId)
    .limit(1)
    .maybeSingle();
  if (allocErr) throw allocErr; // don't mask a transient error as "not bookable"
  const total = (alloc?.total_seats as number) ?? 0;
  if (!alloc) return { total: 0, reserved: 0, available: 0 };
  // Count active bookings LIVE (same PENDING/CONFIRMED count reserve_seat uses
  // under the allocation lock), rather than the trigger-maintained
  // reserved_seats — so the displayed seats can't drift from the actual reserve
  // outcome if that trigger ever lags. Backed by idx_bookings_alloc_status.
  const { count, error } = await db
    .from('bookings')
    .select('id', { count: 'exact', head: true })
    .eq('seat_allocation_id', (alloc as { id: string }).id)
    .in('status', ['PENDING', 'CONFIRMED']);
  // On a count error, fail SAFE: show the route as full rather than open, so we
  // never advertise a possibly sold-out route as available (reserve_seat still
  // enforces capacity, but the UI shouldn't invite a booking that will bounce).
  if (error) return { total, reserved: total, available: 0 };
  const reserved = count ?? 0;
  return { total, reserved, available: Math.max(total - reserved, 0) };
}

/** Count of the student's own non-cancelled bookings, for My Bookings paging. */
export async function countMyBookings(db: SupabaseClient): Promise<number> {
  const { count, error } = await db
    .from('bookings')
    .select('id', { count: 'exact', head: true })
    .neq('status', 'CANCELLED');
  if (error) throw error;
  return count ?? 0;
}

export async function listMyBookings(
  db: SupabaseClient,
  opts: { limit?: number; offset?: number } = {},
): Promise<BookingRow[]> {
  let q = db
    .from('bookings')
    .select(
      'id, status, created_at, is_paid, approved_at, expires_at, cancel_cause, billing_period, routes(id, name, price_cents, price_monthly_cents, price_semester_cents, price_yearly_cents, agency_id, agencies(name), vehicles(id, bus_number, driver_name, driver_phone))',
    )
    // Cancelled bookings are hidden from the student panel entirely
    // (user decision 2026-07-18) — whatever the cancel reason.
    .neq('status', 'CANCELLED')
    .order('created_at', { ascending: false });
  if (opts.limit != null) {
    const off = opts.offset ?? 0;
    q = q.range(off, off + opts.limit - 1);
  }
  const { data, error } = await q;
  if (error) throw error;

  type VehRef = { id: string; bus_number: string | null; driver_name: string | null; driver_phone: string | null };
  type AgencyRef = { name: string | null };
  type RouteRef = {
    id: string; name: string; price_cents: number | null;
    price_monthly_cents: number | null; price_semester_cents: number | null; price_yearly_cents: number | null;
    agency_id: string | null;
    agencies: AgencyRef | AgencyRef[] | null;
    vehicles: VehRef | VehRef[] | null;
  };

  const rows = (data ?? []).map((b) => {
    const routes = b.routes as RouteRef | RouteRef[] | null;
    const route = Array.isArray(routes) ? routes[0] : routes;
    const veh = route?.vehicles as VehRef | VehRef[] | null | undefined;
    const vehicle = (Array.isArray(veh) ? veh[0] : veh) ?? null;
    const ag = route?.agencies as AgencyRef | AgencyRef[] | null | undefined;
    const agency = (Array.isArray(ag) ? ag[0] : ag) ?? null;
    const period = ((b.billing_period as string) ?? null) as BillingPeriod | null;
    // Show what the student actually committed to: the price of their chosen plan,
    // falling back to the legacy flat fare for older bookings.
    const planCents = route ? planPrice(route, period) : null;
    return {
      id: b.id as string,
      status: b.status as string,
      created_at: b.created_at as string,
      routeId: route?.id ?? null,
      routeName: route?.name ?? 'Route',
      price_cents: planCents ?? route?.price_cents ?? null,
      billing_period: period,
      is_paid: (b.is_paid as boolean) ?? false,
      approved_at: (b.approved_at as string) ?? null,
      expires_at: (b.expires_at as string) ?? null,
      cancel_cause: (b.cancel_cause as string) ?? null,
      _vehicleId: vehicle?.id ?? null,
      bus_number: vehicle?.bus_number ?? null,
      driver_name: vehicle?.driver_name ?? null,
      driver_phone: vehicle?.driver_phone ?? null,
      driver_changed: false,
      agencyId: route?.agency_id ?? null,
      agencyName: agency?.name ?? null,
    };
  });

  // Overlay today's substitute driver on the affected buses.
  const vehicleIds = [...new Set(rows.map((r) => r._vehicleId).filter(Boolean))] as string[];
  if (vehicleIds.length > 0) {
    const { data: changes, error: chErr } = await db
      .from('bus_driver_changes')
      .select('vehicle_id, driver_name, driver_phone')
      .in('vehicle_id', vehicleIds)
      .eq('role', 'DRIVER')
      .eq('effective_date', todayIST());
    // Surface the error — masking it would show the PERMANENT driver instead of
    // today's substitute (wrong person to riders/parents).
    if (chErr) throw chErr;
    const byVehicle = new Map((changes ?? []).map((c) => [c.vehicle_id as string, c]));
    for (const r of rows) {
      const c = r._vehicleId ? byVehicle.get(r._vehicleId) : undefined;
      if (c) {
        r.driver_name = (c.driver_name as string) ?? r.driver_name;
        r.driver_phone = (c.driver_phone as string) ?? null;
        r.driver_changed = true;
      }
    }
  }
  return rows.map(({ _vehicleId, ...r }) => { void _vehicleId; return r; });
}

// Lightweight helpers for the student home, which only needs a few recent rows
// and per-status counts — not the full booking history + driver overlay.
export interface RecentBooking {
  id: string;
  status: string;
  routeName: string;
  created_at: string;
  route_id: string | null;
}
export async function listRecentBookings(
  db: SupabaseClient,
  limit = 8,
): Promise<RecentBooking[]> {
  const { data, error } = await db
    .from('bookings')
    .select('id, status, created_at, route_id, routes(name)')
    // "Recent trips" shows only rides that exist or may happen — never
    // cancelled or rejected ones.
    .in('status', ['PENDING', 'CONFIRMED', 'WAITLISTED'])
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error; // don't mask a transient failure as "no recent trips"
  return (data ?? []).map((b) => {
    const r = b.routes as { name: string } | { name: string }[] | null;
    const route = Array.isArray(r) ? r[0] : r;
    return {
      id: b.id as string,
      status: b.status as string,
      created_at: b.created_at as string,
      route_id: (b.route_id as string | null) ?? null,
      routeName: route?.name ?? 'Route',
    };
  });
}

/** Per-status booking counts for the signed-in student (SQL GROUP BY via RPC). */
export async function myBookingStatusCounts(
  db: SupabaseClient,
): Promise<Record<string, number>> {
  const { data, error } = await db.rpc('my_booking_status_counts');
  if (error) throw error;
  return (data ?? {}) as Record<string, number>;
}
