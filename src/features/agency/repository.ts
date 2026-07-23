import { cache } from 'react';
import { unstable_cache } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSessionClaims } from '@/features/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import { todayIST } from '@/lib/today-ist';

export interface MyAgency {
  id: string;
  name: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  rejected_reason: string | null;
}
export interface MyAgencyProfile {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  contact_person: string | null;
  legal_name: string | null;
  registration_no: string | null;
  gst_number: string | null;
  pan_number: string | null;
  registered_address: string | null;
  description: string | null;
  permit_doc_url: string | null;
  fitness_doc_url: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  created_at: string | null;
}

/** Full agency row for the signed-in owner — everything captured at signup. */
export async function getMyAgencyProfile(
  db: SupabaseClient,
): Promise<MyAgencyProfile | null> {
  const { userId } = await getSessionClaims(db);
  if (!userId) return null;
  const { data, error } = await db
    .from('agencies')
    .select(
      'id, name, email, phone, contact_person, legal_name, registration_no, gst_number, pan_number, registered_address, description, permit_doc_url, fitness_doc_url, status, created_at',
    )
    .eq('owner_profile_id', userId)
    .maybeSingle();
  if (error) throw error; // don't mask a transient failure as "no agency"
  return (data as MyAgencyProfile) ?? null;
}

export interface ServiceRow {
  id: string;
  name: string;
  vehicle_type: string;
  institutionId: string;
  institutionName: string;
}
export interface BusRow {
  id: string;
  bus_number: string | null;
  capacity: number;
  registration_no: string | null;
  is_ac: boolean;
}
export interface BusFull {
  id: string;
  bus_number: string | null;
  registration_no: string | null;
  capacity: number;
  is_ac: boolean;
  bus_model: string | null;
  bus_color: string | null;
  image_url: string | null;
  photos: string[];
  driver_id: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  driver_email: string | null;
  driver_license_no: string | null;
  driver_experience_years: number | null;
  driver_photo_url: string | null;
  driver_govt_id: string | null;
  driver_address: string | null;
  driver_alt_phone: string | null;
  driver_dob: string | null;
  driver_blood_group: string | null;
  driver_verified: boolean;
  // Conductor — the bus's second staff member.
  conductor_name: string | null;
  conductor_phone: string | null;
  conductor_govt_id: string | null;
  conductor_address: string | null;
  conductor_alt_phone: string | null;
  conductor_dob: string | null;
  conductor_blood_group: string | null;
  conductor_verified: boolean;
  // Today's substitutes (null when the regular person is on duty).
  today_driver_id: string | null;
  today_driver_name: string | null;
  today_driver_phone: string | null;
  today_driver_reason: string | null;
  today_conductor_id: string | null;
  today_conductor_name: string | null;
  today_conductor_phone: string | null;
  today_conductor_reason: string | null;
}
export interface BookingRow {
  booking_id: string;
  student_id: string | null;
  status: string;
  created_at: string;
  is_paid: boolean;
  paid_at: string | null;
  approved_at: string | null;
  payment_due: string | null;
  student_name: string | null;
  student_email: string | null;
  student_phone: string | null;
  student_address: string | null;
  student_grade: string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
  route_name: string | null;
  bus_number: string | null;
  bus_registration: string | null;
  pickup_name: string | null;
  drop_name: string | null;
  price_cents: number | null;
}
/** The agency owned by the signed-in user (null if none). */
// Memoized per request: the agency layout and the page both need the agency, so
// cache() collapses the duplicate lookups (and the claims read) into one query.
export const getMyAgency = cache(
  async (db: SupabaseClient): Promise<MyAgency | null> => {
    const { userId } = await getSessionClaims(db);
    if (!userId) return null;
    const { data, error } = await db
      .from('agencies')
      .select('id, name, status, rejected_reason')
      .eq('owner_profile_id', userId)
      .maybeSingle();
    if (error) throw error; // don't mask a transient failure as "No agency found"
    return (data as MyAgency) ?? null;
  },
);

export interface ServiceRequestRow {
  id: string;
  name: string;
  vehicle_type: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  rejected_reason: string | null;
  institutionName: string;
  created_at: string;
}

/** The agency's own service-area requests (any status), newest first. */
export async function listMyServiceRequests(
  db: SupabaseClient,
  agencyId: string,
): Promise<ServiceRequestRow[]> {
  const { data, error } = await db
    .from('agency_service_requests')
    .select('id, name, vehicle_type, status, rejected_reason, created_at, institutions(name)')
    .eq('agency_id', agencyId)
    .order('created_at', { ascending: false })
    .limit(1000); // defensive cap (owner-scoped, naturally small)
  if (error) throw error;
  return (data ?? []).map((r) => {
    const inst = r.institutions as { name: string } | { name: string }[] | null;
    return {
      id: r.id as string,
      name: r.name as string,
      vehicle_type: r.vehicle_type as string,
      status: r.status as ServiceRequestRow['status'],
      rejected_reason: (r.rejected_reason as string) ?? null,
      institutionName: (Array.isArray(inst) ? inst[0]?.name : inst?.name) ?? '—',
      created_at: r.created_at as string,
    };
  });
}

export async function listMyServices(
  db: SupabaseClient,
  agencyId: string,
): Promise<ServiceRow[]> {
  const { data, error } = await db
    .from('agency_services')
    .select('id, name, vehicle_type, institution_id, institutions(name)')
    .eq('agency_id', agencyId)
    .order('created_at', { ascending: false })
    .limit(1000); // defensive cap (owner-scoped)
  if (error) throw error;
  return (data ?? []).map((s) => {
    const inst = s.institutions as { name: string } | { name: string }[] | null;
    return {
      id: s.id as string,
      name: s.name as string,
      vehicle_type: s.vehicle_type as string,
      institutionId: s.institution_id as string,
      institutionName: (Array.isArray(inst) ? inst[0]?.name : inst?.name) ?? '—',
    };
  });
}

export async function listMyBuses(
  db: SupabaseClient,
  agencyId: string,
): Promise<BusRow[]> {
  const { data, error } = await db
    .from('vehicles')
    .select('id, bus_number, capacity, registration_no, is_ac')
    .eq('agency_id', agencyId)
    .order('created_at', { ascending: false })
    .limit(1000); // defensive cap (owner-scoped fleet)
  if (error) throw error;
  return (data ?? []).map((v) => ({
    id: v.id as string,
    bus_number: (v.bus_number as string) ?? null,
    capacity: v.capacity as number,
    registration_no: (v.registration_no as string) ?? null,
    is_ac: Boolean(v.is_ac),
  }));
}

/** Full details of every bus the agency has added (for the Manage Buses page). */
export async function countMyBusesFull(db: SupabaseClient, agencyId: string): Promise<number> {
  const { count, error } = await db
    .from('vehicles')
    .select('id', { count: 'exact', head: true })
    .eq('agency_id', agencyId);
  if (error) throw error;
  return count ?? 0;
}

export async function listMyBusesFull(
  db: SupabaseClient,
  agencyId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<BusFull[]> {
  let q = db
    .from('vehicles')
    .select(
      'id, bus_number, registration_no, capacity, is_ac, bus_model, bus_color, image_url, photos, driver_id, driver_name, driver_phone, driver_email, driver_license_no, driver_experience_years, driver_photo_url, driver_govt_id, driver_address, driver_alt_phone, driver_dob, driver_blood_group, driver_verified, conductor_name, conductor_phone, conductor_govt_id, conductor_address, conductor_alt_phone, conductor_dob, conductor_blood_group, conductor_verified',
    )
    .eq('agency_id', agencyId)
    .order('created_at', { ascending: false });
  if (opts.limit != null) {
    const off = opts.offset ?? 0;
    q = q.range(off, off + opts.limit - 1);
  }
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []).map((v) => ({
    id: v.id as string,
    bus_number: (v.bus_number as string) ?? null,
    registration_no: (v.registration_no as string) ?? null,
    capacity: v.capacity as number,
    is_ac: Boolean(v.is_ac),
    bus_model: (v.bus_model as string) ?? null,
    bus_color: (v.bus_color as string) ?? null,
    image_url: (v.image_url as string) ?? null,
    photos: (v.photos as string[]) ?? [],
    driver_id: (v.driver_id as string) ?? null,
    driver_name: (v.driver_name as string) ?? null,
    driver_phone: (v.driver_phone as string) ?? null,
    driver_email: (v.driver_email as string) ?? null,
    driver_license_no: (v.driver_license_no as string) ?? null,
    driver_experience_years: (v.driver_experience_years as number) ?? null,
    driver_photo_url: (v.driver_photo_url as string) ?? null,
    driver_govt_id: (v.driver_govt_id as string) ?? null,
    driver_address: (v.driver_address as string) ?? null,
    driver_alt_phone: (v.driver_alt_phone as string) ?? null,
    driver_dob: (v.driver_dob as string) ?? null,
    driver_blood_group: (v.driver_blood_group as string) ?? null,
    driver_verified: Boolean(v.driver_verified),
    conductor_name: (v.conductor_name as string) ?? null,
    conductor_phone: (v.conductor_phone as string) ?? null,
    conductor_govt_id: (v.conductor_govt_id as string) ?? null,
    conductor_address: (v.conductor_address as string) ?? null,
    conductor_alt_phone: (v.conductor_alt_phone as string) ?? null,
    conductor_dob: (v.conductor_dob as string) ?? null,
    conductor_blood_group: (v.conductor_blood_group as string) ?? null,
    conductor_verified: Boolean(v.conductor_verified),
    today_driver_id: null as string | null,
    today_driver_name: null as string | null,
    today_driver_phone: null as string | null,
    today_driver_reason: null as string | null,
    today_conductor_id: null as string | null,
    today_conductor_name: null as string | null,
    today_conductor_phone: null as string | null,
    today_conductor_reason: null as string | null,
  }));

  // Merge in today's substitutes (per bus, per role).
  const ids = rows.map((r) => r.id);
  if (ids.length > 0) {
    const { data: changes, error: chErr } = await db
      .from('bus_driver_changes')
      .select('vehicle_id, role, driver_id, driver_name, driver_phone, reason')
      .in('vehicle_id', ids)
      .eq('effective_date', todayIST());
    // Surface the error rather than showing the permanent driver over today's sub.
    if (chErr) throw chErr;
    const byKey = new Map(
      (changes ?? []).map((c) => [`${c.vehicle_id as string}:${c.role as string}`, c]),
    );
    for (const r of rows) {
      const d = byKey.get(`${r.id}:DRIVER`);
      if (d) {
        r.today_driver_id = (d.driver_id as string) ?? null;
        r.today_driver_name = (d.driver_name as string) ?? null;
        r.today_driver_phone = (d.driver_phone as string) ?? null;
        r.today_driver_reason = (d.reason as string) ?? null;
      }
      const c = byKey.get(`${r.id}:CONDUCTOR`);
      if (c) {
        r.today_conductor_id = (c.driver_id as string) ?? null;
        r.today_conductor_name = (c.driver_name as string) ?? null;
        r.today_conductor_phone = (c.driver_phone as string) ?? null;
        r.today_conductor_reason = (c.reason as string) ?? null;
      }
    }
  }
  return rows;
}

export interface RouteStopFull {
  name: string;
  description: string | null;
  lat: number | null;
  lng: number | null;
  address: string | null;
}
export interface RouteFull {
  id: string;
  name: string;
  price_cents: number | null;
  departure_time: string | null;
  institutionName: string;
  busLabel: string;
  hasBookings: boolean;
  stops: RouteStopFull[];
}

export async function countMyRoutesFull(db: SupabaseClient, agencyId: string): Promise<number> {
  const { count, error } = await db
    .from('routes')
    .select('id', { count: 'exact', head: true })
    .eq('agency_id', agencyId);
  if (error) throw error;
  return count ?? 0;
}

/** Full details of the agency's routes (for the Manage Routes page). */
export async function listMyRoutesFull(
  db: SupabaseClient,
  agencyId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<RouteFull[]> {
  let q = db
    .from('routes')
    .select(
      'id, name, price_cents, departure_time, institutions(name), vehicles(bus_number, registration_no), route_stops(name, description, lat, lng, address, sequence)',
    )
    .eq('agency_id', agencyId)
    .order('created_at', { ascending: false });
  if (opts.limit != null) {
    const off = opts.offset ?? 0;
    q = q.range(off, off + opts.limit - 1);
  }
  const { data, error } = await q;
  if (error) throw error;

  const rows = (data ?? []).map((r) => {
    const inst = r.institutions as { name: string } | { name: string }[] | null;
    const veh = r.vehicles as { bus_number: string | null; registration_no: string | null } | { bus_number: string | null; registration_no: string | null }[] | null;
    const v = Array.isArray(veh) ? veh[0] : veh;
    const stopsRaw = (r.route_stops ?? []) as {
      name: string; description: string | null; lat: number | null; lng: number | null; address: string | null; sequence: number;
    }[];
    return {
      id: r.id as string,
      name: r.name as string,
      price_cents: (r.price_cents as number) ?? null,
      departure_time: (r.departure_time as string) ?? null,
      institutionName: (Array.isArray(inst) ? inst[0]?.name : inst?.name) ?? '—',
      busLabel: v?.bus_number ? `Bus ${v.bus_number}` : v?.registration_no ?? 'Bus',
      hasBookings: false,
      stops: [...stopsRaw]
        .sort((a, b) => a.sequence - b.sequence)
        .map((s) => ({ name: s.name, description: s.description, lat: s.lat, lng: s.lng, address: s.address })),
    };
  });

  // Mark which routes already have bookings (so their stops are locked on edit).
  // The RPC returns only the DISTINCT route ids that have bookings — not every
  // booking row for a popular route.
  const ids = rows.map((r) => r.id);
  if (ids.length > 0) {
    const { data: bks } = await db.rpc('routes_with_bookings', { p_route_ids: ids });
    const withBookings = new Set((bks ?? []) as string[]);
    for (const r of rows) r.hasBookings = withBookings.has(r.id);
  }
  return rows;
}

export interface BookingPageOpts {
  /** Filter to a single booking_status (e.g. 'PENDING'); omit for all. */
  status?: string;
  /** Page size; omit for no limit (only the dashboard report needs all rows). */
  limit?: number;
  offset?: number;
}

export async function listMyBookings(
  db: SupabaseClient,
  agencyId: string,
  opts: BookingPageOpts = {},
): Promise<BookingRow[]> {
  const { data, error } = await db.rpc('agency_bookings', {
    p_agency_id: agencyId,
    p_status: opts.status ?? null,
    p_limit: opts.limit ?? null,
    p_offset: opts.offset ?? 0,
  });
  if (error) throw error;
  return (data ?? []) as BookingRow[];
}

/** Total bookings for an agency (optionally filtered by status), for pagination
 *  controls and the dashboard pending-count tile — no full-history fetch. */
export async function countMyBookings(
  db: SupabaseClient,
  agencyId: string,
  status?: string,
): Promise<number> {
  const { data, error } = await db.rpc('agency_bookings_count', {
    p_agency_id: agencyId,
    p_status: status ?? null,
  });
  if (error) throw error;
  return Number(data ?? 0);
}

/** CONFIRMED bookings for an agency EXCLUDING hidden (removed) students — the
 *  Manage Students list, paginated in the DB so limit/offset slots aren't
 *  consumed by hidden rows. */
export async function listOnboardBookings(
  db: SupabaseClient,
  agencyId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<BookingRow[]> {
  const { data, error } = await db.rpc('agency_onboard_bookings', {
    p_agency_id: agencyId,
    p_limit: opts.limit ?? null,
    p_offset: opts.offset ?? 0,
  });
  if (error) throw error;
  return (data ?? []) as BookingRow[];
}

/** Count of the same onboard (non-hidden CONFIRMED) bookings — the accurate
 *  pager total for Manage Students. */
export async function countOnboardBookings(
  db: SupabaseClient,
  agencyId: string,
): Promise<number> {
  const { data, error } = await db.rpc('agency_onboard_count', { p_agency_id: agencyId });
  if (error) throw error;
  return Number(data ?? 0);
}

export interface HiddenStudentRow {
  student_id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
}

/** Removed (hidden) students, paginated directly off agency_hidden_students
 *  (migration 0060) — was derived by loading the whole booking history and
 *  filtering `hidden` in JS. */
export async function listHiddenStudents(
  db: SupabaseClient,
  agencyId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<HiddenStudentRow[]> {
  const { data, error } = await db.rpc('agency_hidden_students_page', {
    p_agency_id: agencyId,
    p_limit: opts.limit ?? null,
    p_offset: opts.offset ?? 0,
  });
  if (error) throw error;
  return (data ?? []) as HiddenStudentRow[];
}

/** Count of removed students, for the Deleted Students pager. */
export async function countHiddenStudents(
  db: SupabaseClient,
  agencyId: string,
): Promise<number> {
  const { data, error } = await db.rpc('agency_hidden_students_count', { p_agency_id: agencyId });
  if (error) throw error;
  return Number(data ?? 0);
}

export interface DriverRow {
  driver_id: string;
  profile_id: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  license_no: string | null;
  aadhaar_no: string | null;
  address: string | null;
  blood_group: string | null;
  dob: string | null;
  alt_phone: string | null;
  is_active: boolean;
  is_deleted: boolean;
  created_at: string;
}
// Memoized per request: the buses page needs the driver list both directly (the
// bus card's driver dropdown) and via listUnassignedDrivers (the substitute
// pool), which would otherwise run the agency_drivers RPC twice per render.
export const listMyDrivers = cache(
  async (db: SupabaseClient, agencyId: string): Promise<DriverRow[]> => {
    // Defensive cap — feeds the bus driver dropdown + substitute pool, not a
    // paged list (an agency's roster is naturally small, but never unbounded).
    const { data, error } = await db.rpc('agency_drivers', { p_agency_id: agencyId }).limit(1000);
    if (error) throw error;
    return (data ?? []) as DriverRow[];
  },
);

/** Paginated drivers filtered by is_deleted (migration 0064) — the Manage
 *  Drivers (deleted=false) and Deleted Drivers (deleted=true) pages. Replaces
 *  loading the whole roster and splitting is_deleted in JS. */
export async function listMyDriversPage(
  db: SupabaseClient,
  agencyId: string,
  opts: { deleted: boolean; limit?: number; offset?: number },
): Promise<DriverRow[]> {
  const { data, error } = await db.rpc('agency_drivers_page', {
    p_agency_id: agencyId,
    p_deleted: opts.deleted,
    p_limit: opts.limit ?? null,
    p_offset: opts.offset ?? 0,
  });
  if (error) throw error;
  return (data ?? []) as DriverRow[];
}

/** Count of the agency's drivers with the given is_deleted state — pager total. */
export async function countMyDrivers(
  db: SupabaseClient,
  agencyId: string,
  deleted: boolean,
): Promise<number> {
  const { data, error } = await db.rpc('agency_drivers_count', {
    p_agency_id: agencyId,
    p_deleted: deleted,
  });
  if (error) throw error;
  return Number(data ?? 0);
}

export interface UnassignedDriver {
  driver_id: string;
  name: string;
  phone: string | null;
  license_no: string | null;
}

/**
 * Registered drivers of this agency who are ACTIVE and not the permanent driver
 * of any bus — the pool eligible to be a substitute ("change driver for today").
 */
export async function listUnassignedDrivers(
  db: SupabaseClient,
  agencyId: string,
): Promise<UnassignedDriver[]> {
  const [drivers, vehiclesRes] = await Promise.all([
    listMyDrivers(db, agencyId),
    db.from('vehicles').select('driver_id').eq('agency_id', agencyId).not('driver_id', 'is', null),
  ]);
  // Surface a read failure — a null `data` would empty the `assigned` set and let
  // an already-assigned permanent driver appear in the substitute pool (→ one
  // person on two buses for the day).
  if (vehiclesRes.error) throw vehiclesRes.error;
  const assigned = new Set((vehiclesRes.data ?? []).map((v) => v.driver_id as string));
  return drivers
    .filter((d) => d.is_active && !d.is_deleted && !assigned.has(d.driver_id))
    .map((d) => ({
      driver_id: d.driver_id,
      name: d.name ?? d.email ?? 'Driver',
      phone: d.phone,
      license_no: d.license_no,
    }));
}

// Shape of the agency dashboard counts, embedded in AgencyReport below.
export interface AgencyCounts {
  services: number;
  buses: number;
  routes: number;
  pending: number;
}

export interface CollegeFleetRow {
  name: string;
  buses: number;
  vans: number;
}
export interface RevenueByRoute {
  name: string;
  bookings: number;
  revenueCents: number;
}
export interface AgencyReport {
  counts: AgencyCounts;
  fleet: { buses: number; vans: number };
  // Buses & vans the agency runs at each school/college (from its routes there).
  fleetByCollege: CollegeFleetRow[];
  routesByInstitution: { name: string; routes: number }[];
  bookings: { pending: number; confirmed: number; rejected: number; cancelled: number; total: number };
  studentsCount: number;
  // Revenue = paid + confirmed bookings × their route price (in paise/cents),
  // bucketed by when the payment actually happened (paid_at).
  revenue: { todayCents: number; monthCents: number; totalCents: number; byRoute: RevenueByRoute[] };
  generatedAt: string;
}

/**
 * Dashboard/report aggregates for one agency: fleet split (bus vs van), fleet per
 * service, routes per school/college, and booking-status proportions. Mirrors the
 * admin report but scoped to the caller's own agency (RLS already limits rows).
 */
// All aggregation happens in SQL (GROUP BY) via the agency_report RPC — no more
// streaming every booking/vehicle/student row into Node to reduce in JS (which
// also truncated at PostgREST's ~1000-row cap). Cached 60s + service-role: the
// RPC is granted to service_role only, and the caller always passes its OWN
// agencyId (resolved via getMyAgency), so ownership is already enforced.
type AgencyReportAgg = {
  fleet?: { buses: number; vans: number };
  fleetByCollege?: CollegeFleetRow[];
  routesByInstitution?: { name: string; routes: number }[];
  bookings?: { pending: number; confirmed: number; rejected: number; cancelled: number; total: number };
  revenue?: { todayCents: number; monthCents: number; totalCents: number; byRoute: RevenueByRoute[] };
  studentsCount?: number;
  servicesCount?: number;
  routesTotal?: number;
};

/** Tag an agency's cached report uniquely so one agency's write only busts its
 *  OWN cache — a shared static tag made every write invalidate every agency's
 *  report (the 60s cache was almost never warm on a multi-agency platform). */
export const agencyReportTag = (agencyId: string) => `agency-report:${agencyId}`;

async function cachedAgencyReportAgg(agencyId: string): Promise<AgencyReportAgg> {
  // Per-agency cache: keyed AND tagged by agencyId. Built per call so the tag can
  // include the id (unstable_cache tags are static); the id in keyParts means
  // repeated calls still hit the same entry. Busted by updateTag(agencyReportTag).
  const cached = unstable_cache(
    async (): Promise<AgencyReportAgg> => {
      const admin = createAdminClient();
      const { data, error } = await admin.rpc('agency_report', { p_agency_id: agencyId });
      // Throw so a transient failure MISSES the cache — caching {} would pin the
      // dashboard to all-zeros for 60s after the DB recovers.
      if (error) throw error;
      return (data ?? {}) as AgencyReportAgg;
    },
    ['agency-report-agg', agencyId],
    { revalidate: 60, tags: [agencyReportTag(agencyId)] },
  );
  return cached();
}

export async function getAgencyReport(agencyId: string): Promise<AgencyReport> {
  const agg = await cachedAgencyReportAgg(agencyId);
  const fleet = agg.fleet ?? { buses: 0, vans: 0 };
  const bookings = agg.bookings ?? { pending: 0, confirmed: 0, rejected: 0, cancelled: 0, total: 0 };
  return {
    counts: {
      services: agg.servicesCount ?? 0,
      buses: fleet.buses + fleet.vans,
      routes: agg.routesTotal ?? 0,
      pending: bookings.pending,
    },
    fleet,
    fleetByCollege: agg.fleetByCollege ?? [],
    routesByInstitution: agg.routesByInstitution ?? [],
    bookings,
    studentsCount: agg.studentsCount ?? 0,
    revenue: agg.revenue ?? { todayCents: 0, monthCents: 0, totalCents: 0, byRoute: [] },
    generatedAt: new Date().toISOString(),
  };
}
