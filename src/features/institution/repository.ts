// ---------------------------------------------------------------------------
// Institution (college) OPERATIONS repository — read-only oversight scoped to a
// SINGLE campus.
//
// Like the admin ops repo, the marketplace's operational tables (routes,
// bookings, vehicles, seat_allocations, driver_locations, agency_services) are
// RLS-locked to the owning agency/driver/student. An INSTITUTION_ADMIN has no
// RLS grant across them, and RLS tenant isolation doesn't even cover several of
// these tables — so this module uses the SERVICE-ROLE client (bypasses RLS).
//
// That is safe ONLY because every read is hard-filtered by `institution_id`, and
// that id is ALWAYS resolved from the authenticated session (JWT claim, else the
// caller's profiles row) via `resolveInstitutionId()` — NEVER from user input —
// and every page sits under a requireRole('INSTITUTION_ADMIN') gate.
// ---------------------------------------------------------------------------
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { getSessionClaims } from '@/features/auth/session';
import {
  listInstitutionRoutes,
  countInstitutionRoutes,
  type CampusRoute,
  type CampusRouteQuery,
} from '@/features/catalog/repository';

export const INSTITUTION_PAGE_SIZE = 50;
const LIVE_FRESH_MS = 2 * 60 * 1000; // a bus is "online now" only if pinged < 2 min ago

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

/** Fetch `key in (ids)` from `table` and index rows by `key`. */
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

/**
 * The campus the signed-in institution admin represents. Claim-first (the custom
 * access-token hook injects app_metadata.institution_id from profiles), with a
 * service-role profiles fallback so the panel still works if the JWT hook isn't
 * enabled on an environment or the session predates the link. Returns null when
 * the account isn't linked to a campus yet (or the caller is a super-admin with
 * no campus) — callers render an empty state rather than crashing.
 */
export async function resolveInstitutionId(): Promise<string | null> {
  const server = await createClient();
  const { userId, role, institutionId } = await getSessionClaims(server);
  if (institutionId) return institutionId;
  if (!userId || (role !== 'INSTITUTION_ADMIN' && role !== 'SUPER_ADMIN')) return null;
  const { data } = await db()
    .from('profiles')
    .select('institution_id')
    .eq('id', userId)
    .maybeSingle();
  return ((data?.institution_id as string) ?? null) || null;
}

// ---- Overview (dashboard home KPIs + charts) ------------------------------

export interface InstitutionOverview {
  routeCount: number;
  agencyCount: number;
  studentsBooked: number;
  seats: { total: number; reserved: number; available: number };
  perRoute: { routeId: string; routeName: string; students: number; total: number; available: number }[];
}

export async function institutionOverview(institutionId: string): Promise<InstitutionOverview> {
  const client = db();
  const [routes, studentsByRoute, agencies] = await Promise.all([
    listInstitutionRoutes(client, institutionId),
    studentCountsByRoute(client, institutionId),
    listAgenciesForInstitution(institutionId),
  ]);

  const total = routes.reduce((s, r) => s + (r.total ?? 0), 0);
  const available = routes.reduce((s, r) => s + (r.available ?? 0), 0);
  const perRoute = routes.map((r) => ({
    routeId: r.id,
    routeName: r.name,
    students: studentsByRoute.perRoute.get(r.id)?.size ?? 0,
    total: r.total ?? 0,
    available: r.available ?? 0,
  }));

  return {
    routeCount: routes.length,
    agencyCount: agencies.length,
    studentsBooked: studentsByRoute.allStudents.size,
    seats: { total, reserved: Math.max(total - available, 0), available },
    perRoute,
  };
}

/** Distinct active-booking students per route (+ overall) for this campus. */
async function studentCountsByRoute(
  client: SupabaseClient,
  institutionId: string,
): Promise<{ perRoute: Map<string, Set<string>>; allStudents: Set<string> }> {
  const { data, error } = await client
    .from('bookings')
    .select('route_id, student_id')
    .eq('institution_id', institutionId)
    .in('status', ['PENDING', 'CONFIRMED']);
  if (error) throw error;
  const perRoute = new Map<string, Set<string>>();
  const allStudents = new Set<string>();
  for (const b of (data ?? []) as { route_id: string | null; student_id: string | null }[]) {
    if (!b.route_id || !b.student_id) continue;
    if (!perRoute.has(b.route_id)) perRoute.set(b.route_id, new Set());
    perRoute.get(b.route_id)!.add(b.student_id);
    allStudents.add(b.student_id);
  }
  return { perRoute, allStudents };
}

// ---- Routes (with seat utilisation) ---------------------------------------

export async function listRoutesForInstitution(
  institutionId: string,
  opts: CampusRouteQuery = {},
): Promise<Paged<CampusRoute>> {
  const client = db();
  const [rows, total] = await Promise.all([
    listInstitutionRoutes(client, institutionId, opts),
    countInstitutionRoutes(client, institutionId, {
      query: opts.query,
      vehicleType: opts.vehicleType,
    }),
  ]);
  return { rows, total };
}

// ---- Agencies serving the campus ------------------------------------------

export interface AgencyServingRow {
  id: string;
  name: string;
  status: string;
  vehicleTypes: string[];
  routeCount: number;
}

export async function listAgenciesForInstitution(institutionId: string): Promise<AgencyServingRow[]> {
  const client = db();
  const { data: svc, error } = await client
    .from('agency_services')
    .select('agency_id, vehicle_type')
    .eq('institution_id', institutionId);
  if (error) throw error;
  const svcRows = (svc ?? []) as { agency_id: string; vehicle_type: string | null }[];
  if (svcRows.length === 0) return [];

  const typesByAgency = new Map<string, Set<string>>();
  for (const s of svcRows) {
    if (!typesByAgency.has(s.agency_id)) typesByAgency.set(s.agency_id, new Set());
    if (s.vehicle_type) typesByAgency.get(s.agency_id)!.add(s.vehicle_type);
  }

  const agencies = await mapByIds<{ id: string; name: string; status: string; is_deleted: boolean }>(
    client,
    'agencies',
    'id, name, status, is_deleted',
    [...typesByAgency.keys()],
  );

  // Routes this campus actually runs, grouped by agency (active routes only).
  const { data: routeRows, error: rErr } = await client
    .from('routes')
    .select('agency_id')
    .eq('institution_id', institutionId)
    .eq('is_active', true);
  if (rErr) throw rErr;
  const routeCounts = new Map<string, number>();
  for (const r of (routeRows ?? []) as { agency_id: string | null }[]) {
    if (r.agency_id) routeCounts.set(r.agency_id, (routeCounts.get(r.agency_id) ?? 0) + 1);
  }

  const out: AgencyServingRow[] = [];
  for (const [agencyId, types] of typesByAgency) {
    const a = agencies.get(agencyId);
    // Only agencies that are approved and not removed count as "serving" the campus.
    if (!a || a.status !== 'APPROVED' || a.is_deleted) continue;
    out.push({
      id: agencyId,
      name: a.name,
      status: a.status,
      vehicleTypes: [...types].sort(),
      routeCount: routeCounts.get(agencyId) ?? 0,
    });
  }
  return out.sort((x, y) => x.name.localeCompare(y.name));
}

// ---- Bookings (students booked) -------------------------------------------

export interface InstitutionBookingRow {
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
}

const BOOKING_COLS =
  'id, student_name, student_email, route_id, pickup_stop_id, drop_stop_id, status, is_paid, created_at';

export async function listBookingsForInstitution(
  institutionId: string,
  opts: PageOpts & { status?: string } = {},
): Promise<Paged<InstitutionBookingRow>> {
  const client = db();
  const base = client
    .from('bookings')
    .select(BOOKING_COLS, { count: 'exact' })
    .eq('institution_id', institutionId);
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
        dropStop: stops.get(r.drop_stop_id as string)?.name ?? 'Campus',
        status: r.status as string,
        isPaid: !!r.is_paid,
        created_at: (r.created_at as string) ?? null,
      };
    }),
    total: count ?? 0,
  };
}

// ---- Live buses heading to campus (list) ----------------------------------

export interface InstitutionLiveBusRow {
  driverId: string;
  driverName: string | null;
  busNumber: string | null;
  registration_no: string | null;
  routeName: string;
  lat: number | null;
  lng: number | null;
  updated_at: string | null;
}

export async function liveBusesForInstitution(institutionId: string): Promise<InstitutionLiveBusRow[]> {
  const client = db();
  // Campus routes → the vehicles that run them (routes.institution_id is the
  // reliable campus link; drivers.institution_id is unused post-marketplace).
  const { data: routeRows, error: rErr } = await client
    .from('routes')
    .select('name, vehicle_id')
    .eq('institution_id', institutionId)
    .eq('is_active', true);
  if (rErr) throw rErr;
  const routeByVehicle = new Map<string, string>();
  for (const r of (routeRows ?? []) as { name: string; vehicle_id: string | null }[]) {
    if (r.vehicle_id && !routeByVehicle.has(r.vehicle_id)) routeByVehicle.set(r.vehicle_id, r.name);
  }
  const vehicleIds = [...routeByVehicle.keys()];
  if (vehicleIds.length === 0) return [];

  const { data: vehRows, error: vErr } = await client
    .from('vehicles')
    .select('id, bus_number, registration_no, driver_id, driver_name')
    .in('id', vehicleIds);
  if (vErr) throw vErr;
  const vehicles = (vehRows ?? []) as {
    id: string; bus_number: string | null; registration_no: string | null;
    driver_id: string | null; driver_name: string | null;
  }[];
  const driverIds = [...new Set(vehicles.map((v) => v.driver_id).filter((x): x is string => !!x))];
  if (driverIds.length === 0) return [];

  const { data: locRows, error: lErr } = await client
    .from('driver_locations')
    .select('driver_id, lat, lng, updated_at')
    .eq('is_online', true)
    .in('driver_id', driverIds);
  if (lErr) throw lErr;
  const now = Date.now();
  const locByDriver = new Map<string, { lat: number | null; lng: number | null; updated_at: string | null }>();
  for (const l of (locRows ?? []) as { driver_id: string; lat: number | null; lng: number | null; updated_at: string | null }[]) {
    // Only genuinely-fresh pings count as "online now" — a stale row where the
    // driver never sent the offline beacon shouldn't show as a live bus.
    if (l.updated_at && now - new Date(l.updated_at).getTime() > LIVE_FRESH_MS) continue;
    locByDriver.set(l.driver_id, { lat: l.lat, lng: l.lng, updated_at: l.updated_at });
  }

  const out: InstitutionLiveBusRow[] = [];
  for (const v of vehicles) {
    if (!v.driver_id) continue;
    const loc = locByDriver.get(v.driver_id);
    if (!loc) continue;
    out.push({
      driverId: v.driver_id,
      driverName: v.driver_name ?? null,
      busNumber: v.bus_number ?? null,
      registration_no: v.registration_no ?? null,
      routeName: routeByVehicle.get(v.id) ?? '—',
      lat: loc.lat,
      lng: loc.lng,
      updated_at: loc.updated_at,
    });
  }
  return out.sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''));
}

// ---- Shared IST "today" helpers -------------------------------------------
// route_stop_progress / pickup_alerts key their day by the IST calendar date;
// ride_events is a timestamp we bound to IST midnight. Compute both from one
// clock read so a request never straddles two "days".

function istToday(): { dateStr: string; midnightIso: string } {
  const nowMs = Date.now();
  const ist = new Date(nowMs + 5.5 * 60 * 60 * 1000); // shift into IST wall-clock
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth();
  const d = ist.getUTCDate();
  const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  // The UTC instant of IST-midnight today = IST midnight minus the +5:30 offset.
  const midnightIso = new Date(Date.UTC(y, m, d) - 5.5 * 60 * 60 * 1000).toISOString();
  return { dateStr, midnightIso };
}

// ---- Riders & boarding status (transportation roster) ---------------------

export type BoardingStatus = 'WAITING' | 'BOARDED' | 'REACHED' | 'GOT_OFF';
export type PickupStopStatus = 'NEXT' | 'SKIPPED' | null;

export interface InstitutionRiderRow {
  bookingId: string;
  studentName: string | null;
  studentEmail: string | null;
  vehicleType: 'BUS' | 'VAN';
  busNumber: string | null;
  routeId: string;
  routeName: string;
  pickupStop: string;
  pickupSequence: number | null;
  bookingStatus: string; // PENDING | CONFIRMED
  boarding: BoardingStatus;
  stopStatus: PickupStopStatus; // status of THIS rider's pickup stop today
  approaching: boolean; // bus came within ~1.2 km of the pickup stop today
}

/**
 * Every active rider (PENDING/CONFIRMED booking) on this campus with their
 * pickup stop and TODAY's live status — the campus "who's riding + where are
 * they in the journey" view. All derived from existing tables (bookings +
 * route_stops + route_stop_progress + ride_events + pickup_alerts + vehicles),
 * exactly the joins the driver run-sheet does, re-scoped to the campus. Nothing
 * here is stored per-rider; boarding is the latest ride_event today, stop status
 * is the pickup stop's NEXT/SKIPPED marker today, "approaching" is a
 * pickup_alerts row today.
 */
export async function listRidersForInstitution(
  institutionId: string,
  opts: { vehicleType?: 'BUS' | 'VAN' } = {},
): Promise<InstitutionRiderRow[]> {
  const client = db();
  const { dateStr, midnightIso } = istToday();

  const { data: bkRows, error: bkErr } = await client
    .from('bookings')
    .select('id, student_name, student_email, route_id, pickup_stop_id, status')
    .eq('institution_id', institutionId)
    .in('status', ['PENDING', 'CONFIRMED']);
  if (bkErr) throw bkErr;
  const bookings = (bkRows ?? []) as {
    id: string; student_name: string | null; student_email: string | null;
    route_id: string | null; pickup_stop_id: string | null; status: string;
  }[];
  if (bookings.length === 0) return [];

  const routes = await mapByIds<{ id: string; name: string; vehicle_id: string | null; vehicle_type: string | null }>(
    client,
    'routes',
    'id, name, vehicle_id, vehicle_type',
    bookings.map((b) => b.route_id),
  );
  const vehicles = await mapByIds<{ id: string; bus_number: string | null }>(
    client,
    'vehicles',
    'id, bus_number',
    [...routes.values()].map((r) => r.vehicle_id),
  );
  const stops = await mapByIds<{ id: string; name: string; sequence: number | null }>(
    client,
    'route_stops',
    'id, name, sequence',
    bookings.map((b) => b.pickup_stop_id),
  );

  // Stop status today, keyed by `${route_id}:${stop_id}`.
  const progressKey = new Map<string, PickupStopStatus>();
  const routeIds = [...new Set(bookings.map((b) => b.route_id).filter((x): x is string => !!x))];
  if (routeIds.length > 0) {
    const { data: prog, error: pErr } = await client
      .from('route_stop_progress')
      .select('route_id, stop_id, status')
      .eq('service_date', dateStr)
      .in('route_id', routeIds);
    if (pErr) throw pErr;
    for (const p of (prog ?? []) as { route_id: string; stop_id: string; status: string }[]) {
      progressKey.set(`${p.route_id}:${p.stop_id}`, p.status as PickupStopStatus);
    }
  }

  // Latest boarding stage today per booking (ride_events is append-only; take the
  // most recent row recorded since IST midnight).
  const bookingIds = bookings.map((b) => b.id);
  const boardingByBooking = new Map<string, BoardingStatus>();
  {
    const { data: ev, error: eErr } = await client
      .from('ride_events')
      .select('booking_id, stage, recorded_at')
      .in('booking_id', bookingIds)
      .gte('recorded_at', midnightIso)
      .order('recorded_at', { ascending: false });
    if (eErr) throw eErr;
    for (const e of (ev ?? []) as { booking_id: string; stage: string }[]) {
      if (!boardingByBooking.has(e.booking_id)) {
        boardingByBooking.set(e.booking_id, e.stage as BoardingStatus);
      }
    }
  }

  // "Bus approaching" — a pickup_alerts row exists for this booking today.
  const approachingBookings = new Set<string>();
  {
    const { data: al, error: aErr } = await client
      .from('pickup_alerts')
      .select('booking_id')
      .eq('service_date', dateStr)
      .in('booking_id', bookingIds);
    if (aErr) throw aErr;
    for (const a of (al ?? []) as { booking_id: string }[]) approachingBookings.add(a.booking_id);
  }

  const rows: InstitutionRiderRow[] = [];
  for (const b of bookings) {
    const route = b.route_id ? routes.get(b.route_id) : undefined;
    const vehicleType = (route?.vehicle_type as 'BUS' | 'VAN') ?? 'BUS';
    if (opts.vehicleType && vehicleType !== opts.vehicleType) continue;
    const stop = b.pickup_stop_id ? stops.get(b.pickup_stop_id) : undefined;
    rows.push({
      bookingId: b.id,
      studentName: b.student_name ?? null,
      studentEmail: b.student_email ?? null,
      vehicleType,
      busNumber: route?.vehicle_id ? (vehicles.get(route.vehicle_id)?.bus_number ?? null) : null,
      routeId: b.route_id ?? '',
      routeName: route?.name ?? '—',
      pickupStop: stop?.name ?? '—',
      pickupSequence: stop?.sequence ?? null,
      bookingStatus: b.status,
      boarding: boardingByBooking.get(b.id) ?? 'WAITING',
      stopStatus:
        b.route_id && b.pickup_stop_id
          ? (progressKey.get(`${b.route_id}:${b.pickup_stop_id}`) ?? null)
          : null,
      approaching: approachingBookings.has(b.id),
    });
  }

  // Physical run-sheet order: by route, then pickup sequence (nulls last).
  return rows.sort(
    (a, b) =>
      a.routeName.localeCompare(b.routeName) ||
      (a.pickupSequence ?? 1e9) - (b.pickupSequence ?? 1e9) ||
      (a.studentName ?? '').localeCompare(b.studentName ?? ''),
  );
}

// ---- Drivers running this campus's routes ---------------------------------

export interface InstitutionDriverRow {
  driverId: string;
  name: string | null;
  phone: string | null;
  licenseNo: string | null;
  busNumber: string | null;
  registration_no: string | null;
  vehicleType: 'BUS' | 'VAN' | null;
  routeNames: string[];
  isOnline: boolean;
  updated_at: string | null;
}

/**
 * The drivers who run this campus's active routes. Drivers carry no campus FK
 * post-marketplace, so they're derived through routes → vehicles → drivers
 * (same join `liveBusesForInstitution` uses). One row per driver; a driver on
 * multiple campus routes lists all of them.
 */
export async function listDriversForInstitution(institutionId: string): Promise<InstitutionDriverRow[]> {
  const client = db();
  const { data: routeRows, error: rErr } = await client
    .from('routes')
    .select('name, vehicle_id')
    .eq('institution_id', institutionId)
    .eq('is_active', true);
  if (rErr) throw rErr;
  const routeNamesByVehicle = new Map<string, string[]>();
  for (const r of (routeRows ?? []) as { name: string; vehicle_id: string | null }[]) {
    if (!r.vehicle_id) continue;
    if (!routeNamesByVehicle.has(r.vehicle_id)) routeNamesByVehicle.set(r.vehicle_id, []);
    routeNamesByVehicle.get(r.vehicle_id)!.push(r.name);
  }
  const vehicleIds = [...routeNamesByVehicle.keys()];
  if (vehicleIds.length === 0) return [];

  const { data: vehRows, error: vErr } = await client
    .from('vehicles')
    .select('id, bus_number, registration_no, vehicle_type, driver_id, driver_name')
    .in('id', vehicleIds);
  if (vErr) throw vErr;
  const vehicles = (vehRows ?? []) as {
    id: string; bus_number: string | null; registration_no: string | null;
    vehicle_type: string | null; driver_id: string | null; driver_name: string | null;
  }[];

  const driverIds = [...new Set(vehicles.map((v) => v.driver_id).filter((x): x is string => !!x))];
  if (driverIds.length === 0) return [];

  const [drivers, locByDriver] = await Promise.all([
    mapByIds<{ id: string; profile_id: string | null; license_no: string | null }>(
      client,
      'drivers',
      'id, profile_id, license_no',
      driverIds,
    ),
    (async () => {
      const { data: locRows, error: lErr } = await client
        .from('driver_locations')
        .select('driver_id, is_online, updated_at')
        .in('driver_id', driverIds);
      if (lErr) throw lErr;
      const now = Date.now();
      const map = new Map<string, { isOnline: boolean; updated_at: string | null }>();
      for (const l of (locRows ?? []) as { driver_id: string; is_online: boolean; updated_at: string | null }[]) {
        const fresh = !!l.updated_at && now - new Date(l.updated_at).getTime() <= LIVE_FRESH_MS;
        map.set(l.driver_id, { isOnline: !!l.is_online && fresh, updated_at: l.updated_at });
      }
      return map;
    })(),
  ]);

  const profiles = await mapByIds<{ id: string; phone: string | null }>(
    client,
    'profiles',
    'id, phone',
    [...drivers.values()].map((d) => d.profile_id),
  );

  // One row per driver — merge the vehicles/routes they cover.
  const byDriver = new Map<string, InstitutionDriverRow>();
  for (const v of vehicles) {
    if (!v.driver_id) continue;
    const d = drivers.get(v.driver_id);
    const loc = locByDriver.get(v.driver_id);
    const existing = byDriver.get(v.driver_id);
    const routeNames = routeNamesByVehicle.get(v.id) ?? [];
    if (existing) {
      existing.routeNames = [...new Set([...existing.routeNames, ...routeNames])];
      continue;
    }
    byDriver.set(v.driver_id, {
      driverId: v.driver_id,
      name: v.driver_name ?? null,
      phone: d?.profile_id ? (profiles.get(d.profile_id)?.phone ?? null) : null,
      licenseNo: d?.license_no ?? null,
      busNumber: v.bus_number ?? null,
      registration_no: v.registration_no ?? null,
      vehicleType: (v.vehicle_type as 'BUS' | 'VAN') ?? null,
      routeNames,
      isOnline: loc?.isOnline ?? false,
      updated_at: loc?.updated_at ?? null,
    });
  }
  return [...byDriver.values()].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
}

// ---- Governance: agency service-area requests for this campus -------------

export interface InstitutionServiceRequestRow {
  id: string;
  agencyName: string;
  name: string;
  description: string | null;
  vehicleType: 'BUS' | 'VAN';
  status: string; // PENDING | APPROVED | REJECTED
  rejectedReason: string | null;
  created_at: string | null;
}

/**
 * Agencies asking to serve THIS campus. The campus admin approves/rejects them
 * (the only write capability of the panel). PENDING first, then most-recent.
 */
export async function listServiceRequestsForInstitution(
  institutionId: string,
): Promise<InstitutionServiceRequestRow[]> {
  const client = db();
  const { data, error } = await client
    .from('agency_service_requests')
    .select('id, agency_id, name, description, vehicle_type, status, rejected_reason, created_at')
    .eq('institution_id', institutionId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as {
    id: string; agency_id: string; name: string; description: string | null;
    vehicle_type: string | null; status: string; rejected_reason: string | null; created_at: string | null;
  }[];
  const agencies = await mapByIds<{ id: string; name: string }>(
    client,
    'agencies',
    'id, name',
    rows.map((r) => r.agency_id),
  );
  const out: InstitutionServiceRequestRow[] = rows.map((r) => ({
    id: r.id,
    agencyName: agencies.get(r.agency_id)?.name ?? '—',
    name: r.name,
    description: r.description,
    vehicleType: (r.vehicle_type as 'BUS' | 'VAN') ?? 'BUS',
    status: r.status,
    rejectedReason: r.rejected_reason,
    created_at: r.created_at,
  }));
  // PENDING first (needs action), then the rest already in most-recent order.
  return out.sort((a, b) => (a.status === 'PENDING' ? 0 : 1) - (b.status === 'PENDING' ? 0 : 1));
}

// ---- Reviews of agencies serving the campus -------------------------------

export interface CampusAgencyReview {
  id: string;
  rating: number;
  comment: string | null;
  created_at: string | null;
}
export interface CampusAgencyReviews {
  agencyId: string;
  agencyName: string;
  ratingAvg: number;
  ratingCount: number;
  reviews: CampusAgencyReview[];
}

/**
 * Aggregate rating + recent VISIBLE reviews for each agency serving this campus.
 * Read-only oversight of rider sentiment. Reviewer identity is omitted (the
 * campus admin isn't the review owner) — only rating + comment, like the public
 * route-detail block.
 */
export async function listCampusAgencyReviews(institutionId: string): Promise<CampusAgencyReviews[]> {
  const client = db();
  const agencies = await listAgenciesForInstitution(institutionId);
  if (agencies.length === 0) return [];
  const agencyIds = agencies.map((a) => a.id);

  const [{ data: agencyRatings }, { data: reviewRows }] = await Promise.all([
    client.from('agencies').select('id, rating_avg, rating_count').in('id', agencyIds),
    client
      .from('reviews')
      .select('id, agency_id, rating, comment, created_at')
      .in('agency_id', agencyIds)
      .eq('is_hidden', false)
      .order('created_at', { ascending: false }),
  ]);

  const ratingById = new Map<string, { avg: number; count: number }>();
  for (const a of (agencyRatings ?? []) as { id: string; rating_avg: number | string | null; rating_count: number | null }[]) {
    ratingById.set(a.id, { avg: Number(a.rating_avg) || 0, count: a.rating_count ?? 0 });
  }
  const reviewsByAgency = new Map<string, CampusAgencyReview[]>();
  for (const r of (reviewRows ?? []) as { id: string; agency_id: string; rating: number; comment: string | null; created_at: string | null }[]) {
    if (!reviewsByAgency.has(r.agency_id)) reviewsByAgency.set(r.agency_id, []);
    const list = reviewsByAgency.get(r.agency_id)!;
    if (list.length < 5) list.push({ id: r.id, rating: r.rating, comment: r.comment, created_at: r.created_at });
  }

  return agencies.map((a) => ({
    agencyId: a.id,
    agencyName: a.name,
    ratingAvg: ratingById.get(a.id)?.avg ?? 0,
    ratingCount: ratingById.get(a.id)?.count ?? 0,
    reviews: reviewsByAgency.get(a.id) ?? [],
  }));
}
