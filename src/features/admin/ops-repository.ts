// ---------------------------------------------------------------------------
// Admin OPERATIONS repository — read-only oversight of the live platform.
//
// The marketplace's operational tables (vehicles, routes, bookings, seat
// allocations, ride events, driver locations, …) are locked down by RLS to the
// agency/driver/student/parent that owns each row. The super-admin has no RLS
// grant to read across all of them, so this whole module uses the SERVICE-ROLE
// client (bypasses RLS). That is safe because every caller lives under the
// `aevinite/(panel)` layout, which is already guarded by requireRole('SUPER_ADMIN').
//
// Reads are intentionally UNCACHED: this is an oversight console where the admin
// expects to see the current truth (who is on which bus right now), not a 60s-old
// snapshot. Everything is server-paginated so a large table can't blow past
// PostgREST's ~1000-row cap.
//
// We resolve foreign keys with explicit id→row maps in JS rather than PostgREST
// embeds, because several tables carry two FKs to the same table (bookings has
// both pickup_stop_id and drop_stop_id → route_stops; a vehicle and a
// route_assignment both → drivers), which makes embed hints fragile.
// ---------------------------------------------------------------------------
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';

export const OPS_PAGE_SIZE = 50;
export interface Paged<T> {
  rows: T[];
  total: number;
}
export interface PageOpts {
  limit?: number;
  offset?: number;
}

function db(): SupabaseClient {
  return createAdminClient();
}

/** Fetch `col in (ids)` from `table` and index the rows by `col`. */
async function mapByIds<T = Record<string, unknown>>(
  client: SupabaseClient,
  table: string,
  select: string,
  ids: (string | null | undefined)[],
  key = 'id',
): Promise<Map<string, T>> {
  const uniq = [...new Set(ids.filter((x): x is string => !!x))];
  const out = new Map<string, T>();
  if (uniq.length === 0) return out;
  const { data, error } = await client.from(table).select(select).in(key, uniq);
  if (error) throw error;
  for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
    out.set(row[key] as string, row as T);
  }
  return out;
}

function range<T>(q: T, opts: PageOpts): T {
  if (opts.limit == null) return q;
  const off = opts.offset ?? 0;
  // @ts-expect-error - supabase query builder .range chains fluently
  return q.range(off, off + opts.limit - 1);
}

// ---- Fleet / vehicles -----------------------------------------------------

export interface VehicleListRow {
  id: string;
  bus_number: string | null;
  registration_no: string | null;
  vehicle_type: string | null;
  capacity: number | null;
  is_ac: boolean | null;
  is_active: boolean | null;
  agencyName: string;
  driver_name: string | null;
  driver_phone: string | null;
  driver_verified: boolean | null;
}

export async function listVehicles(opts: PageOpts = {}): Promise<Paged<VehicleListRow>> {
  const client = db();
  let q = client
    .from('vehicles')
    .select(
      'id, bus_number, registration_no, vehicle_type, capacity, is_ac, is_active, agency_id, driver_name, driver_phone, driver_verified',
      { count: 'exact' },
    )
    .order('bus_number', { nullsFirst: false })
    .order('registration_no');
  q = range(q, opts);
  const { data, error, count } = await q;
  if (error) throw error;
  const rows = (data ?? []) as Record<string, unknown>[];
  const agencies = await mapByIds<{ id: string; name: string }>(
    client,
    'agencies',
    'id, name',
    rows.map((r) => r.agency_id as string),
  );
  return {
    rows: rows.map((r) => ({
      id: r.id as string,
      bus_number: (r.bus_number as string) ?? null,
      registration_no: (r.registration_no as string) ?? null,
      vehicle_type: (r.vehicle_type as string) ?? null,
      capacity: (r.capacity as number) ?? null,
      is_ac: (r.is_ac as boolean) ?? null,
      is_active: (r.is_active as boolean) ?? null,
      agencyName: agencies.get(r.agency_id as string)?.name ?? '—',
      driver_name: (r.driver_name as string) ?? null,
      driver_phone: (r.driver_phone as string) ?? null,
      driver_verified: (r.driver_verified as boolean) ?? null,
    })),
    total: count ?? 0,
  };
}

export interface RouteStopLite {
  name: string;
  sequence: number | null;
  lat: number | null;
  lng: number | null;
  address: string | null;
  description: string | null;
}

export interface VehicleDetail {
  vehicle: Record<string, unknown>;
  agencyName: string;
  assignments: {
    assignmentId: string;
    routeId: string | null;
    routeName: string;
    totalSeats: number | null;
    reservedSeats: number | null;
    riders: SeatRider[];
    /** Stops of this assignment's route (for the admin map + stop list). */
    stops: RouteStopLite[];
  }[];
  live: { is_online: boolean; lat: number | null; lng: number | null; updated_at: string | null } | null;
  changes: {
    id: string;
    driver_name: string | null;
    driver_phone: string | null;
    role: string | null;
    reason: string | null;
    effective_date: string | null;
    created_at: string | null;
  }[];
}

export interface SeatRider {
  bookingId: string;
  studentName: string | null;
  studentEmail: string | null;
  status: string;
  isPaid: boolean;
  pickupStop: string;
  dropStop: string;
}

export async function getVehicleDetail(id: string): Promise<VehicleDetail | null> {
  const client = db();
  const { data: v, error } = await client.from('vehicles').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!v) return null;
  const vehicle = v as Record<string, unknown>;

  const agencyName =
    (
      await mapByIds<{ id: string; name: string }>(client, 'agencies', 'id, name', [
        vehicle.agency_id as string,
      ])
    ).get(vehicle.agency_id as string)?.name ?? '—';

  // Route assignments on this bus → route names + seat allocations + riders.
  const { data: asg, error: aerr } = await client
    .from('route_assignments')
    .select('id, route_id')
    .eq('vehicle_id', id);
  if (aerr) throw aerr;
  const assignmentRows = (asg ?? []) as { id: string; route_id: string | null }[];
  const routes = await mapByIds<{ id: string; name: string }>(
    client,
    'routes',
    'id, name',
    assignmentRows.map((a) => a.route_id),
  );
  const allocs = await mapByIds<{
    id: string;
    route_assignment_id: string;
    total_seats: number;
    reserved_seats: number;
  }>(
    client,
    'seat_allocations',
    'id, route_assignment_id, total_seats, reserved_seats',
    assignmentRows.map((a) => a.id),
    'route_assignment_id',
  );

  // Stops for every route this bus serves (one query), grouped by route → used
  // for the per-route stop list + map on the bus detail page.
  const stopsByRoute = new Map<string, RouteStopLite[]>();
  const routeIds = [...new Set(assignmentRows.map((a) => a.route_id).filter((x): x is string => !!x))];
  if (routeIds.length > 0) {
    const { data: stopData, error: stopErr } = await client
      .from('route_stops')
      .select('route_id, name, sequence, lat, lng, address, description')
      .in('route_id', routeIds)
      .order('sequence', { ascending: true });
    if (stopErr) throw stopErr;
    for (const st of (stopData ?? []) as Record<string, unknown>[]) {
      const rid = st.route_id as string;
      const arr = stopsByRoute.get(rid) ?? [];
      arr.push({
        name: st.name as string,
        sequence: (st.sequence as number) ?? null,
        lat: (st.lat as number) ?? null,
        lng: (st.lng as number) ?? null,
        address: (st.address as string) ?? null,
        description: (st.description as string) ?? null,
      });
      stopsByRoute.set(rid, arr);
    }
  }

  const assignments = [];
  for (const a of assignmentRows) {
    const alloc = allocs.get(a.id);
    const riders = alloc ? await ridersForAllocation(client, alloc.id) : [];
    assignments.push({
      assignmentId: a.id,
      routeId: a.route_id,
      routeName: a.route_id ? (routes.get(a.route_id)?.name ?? '—') : '—',
      totalSeats: alloc?.total_seats ?? null,
      reservedSeats: alloc ? liveReserved(riders) : null,
      riders,
      stops: a.route_id ? (stopsByRoute.get(a.route_id) ?? []) : [],
    });
  }

  // Live GPS (driver_locations keyed by drivers.id, which is vehicles.driver_id).
  let live = null;
  if (vehicle.driver_id) {
    const { data: loc, error: locErr } = await client
      .from('driver_locations')
      .select('is_online, lat, lng, updated_at')
      .eq('driver_id', vehicle.driver_id as string)
      .maybeSingle();
    if (locErr) throw locErr;
    if (loc) live = loc as VehicleDetail['live'];
  }

  const { data: chg, error: chgErr } = await client
    .from('bus_driver_changes')
    .select('id, driver_name, driver_phone, role, reason, effective_date, created_at')
    .eq('vehicle_id', id)
    .order('created_at', { ascending: false })
    .limit(25);
  if (chgErr) throw chgErr;

  return {
    vehicle,
    agencyName,
    assignments,
    live,
    changes: (chg ?? []) as VehicleDetail['changes'],
  };
}

/** Riders (bookings) attached to a seat allocation, with stop names resolved. */
// Live "reserved" count = PENDING + CONFIRMED riders (the seats actually held),
// matching the rider list/detail and the driver panel. Derived from the already-
// loaded riders so the admin console never shows a denormalized count that has
// drifted from what riders see. (ridersForAllocation returns all non-cancelled,
// which also includes waitlisted/expired — those don't hold a seat.)
const liveReserved = (riders: SeatRider[]): number =>
  riders.filter((r) => r.status === 'PENDING' || r.status === 'CONFIRMED').length;

async function ridersForAllocation(client: SupabaseClient, allocationId: string): Promise<SeatRider[]> {
  const { data, error } = await client
    .from('bookings')
    .select(
      'id, student_name, student_email, status, is_paid, pickup_stop_id, drop_stop_id, created_at',
    )
    .eq('seat_allocation_id', allocationId)
    .neq('status', 'CANCELLED')
    .order('created_at', { ascending: true });
  if (error) throw error;
  const rows = (data ?? []) as Record<string, unknown>[];
  const stops = await mapByIds<{ id: string; name: string }>(
    client,
    'route_stops',
    'id, name',
    rows.flatMap((r) => [r.pickup_stop_id as string, r.drop_stop_id as string]),
  );
  return rows.map((r) => ({
    bookingId: r.id as string,
    studentName: (r.student_name as string) ?? null,
    studentEmail: (r.student_email as string) ?? null,
    status: r.status as string,
    isPaid: !!r.is_paid,
    pickupStop: stops.get(r.pickup_stop_id as string)?.name ?? '—',
    dropStop: stops.get(r.drop_stop_id as string)?.name ?? '—',
  }));
}

// ---- Routes & stops -------------------------------------------------------

export interface RouteListRow {
  id: string;
  name: string;
  vehicle_type: string | null;
  start_location: string | null;
  departure_time: string | null;
  price_cents: number | null;
  is_active: boolean | null;
  institutionName: string;
  agencyName: string;
  busNumber: string | null;
  stopCount: number;
}

export async function listRoutes(opts: PageOpts = {}): Promise<Paged<RouteListRow>> {
  const client = db();
  let q = client
    .from('routes')
    .select(
      'id, name, vehicle_type, start_location, departure_time, price_cents, is_active, institution_id, agency_id, vehicle_id',
      { count: 'exact' },
    )
    .order('name');
  q = range(q, opts);
  const { data, error, count } = await q;
  if (error) throw error;
  const rows = (data ?? []) as Record<string, unknown>[];
  const [institutions, agencies, vehicles] = await Promise.all([
    mapByIds<{ id: string; name: string }>(client, 'institutions', 'id, name', rows.map((r) => r.institution_id as string)),
    mapByIds<{ id: string; name: string }>(client, 'agencies', 'id, name', rows.map((r) => r.agency_id as string)),
    mapByIds<{ id: string; bus_number: string | null }>(client, 'vehicles', 'id, bus_number', rows.map((r) => r.vehicle_id as string)),
  ]);
  // Stop counts per route in one grouped pass.
  const stopCounts = await countChildren(client, 'route_stops', 'route_id', rows.map((r) => r.id as string));
  return {
    rows: rows.map((r) => ({
      id: r.id as string,
      name: r.name as string,
      vehicle_type: (r.vehicle_type as string) ?? null,
      start_location: (r.start_location as string) ?? null,
      departure_time: (r.departure_time as string) ?? null,
      price_cents: (r.price_cents as number) ?? null,
      is_active: (r.is_active as boolean) ?? null,
      institutionName: institutions.get(r.institution_id as string)?.name ?? '—',
      agencyName: agencies.get(r.agency_id as string)?.name ?? '—',
      busNumber: vehicles.get(r.vehicle_id as string)?.bus_number ?? null,
      stopCount: stopCounts.get(r.id as string) ?? 0,
    })),
    total: count ?? 0,
  };
}

/** Count child rows grouped by a parent FK, without streaming every row. */
async function countChildren(
  client: SupabaseClient,
  table: string,
  fk: string,
  parentIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const uniq = [...new Set(parentIds.filter(Boolean))];
  if (uniq.length === 0) return out;
  // Exact per-parent head counts. A single `.in()` scan tallied in JS silently
  // drops child rows past PostgREST's ~1000-row cap — a 50-route page can
  // reference >1000 route_stops, so later routes read as "0 stops". head:true
  // counts are computed in the DB, exact, and bounded (one per parent, and the
  // parent list is already page-capped to OPS_PAGE_SIZE).
  const results = await Promise.all(
    uniq.map((pid) => client.from(table).select(fk, { count: 'exact', head: true }).eq(fk, pid)),
  );
  uniq.forEach((pid, i) => {
    const { count, error } = results[i];
    if (error) throw error;
    out.set(pid, count ?? 0);
  });
  return out;
}

export interface RouteDetail {
  route: Record<string, unknown>;
  institutionName: string;
  agencyName: string;
  busNumber: string | null;
  stops: { id: string; name: string; sequence: number | null; address: string | null; description: string | null; lat: number | null; lng: number | null }[];
  occupancy: { totalSeats: number | null; reservedSeats: number | null } | null;
  riders: SeatRider[];
  progress: { stopName: string; status: string | null; recorded_at: string | null }[];
}

export async function getRouteDetail(id: string): Promise<RouteDetail | null> {
  const client = db();
  const { data: r, error } = await client.from('routes').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!r) return null;
  const route = r as Record<string, unknown>;

  const [institutions, agencies, vehicles] = await Promise.all([
    mapByIds<{ id: string; name: string }>(client, 'institutions', 'id, name', [route.institution_id as string]),
    mapByIds<{ id: string; name: string }>(client, 'agencies', 'id, name', [route.agency_id as string]),
    mapByIds<{ id: string; bus_number: string | null }>(client, 'vehicles', 'id, bus_number', [route.vehicle_id as string]),
  ]);

  const { data: stopData, error: stopErr } = await client
    .from('route_stops')
    .select('id, name, sequence, address, description, lat, lng')
    .eq('route_id', id)
    .order('sequence', { ascending: true });
  if (stopErr) throw stopErr;
  const stops = (stopData ?? []) as RouteDetail['stops'];

  // Occupancy + riders via this route's assignment → seat allocation.
  const { data: asg, error: asgErr } = await client.from('route_assignments').select('id').eq('route_id', id).limit(1).maybeSingle();
  if (asgErr) throw asgErr;
  let occupancy: RouteDetail['occupancy'] = null;
  let riders: SeatRider[] = [];
  if (asg?.id) {
    const { data: alloc, error: allocErr } = await client
      .from('seat_allocations')
      .select('id, total_seats, reserved_seats')
      .eq('route_assignment_id', asg.id as string)
      .maybeSingle();
    if (allocErr) throw allocErr;
    if (alloc) {
      riders = await ridersForAllocation(client, alloc.id as string);
      // Live PENDING/CONFIRMED count (matches rider + driver views), not denorm.
      occupancy = { totalSeats: (alloc.total_seats as number) ?? null, reservedSeats: liveReserved(riders) };
    }
  }

  // Today's stop progress (NEXT / SKIPPED). This lives in migration 0086, which
  // may not be applied on every environment — swallow "relation does not exist"
  // (42P01) so the route page still renders without it.
  let progress: RouteDetail['progress'] = [];
  try {
    const { data: prog, error: perr } = await client
      .from('route_stop_progress')
      .select('stop_id, status, recorded_at')
      .eq('route_id', id)
      .order('recorded_at', { ascending: false })
      .limit(50);
    if (perr) throw perr;
    const stopMap = new Map(stops.map((s) => [s.id, s.name]));
    progress = ((prog ?? []) as Record<string, unknown>[]).map((p) => ({
      stopName: stopMap.get(p.stop_id as string) ?? '—',
      status: (p.status as string) ?? null,
      recorded_at: (p.recorded_at as string) ?? null,
    }));
  } catch (e) {
    if ((e as { code?: string })?.code !== '42P01') throw e;
  }

  return {
    route,
    institutionName: institutions.get(route.institution_id as string)?.name ?? '—',
    agencyName: agencies.get(route.agency_id as string)?.name ?? '—',
    busNumber: vehicles.get(route.vehicle_id as string)?.bus_number ?? null,
    stops,
    occupancy,
    riders,
    progress,
  };
}

// ---- Bookings (master ledger) --------------------------------------------

export interface BookingRow {
  id: string;
  studentName: string | null;
  studentEmail: string | null;
  routeName: string;
  busNumber: string | null;
  pickupStop: string;
  dropStop: string;
  status: string;
  isPaid: boolean;
  created_at: string | null;
  paid_at: string | null;
}

const BOOKING_COLS =
  'id, student_name, student_email, route_id, pickup_stop_id, drop_stop_id, status, is_paid, created_at, paid_at';

/** Resolve raw booking rows → BookingRow[] (route name, bus number, stop names). */
async function decorateBookings(client: SupabaseClient, rows: Record<string, unknown>[]): Promise<BookingRow[]> {
  const routes = await mapByIds<{ id: string; name: string; vehicle_id: string | null }>(
    client,
    'routes',
    'id, name, vehicle_id',
    rows.map((r) => r.route_id as string),
  );
  const vehicles = await mapByIds<{ id: string; bus_number: string | null }>(
    client,
    'vehicles',
    'id, bus_number',
    [...routes.values()].map((r) => r.vehicle_id),
  );
  const stops = await mapByIds<{ id: string; name: string }>(
    client,
    'route_stops',
    'id, name',
    rows.flatMap((r) => [r.pickup_stop_id as string, r.drop_stop_id as string]),
  );
  return rows.map((r) => {
    const route = routes.get(r.route_id as string);
    return {
      id: r.id as string,
      studentName: (r.student_name as string) ?? null,
      studentEmail: (r.student_email as string) ?? null,
      routeName: route?.name ?? '—',
      busNumber: route?.vehicle_id ? (vehicles.get(route.vehicle_id)?.bus_number ?? null) : null,
      pickupStop: stops.get(r.pickup_stop_id as string)?.name ?? '—',
      dropStop: stops.get(r.drop_stop_id as string)?.name ?? '—',
      status: r.status as string,
      isPaid: !!r.is_paid,
      created_at: (r.created_at as string) ?? null,
      paid_at: (r.paid_at as string) ?? null,
    };
  });
}

export async function listBookings(
  opts: PageOpts & { status?: string } = {},
): Promise<Paged<BookingRow>> {
  const client = db();
  // Apply the status filter (a filter op) BEFORE .order()/.range() (transform
  // ops), which is what the query-builder types require.
  const base = client.from('bookings').select(BOOKING_COLS, { count: 'exact' });
  const filtered = opts.status ? base.eq('status', opts.status) : base;
  let q = filtered.order('created_at', { ascending: false });
  q = range(q, opts);
  const { data, error, count } = await q;
  if (error) throw error;
  const rows = await decorateBookings(client, (data ?? []) as Record<string, unknown>[]);
  return { rows, total: count ?? 0 };
}

// ---- Live rides -----------------------------------------------------------

export interface OnlineBusRow {
  driverId: string;
  driverName: string | null;
  busNumber: string | null;
  registration_no: string | null;
  lat: number | null;
  lng: number | null;
  updated_at: string | null;
}

/** Buses currently online (driver_locations.is_online), with bus + driver names. */
export async function listOnlineBuses(): Promise<OnlineBusRow[]> {
  const client = db();
  const { data, error } = await client
    .from('driver_locations')
    .select('driver_id, lat, lng, updated_at')
    .eq('is_online', true)
    .order('updated_at', { ascending: false })
    // Defensive cap: this snapshot is rendered unpaginated, so bound it rather
    // than risk streaming an unbounded set (and PostgREST's 1000-row cap would
    // silently truncate it anyway). Freshest-online first, so the cap keeps the
    // most relevant rows.
    .limit(500);
  if (error) throw error;
  const rows = (data ?? []) as Record<string, unknown>[];
  if (rows.length === 0) return [];
  const driverIds = rows.map((r) => r.driver_id as string);
  // driver name via drivers.profile_id → profiles; bus via vehicles.driver_id.
  const drivers = await mapByIds<{ id: string; profile_id: string | null }>(client, 'drivers', 'id, profile_id', driverIds);
  const profiles = await mapByIds<{ id: string; full_name: string | null }>(
    client,
    'profiles',
    'id, full_name',
    [...drivers.values()].map((d) => d.profile_id),
  );
  const { data: veh } = await client
    .from('vehicles')
    .select('driver_id, bus_number, registration_no')
    .in('driver_id', driverIds);
  const vehByDriver = new Map<string, { bus_number: string | null; registration_no: string | null }>();
  for (const v of (veh ?? []) as Record<string, unknown>[]) {
    vehByDriver.set(v.driver_id as string, {
      bus_number: (v.bus_number as string) ?? null,
      registration_no: (v.registration_no as string) ?? null,
    });
  }
  return rows.map((r) => {
    const d = drivers.get(r.driver_id as string);
    const veh = vehByDriver.get(r.driver_id as string);
    return {
      driverId: r.driver_id as string,
      driverName: d?.profile_id ? (profiles.get(d.profile_id)?.full_name ?? null) : null,
      busNumber: veh?.bus_number ?? null,
      registration_no: veh?.registration_no ?? null,
      lat: (r.lat as number) ?? null,
      lng: (r.lng as number) ?? null,
      updated_at: (r.updated_at as string) ?? null,
    };
  });
}

export interface RideEventRow {
  id: string;
  stage: string;
  studentName: string | null;
  routeName: string;
  recorded_at: string | null;
}

/** Recent boarding feed (BOARDED / REACHED / GOT_OFF). */
export async function listRideEvents(opts: PageOpts = {}): Promise<Paged<RideEventRow>> {
  const client = db();
  let q = client
    .from('ride_events')
    .select('id, stage, booking_id, student_id, recorded_at', { count: 'exact' })
    .order('recorded_at', { ascending: false });
  q = range(q, opts);
  const { data, error, count } = await q;
  if (error) throw error;
  const rows = (data ?? []) as Record<string, unknown>[];
  // Student name + route come through the booking (denormalized student_name).
  const bookings = await mapByIds<{ id: string; student_name: string | null; route_id: string | null }>(
    client,
    'bookings',
    'id, student_name, route_id',
    rows.map((r) => r.booking_id as string),
  );
  const routes = await mapByIds<{ id: string; name: string }>(
    client,
    'routes',
    'id, name',
    [...bookings.values()].map((b) => b.route_id),
  );
  return {
    rows: rows.map((r) => {
      const b = bookings.get(r.booking_id as string);
      return {
        id: r.id as string,
        stage: r.stage as string,
        studentName: b?.student_name ?? null,
        routeName: b?.route_id ? (routes.get(b.route_id)?.name ?? '—') : '—',
        recorded_at: (r.recorded_at as string) ?? null,
      };
    }),
    total: count ?? 0,
  };
}

// ---- Drivers --------------------------------------------------------------

export interface DriverRow {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  license_no: string | null;
  is_active: boolean | null;
  agencyName: string;
  busNumber: string | null;
  isOnline: boolean;
}

export async function listDrivers(opts: PageOpts = {}): Promise<Paged<DriverRow>> {
  const client = db();
  let q = client
    .from('drivers')
    .select('id, profile_id, agency_id, license_no, is_active', { count: 'exact' })
    .eq('is_deleted', false)
    .order('created_at', { ascending: false });
  q = range(q, opts);
  const { data, error, count } = await q;
  if (error) throw error;
  const rows = (data ?? []) as Record<string, unknown>[];
  const driverIds = rows.map((r) => r.id as string);
  const [profiles, agencies] = await Promise.all([
    mapByIds<{ id: string; full_name: string | null; email: string | null; phone: string | null }>(
      client,
      'profiles',
      'id, full_name, email, phone',
      rows.map((r) => r.profile_id as string),
    ),
    mapByIds<{ id: string; name: string }>(client, 'agencies', 'id, name', rows.map((r) => r.agency_id as string)),
  ]);
  const { data: veh } = await client.from('vehicles').select('driver_id, bus_number').in('driver_id', driverIds);
  const busByDriver = new Map<string, string | null>();
  for (const v of (veh ?? []) as Record<string, unknown>[]) busByDriver.set(v.driver_id as string, (v.bus_number as string) ?? null);
  const { data: loc } = await client.from('driver_locations').select('driver_id, is_online').in('driver_id', driverIds);
  const onlineSet = new Set((loc ?? []).filter((l) => (l as Record<string, unknown>).is_online).map((l) => (l as Record<string, unknown>).driver_id as string));
  return {
    rows: rows.map((r) => {
      const p = profiles.get(r.profile_id as string);
      return {
        id: r.id as string,
        name: p?.full_name ?? null,
        email: p?.email ?? null,
        phone: p?.phone ?? null,
        license_no: (r.license_no as string) ?? null,
        is_active: (r.is_active as boolean) ?? null,
        agencyName: agencies.get(r.agency_id as string)?.name ?? '—',
        busNumber: busByDriver.get(r.id as string) ?? null,
        isOnline: onlineSet.has(r.id as string),
      };
    }),
    total: count ?? 0,
  };
}

// ---- Parents & child links ------------------------------------------------

export interface ParentRow {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  children: string[];
}

export async function listParents(opts: PageOpts = {}): Promise<Paged<ParentRow>> {
  const client = db();
  let q = client.from('parents').select('id, profile_id', { count: 'exact' }).order('created_at', { ascending: false });
  q = range(q, opts);
  const { data, error, count } = await q;
  if (error) throw error;
  const rows = (data ?? []) as Record<string, unknown>[];
  const parentIds = rows.map((r) => r.id as string);
  const profiles = await mapByIds<{ id: string; full_name: string | null; email: string | null; phone: string | null }>(
    client,
    'profiles',
    'id, full_name, email, phone',
    rows.map((r) => r.profile_id as string),
  );
  // Linked children: parent_students → students → profiles (child names).
  const { data: links } = await client.from('parent_students').select('parent_id, student_id').in('parent_id', parentIds);
  const linkRows = (links ?? []) as { parent_id: string; student_id: string }[];
  const students = await mapByIds<{ id: string; profile_id: string | null }>(
    client,
    'students',
    'id, profile_id',
    linkRows.map((l) => l.student_id),
  );
  const childProfiles = await mapByIds<{ id: string; full_name: string | null }>(
    client,
    'profiles',
    'id, full_name',
    [...students.values()].map((s) => s.profile_id),
  );
  const childrenByParent = new Map<string, string[]>();
  for (const l of linkRows) {
    const st = students.get(l.student_id);
    const nm = st?.profile_id ? (childProfiles.get(st.profile_id)?.full_name ?? 'Unnamed') : 'Unnamed';
    const arr = childrenByParent.get(l.parent_id) ?? [];
    arr.push(nm);
    childrenByParent.set(l.parent_id, arr);
  }
  return {
    rows: rows.map((r) => {
      const p = profiles.get(r.profile_id as string);
      return {
        id: r.id as string,
        name: p?.full_name ?? null,
        email: p?.email ?? null,
        phone: p?.phone ?? null,
        children: childrenByParent.get(r.id as string) ?? [],
      };
    }),
    total: count ?? 0,
  };
}

export interface ParentChildDetail {
  studentId: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  campus: string | null;
  /** A login-less "managed" child (added by the parent) vs a logged-in student
   *  who linked the parent via a code. */
  managed: boolean;
  rideRoute: string | null;
  rideStatus: string | null;
}
export interface ParentDetailRow {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  children: ParentChildDetail[];
}

/**
 * Parents with the FULL details of every child they're linked to — name, email,
 * phone, campus, whether it's a logged-in student (who granted access via a code)
 * or a login-less managed child, and the child's current active ride. For the
 * admin "Parents" cards. Service-role; batched (no N+1).
 */
export async function listParentsDetailed(opts: PageOpts = {}): Promise<Paged<ParentDetailRow>> {
  const client = db();
  let q = client.from('parents').select('id, profile_id', { count: 'exact' }).order('created_at', { ascending: false });
  q = range(q, opts);
  const { data, error, count } = await q;
  if (error) throw error;
  const rows = (data ?? []) as Record<string, unknown>[];
  const parentIds = rows.map((r) => r.id as string);
  const parentProfiles = await mapByIds<{ id: string; full_name: string | null; email: string | null; phone: string | null }>(
    client, 'profiles', 'id, full_name, email, phone', rows.map((r) => r.profile_id as string),
  );

  const { data: links } = await client.from('parent_students').select('parent_id, student_id').in('parent_id', parentIds);
  const linkRows = (links ?? []) as { parent_id: string; student_id: string }[];
  const studentIds = linkRows.map((l) => l.student_id);
  const students = await mapByIds<{ id: string; profile_id: string | null; full_name: string | null; phone: string | null; email: string | null; institution_id: string | null }>(
    client, 'students', 'id, profile_id, full_name, phone, email, institution_id', studentIds,
  );
  const studentProfiles = await mapByIds<{ id: string; full_name: string | null; email: string | null; phone: string | null }>(
    client, 'profiles', 'id, full_name, email, phone', [...students.values()].map((s) => s.profile_id),
  );
  const insts = await mapByIds<{ id: string; name: string }>(
    client, 'institutions', 'id, name', [...students.values()].map((s) => s.institution_id),
  );

  // Current active ride per linked student (one-active-booking model).
  const rideByStudent = new Map<string, { route: string | null; status: string }>();
  if (studentIds.length) {
    const { data: bks } = await client
      .from('bookings')
      .select('student_id, status, route_id')
      .in('student_id', studentIds)
      .in('status', ['PENDING', 'CONFIRMED']);
    const bkRows = (bks ?? []) as { student_id: string; status: string; route_id: string | null }[];
    const routes = await mapByIds<{ id: string; name: string }>(client, 'routes', 'id, name', bkRows.map((b) => b.route_id));
    for (const b of bkRows) {
      rideByStudent.set(b.student_id, { route: b.route_id ? (routes.get(b.route_id)?.name ?? null) : null, status: b.status });
    }
  }

  const childrenByParent = new Map<string, ParentChildDetail[]>();
  for (const l of linkRows) {
    const st = students.get(l.student_id);
    const prof = st?.profile_id ? studentProfiles.get(st.profile_id) : null;
    const ride = rideByStudent.get(l.student_id) ?? null;
    const child: ParentChildDetail = {
      studentId: l.student_id,
      name: prof?.full_name ?? st?.full_name ?? 'Unnamed',
      email: prof?.email ?? st?.email ?? null,
      phone: prof?.phone ?? st?.phone ?? null,
      campus: st?.institution_id ? (insts.get(st.institution_id)?.name ?? null) : null,
      managed: !st?.profile_id,
      rideRoute: ride?.route ?? null,
      rideStatus: ride?.status ?? null,
    };
    const arr = childrenByParent.get(l.parent_id) ?? [];
    arr.push(child);
    childrenByParent.set(l.parent_id, arr);
  }

  return {
    rows: rows.map((r) => {
      const p = parentProfiles.get(r.profile_id as string);
      return {
        id: r.id as string,
        name: p?.full_name ?? null,
        email: p?.email ?? null,
        phone: p?.phone ?? null,
        children: childrenByParent.get(r.id as string) ?? [],
      };
    }),
    total: count ?? 0,
  };
}

export interface LinkCodeRow {
  id: string;
  code: string;
  studentName: string | null;
  expires_at: string | null;
  used_at: string | null;
}

/** Active (unused, unexpired) parent-link codes. */
export async function listActiveLinkCodes(): Promise<LinkCodeRow[]> {
  const client = db();
  const { data, error } = await client
    .from('parent_link_codes')
    .select('id, code, student_id, expires_at, used_at')
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  const rows = (data ?? []) as Record<string, unknown>[];
  const students = await mapByIds<{ id: string; profile_id: string | null }>(
    client,
    'students',
    'id, profile_id',
    rows.map((r) => r.student_id as string),
  );
  const profiles = await mapByIds<{ id: string; full_name: string | null }>(
    client,
    'profiles',
    'id, full_name',
    [...students.values()].map((s) => s.profile_id),
  );
  return rows.map((r) => {
    const st = students.get(r.student_id as string);
    return {
      id: r.id as string,
      code: r.code as string,
      studentName: st?.profile_id ? (profiles.get(st.profile_id)?.full_name ?? null) : null,
      expires_at: (r.expires_at as string) ?? null,
      used_at: (r.used_at as string) ?? null,
    };
  });
}

// ---- Notifications --------------------------------------------------------

export interface NotificationRow {
  id: string;
  title: string;
  body: string | null;
  is_read: boolean;
  recipientName: string | null;
  created_at: string | null;
}

export async function listNotifications(opts: PageOpts = {}): Promise<Paged<NotificationRow>> {
  const client = db();
  let q = client
    .from('notifications')
    .select('id, title, body, is_read, recipient_id, created_at', { count: 'exact' })
    .order('created_at', { ascending: false });
  q = range(q, opts);
  const { data, error, count } = await q;
  if (error) throw error;
  const rows = (data ?? []) as Record<string, unknown>[];
  const profiles = await mapByIds<{ id: string; full_name: string | null; email: string | null }>(
    client,
    'profiles',
    'id, full_name, email',
    rows.map((r) => r.recipient_id as string),
  );
  return {
    rows: rows.map((r) => {
      const p = profiles.get(r.recipient_id as string);
      return {
        id: r.id as string,
        title: r.title as string,
        body: (r.body as string) ?? null,
        is_read: !!r.is_read,
        recipientName: p?.full_name ?? p?.email ?? null,
        created_at: (r.created_at as string) ?? null,
      };
    }),
    total: count ?? 0,
  };
}

// ---- Contact inquiries ----------------------------------------------------

export interface ContactMessageRow {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  organization: string | null;
  message: string;
  status: string;
  created_at: string | null;
}

export async function listContactMessages(opts: PageOpts = {}): Promise<Paged<ContactMessageRow>> {
  const client = db();
  let q = client
    .from('contact_messages')
    .select('id, name, email, phone, organization, message, status, created_at', { count: 'exact' })
    .order('created_at', { ascending: false });
  q = range(q, opts);
  const { data, error, count } = await q;
  if (error) throw error;
  return { rows: (data ?? []) as ContactMessageRow[], total: count ?? 0 };
}

// ---- UPI payments awaiting verification -----------------------------------

export interface PendingPaymentRow {
  bookingId: string;
  studentName: string | null;
  routeName: string;
  amountCents: number;
  utr: string | null;
  reference: string | null;
  submittedAt: string | null;
}

export interface CompletedPaymentRow {
  bookingId: string;
  studentName: string | null;
  studentEmail: string | null;
  routeName: string;
  amountCents: number;
  utr: string | null;
  reference: string | null;
  method: string | null;
  /** PAID = verified, FAILED = rejected. */
  status: string;
  submittedAt: string | null;
  verifiedAt: string | null;
  note: string | null;
}

/**
 * UPI payments the admin has already processed — verified (PAID) or rejected
 * (FAILED) — for the admin "Payment History" log: who paid, how much, the UTR
 * they submitted, and when it was verified. Service-role read.
 */
export async function listCompletedUpiPayments(opts: PageOpts = {}): Promise<Paged<CompletedPaymentRow>> {
  const client = db();
  let q = client
    .from('payments')
    .select('booking_id, amount_cents, upi_utr, reference, method, status, submitted_at, verified_at, verify_note', { count: 'exact' })
    // Every completed/processed payment — verified UPI ones (with a UTR) AND any
    // legacy/mock completions (no UTR). Newest verification first; the rest after.
    .in('status', ['PAID', 'FAILED'])
    .order('verified_at', { ascending: false, nullsFirst: false });
  q = range(q, opts);
  const { data, error, count } = await q;
  if (error) throw error;
  const rows = (data ?? []) as Record<string, unknown>[];
  const bookings = await mapByIds<{ id: string; student_name: string | null; student_email: string | null; route_id: string | null }>(
    client,
    'bookings',
    'id, student_name, student_email, route_id',
    rows.map((r) => r.booking_id as string),
  );
  const routes = await mapByIds<{ id: string; name: string }>(
    client,
    'routes',
    'id, name',
    [...bookings.values()].map((b) => b.route_id),
  );
  return {
    rows: rows.map((r) => {
      const b = bookings.get(r.booking_id as string);
      return {
        bookingId: r.booking_id as string,
        studentName: b?.student_name ?? null,
        studentEmail: b?.student_email ?? null,
        routeName: b?.route_id ? (routes.get(b.route_id)?.name ?? '—') : '—',
        amountCents: (r.amount_cents as number) ?? 0,
        utr: (r.upi_utr as string) ?? null,
        reference: (r.reference as string) ?? null,
        method: (r.method as string) ?? null,
        status: (r.status as string) ?? '',
        submittedAt: (r.submitted_at as string) ?? null,
        verifiedAt: (r.verified_at as string) ?? null,
        note: (r.verify_note as string) ?? null,
      };
    }),
    total: count ?? 0,
  };
}

/**
 * UPI payments a rider submitted (status CREATED = awaiting verification), for
 * the admin Payments queue. Service-role read; the seat is confirmed only when
 * the admin approves via verify_upi_payment.
 */
export async function listPendingUpiPayments(opts: PageOpts = {}): Promise<Paged<PendingPaymentRow>> {
  const client = db();
  let q = client
    .from('payments')
    .select('booking_id, amount_cents, upi_utr, reference, submitted_at', { count: 'exact' })
    .eq('status', 'CREATED')
    .not('submitted_at', 'is', null)
    .order('submitted_at', { ascending: true });
  q = range(q, opts);
  const { data, error, count } = await q;
  if (error) throw error;
  const rows = (data ?? []) as Record<string, unknown>[];
  const bookings = await mapByIds<{ id: string; student_name: string | null; route_id: string | null }>(
    client,
    'bookings',
    'id, student_name, route_id',
    rows.map((r) => r.booking_id as string),
  );
  const routes = await mapByIds<{ id: string; name: string }>(
    client,
    'routes',
    'id, name',
    [...bookings.values()].map((b) => b.route_id),
  );
  return {
    rows: rows.map((r) => {
      const b = bookings.get(r.booking_id as string);
      return {
        bookingId: r.booking_id as string,
        studentName: b?.student_name ?? null,
        routeName: b?.route_id ? (routes.get(b.route_id)?.name ?? '—') : '—',
        amountCents: (r.amount_cents as number) ?? 0,
        utr: (r.upi_utr as string) ?? null,
        reference: (r.reference as string) ?? null,
        submittedAt: (r.submitted_at as string) ?? null,
      };
    }),
    total: count ?? 0,
  };
}

// ---- Refunds awaiting processing ------------------------------------------

export interface PendingRefundRow {
  bookingId: string;
  studentName: string | null;
  routeName: string;
  /** Amount originally paid — prefill for the refund amount. */
  amountCents: number;
  payoutMethod: string | null; // 'UPI' | 'BANK'
  payoutDetails: string | null; // formatted UPI id or bank account line
  reason: string | null;
  requestedAt: string | null;
}

/**
 * Paid bookings the rider cancelled, whose refund the admin still has to send
 * (payments.refund_status = 'REQUESTED'). The payout details + cancel reason come
 * from the booking (bookings.refund_details / cancel_reason).
 */
export async function listPendingRefunds(opts: PageOpts = {}): Promise<Paged<PendingRefundRow>> {
  const client = db();
  let q = client
    .from('payments')
    .select('booking_id, amount_cents, updated_at', { count: 'exact' })
    .eq('refund_status', 'REQUESTED')
    .order('updated_at', { ascending: true });
  q = range(q, opts);
  const { data, error, count } = await q;
  if (error) throw error;
  const rows = (data ?? []) as Record<string, unknown>[];
  const bookings = await mapByIds<{
    id: string;
    student_name: string | null;
    route_id: string | null;
    refund_details: Record<string, unknown> | null;
    cancel_reason: string | null;
  }>(
    client,
    'bookings',
    'id, student_name, route_id, refund_details, cancel_reason',
    rows.map((r) => r.booking_id as string),
  );
  const routes = await mapByIds<{ id: string; name: string }>(
    client,
    'routes',
    'id, name',
    [...bookings.values()].map((b) => b.route_id),
  );
  return {
    rows: rows.map((r) => {
      const b = bookings.get(r.booking_id as string);
      const rd = (b?.refund_details ?? null) as Record<string, unknown> | null;
      const method = rd?.method as string | undefined;
      let details: string | null = null;
      if (method === 'UPI') details = (rd?.upi_id as string) ?? null;
      else if (method === 'BANK')
        details = [rd?.account_name, rd?.account_number, rd?.ifsc].filter(Boolean).join(' · ') || null;
      return {
        bookingId: r.booking_id as string,
        studentName: b?.student_name ?? null,
        routeName: b?.route_id ? (routes.get(b.route_id)?.name ?? '—') : '—',
        amountCents: (r.amount_cents as number) ?? 0,
        payoutMethod: method ?? null,
        payoutDetails: details,
        reason: b?.cancel_reason ?? null,
        requestedAt: (r.updated_at as string) ?? null,
      };
    }),
    total: count ?? 0,
  };
}

// ---- Student detail (everything a student filled) -------------------------
// Keyed by the STUDENT's profile id (that's what the Manage Students list uses).
// The `students` row — where the booking/"details" form saves address, class,
// guardian info — is linked by students.profile_id = profiles.id.

export interface StudentDetail {
  profile: { id: string; full_name: string | null; email: string | null; phone: string | null };
  student: {
    address: string | null;
    grade: string | null;
    guardian_name: string | null;
    guardian_phone: string | null;
    roll_no: string | null;
    qr_code: string | null;
  } | null;
  institutionName: string | null;
  bookings: BookingRow[];
  parents: { name: string | null; email: string | null; phone: string | null }[];
}

export async function getStudentDetail(profileId: string): Promise<StudentDetail | null> {
  const client = db();
  const { data: p, error } = await client
    .from('profiles')
    .select('id, full_name, email, phone, role')
    .eq('id', profileId)
    .maybeSingle();
  if (error) throw error;
  if (!p) return null;

  const { data: st, error: sErr } = await client
    .from('students')
    .select('id, address, grade, guardian_name, guardian_phone, roll_no, qr_code, institution_id')
    .eq('profile_id', profileId)
    .maybeSingle();
  if (sErr) throw sErr;

  let institutionName: string | null = null;
  let bookings: BookingRow[] = [];
  let parents: StudentDetail['parents'] = [];

  if (st) {
    if (st.institution_id) {
      const inst = await mapByIds<{ id: string; name: string }>(client, 'institutions', 'id, name', [st.institution_id as string]);
      institutionName = inst.get(st.institution_id as string)?.name ?? null;
    }
    const { data: bk, error: bErr } = await client
      .from('bookings')
      .select(BOOKING_COLS)
      .eq('student_id', st.id as string)
      .order('created_at', { ascending: false });
    if (bErr) throw bErr;
    bookings = await decorateBookings(client, (bk ?? []) as Record<string, unknown>[]);

    // Parents linked to this student.
    const { data: links } = await client.from('parent_students').select('parent_id').eq('student_id', st.id as string);
    const parentIds = (links ?? []).map((l) => (l as { parent_id: string }).parent_id);
    if (parentIds.length) {
      const parentRows = await mapByIds<{ id: string; profile_id: string | null }>(client, 'parents', 'id, profile_id', parentIds);
      const profs = await mapByIds<{ id: string; full_name: string | null; email: string | null; phone: string | null }>(
        client,
        'profiles',
        'id, full_name, email, phone',
        [...parentRows.values()].map((pr) => pr.profile_id),
      );
      parents = [...parentRows.values()].map((pr) => {
        const prof = pr.profile_id ? profs.get(pr.profile_id) : undefined;
        return { name: prof?.full_name ?? null, email: prof?.email ?? null, phone: prof?.phone ?? null };
      });
    }
  }

  return {
    profile: {
      id: p.id as string,
      full_name: (p.full_name as string) ?? null,
      email: (p.email as string) ?? null,
      phone: (p.phone as string) ?? null,
    },
    student: st
      ? {
          address: (st.address as string) ?? null,
          grade: (st.grade as string) ?? null,
          guardian_name: (st.guardian_name as string) ?? null,
          guardian_phone: (st.guardian_phone as string) ?? null,
          roll_no: (st.roll_no as string) ?? null,
          qr_code: (st.qr_code as string) ?? null,
        }
      : null,
    institutionName,
    bookings,
    parents,
  };
}

// ---- Driver detail (full KYC the agency entered) --------------------------

export interface DriverDetail {
  driver: Record<string, unknown>;
  name: string | null;
  email: string | null;
  phone: string | null;
  agencyName: string;
  vehicle: { id: string; bus_number: string | null; registration_no: string | null } | null;
  isOnline: boolean;
  lastPing: string | null;
  changes: {
    id: string;
    driver_name: string | null;
    driver_phone: string | null;
    role: string | null;
    reason: string | null;
    effective_date: string | null;
    created_at: string | null;
  }[];
}

export async function getDriverDetail(id: string): Promise<DriverDetail | null> {
  const client = db();
  const { data: d, error } = await client.from('drivers').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!d) return null;
  const driver = d as Record<string, unknown>;

  const [profiles, agencies] = await Promise.all([
    mapByIds<{ id: string; full_name: string | null; email: string | null; phone: string | null }>(
      client,
      'profiles',
      'id, full_name, email, phone',
      [driver.profile_id as string],
    ),
    mapByIds<{ id: string; name: string }>(client, 'agencies', 'id, name', [driver.agency_id as string]),
  ]);
  const prof = driver.profile_id ? profiles.get(driver.profile_id as string) : undefined;

  const { data: veh } = await client
    .from('vehicles')
    .select('id, bus_number, registration_no')
    .eq('driver_id', id)
    .limit(1)
    .maybeSingle();

  const { data: loc } = await client
    .from('driver_locations')
    .select('is_online, updated_at')
    .eq('driver_id', id)
    .maybeSingle();

  const { data: chg } = await client
    .from('bus_driver_changes')
    .select('id, driver_name, driver_phone, role, reason, effective_date, created_at')
    .eq('driver_id', id)
    .order('created_at', { ascending: false })
    .limit(25);

  return {
    driver,
    name: prof?.full_name ?? null,
    email: prof?.email ?? null,
    phone: prof?.phone ?? null,
    agencyName: agencies.get(driver.agency_id as string)?.name ?? '—',
    vehicle: veh ? { id: veh.id as string, bus_number: (veh.bus_number as string) ?? null, registration_no: (veh.registration_no as string) ?? null } : null,
    isOnline: !!(loc as { is_online?: boolean } | null)?.is_online,
    lastPing: (loc as { updated_at?: string } | null)?.updated_at ?? null,
    changes: (chg ?? []) as DriverDetail['changes'],
  };
}

// ---- Reviews (moderation) -------------------------------------------------

export interface OpsReviewRow {
  id: string;
  rating: number;
  comment: string | null;
  is_hidden: boolean;
  created_at: string;
  agencyName: string;
  reviewer: string;
}

/**
 * All agency reviews (incl. hidden) for the moderation console. Service-role
 * read; resolves the agency name and the reviewer's name (from the qualifying
 * booking's student_name) in JS to avoid fragile multi-FK embeds.
 */
export async function listReviews(opts: PageOpts = {}): Promise<Paged<OpsReviewRow>> {
  const client = db();
  let q = client
    .from('reviews')
    .select('id, rating, comment, is_hidden, created_at, agency_id, booking_id', { count: 'exact' })
    .order('created_at', { ascending: false });
  q = range(q, opts);
  const { data, error, count } = await q;
  if (error) throw error;
  const rows = (data ?? []) as Record<string, unknown>[];
  if (rows.length === 0) return { rows: [], total: count ?? 0 };

  const agencies = await mapByIds<{ id: string; name: string | null }>(
    client,
    'agencies',
    'id, name',
    rows.map((r) => r.agency_id as string),
  );
  const bookings = await mapByIds<{ id: string; student_name: string | null }>(
    client,
    'bookings',
    'id, student_name',
    rows.map((r) => r.booking_id as string | null),
  );
  return {
    rows: rows.map((r) => ({
      id: r.id as string,
      rating: r.rating as number,
      comment: (r.comment as string) ?? null,
      is_hidden: !!r.is_hidden,
      created_at: r.created_at as string,
      agencyName: agencies.get(r.agency_id as string)?.name ?? '—',
      reviewer: (r.booking_id ? bookings.get(r.booking_id as string)?.student_name : null) ?? 'Rider',
    })),
    total: count ?? 0,
  };
}
