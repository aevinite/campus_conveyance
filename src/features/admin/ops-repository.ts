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

  const assignments = [];
  for (const a of assignmentRows) {
    const alloc = allocs.get(a.id);
    const riders = alloc ? await ridersForAllocation(client, alloc.id) : [];
    assignments.push({
      assignmentId: a.id,
      routeId: a.route_id,
      routeName: a.route_id ? (routes.get(a.route_id)?.name ?? '—') : '—',
      totalSeats: alloc?.total_seats ?? null,
      reservedSeats: alloc?.reserved_seats ?? null,
      riders,
    });
  }

  // Live GPS (driver_locations keyed by drivers.id, which is vehicles.driver_id).
  let live = null;
  if (vehicle.driver_id) {
    const { data: loc } = await client
      .from('driver_locations')
      .select('is_online, lat, lng, updated_at')
      .eq('driver_id', vehicle.driver_id as string)
      .maybeSingle();
    if (loc) live = loc as VehicleDetail['live'];
  }

  const { data: chg } = await client
    .from('bus_driver_changes')
    .select('id, driver_name, driver_phone, role, reason, effective_date, created_at')
    .eq('vehicle_id', id)
    .order('created_at', { ascending: false })
    .limit(25);

  return {
    vehicle,
    agencyName,
    assignments,
    live,
    changes: (chg ?? []) as VehicleDetail['changes'],
  };
}

/** Riders (bookings) attached to a seat allocation, with stop names resolved. */
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
  const { data, error } = await client.from(table).select(fk).in(fk, uniq);
  if (error) throw error;
  for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
    const k = row[fk] as string;
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

export interface RouteDetail {
  route: Record<string, unknown>;
  institutionName: string;
  agencyName: string;
  busNumber: string | null;
  stops: { id: string; name: string; sequence: number | null; address: string | null; lat: number | null; lng: number | null }[];
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

  const { data: stopData } = await client
    .from('route_stops')
    .select('id, name, sequence, address, lat, lng')
    .eq('route_id', id)
    .order('sequence', { ascending: true });
  const stops = (stopData ?? []) as RouteDetail['stops'];

  // Occupancy + riders via this route's assignment → seat allocation.
  const { data: asg } = await client.from('route_assignments').select('id').eq('route_id', id).limit(1).maybeSingle();
  let occupancy: RouteDetail['occupancy'] = null;
  let riders: SeatRider[] = [];
  if (asg?.id) {
    const { data: alloc } = await client
      .from('seat_allocations')
      .select('id, total_seats, reserved_seats')
      .eq('route_assignment_id', asg.id as string)
      .maybeSingle();
    if (alloc) {
      occupancy = { totalSeats: (alloc.total_seats as number) ?? null, reservedSeats: (alloc.reserved_seats as number) ?? null };
      riders = await ridersForAllocation(client, alloc.id as string);
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

export async function listBookings(
  opts: PageOpts & { status?: string } = {},
): Promise<Paged<BookingRow>> {
  const client = db();
  // Apply the status filter (a filter op) BEFORE .order()/.range() (transform
  // ops), which is what the query-builder types require.
  const base = client
    .from('bookings')
    .select(
      'id, student_name, student_email, route_id, pickup_stop_id, drop_stop_id, status, is_paid, created_at, paid_at',
      { count: 'exact' },
    );
  const filtered = opts.status ? base.eq('status', opts.status) : base;
  let q = filtered.order('created_at', { ascending: false });
  q = range(q, opts);
  const { data, error, count } = await q;
  if (error) throw error;
  const rows = (data ?? []) as Record<string, unknown>[];
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
  return {
    rows: rows.map((r) => {
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
    }),
    total: count ?? 0,
  };
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
    .order('updated_at', { ascending: false });
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
