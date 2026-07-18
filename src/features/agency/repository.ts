import { cache } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSessionClaims } from '@/features/auth/session';

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
  const { data } = await db
    .from('agencies')
    .select(
      'id, name, email, phone, contact_person, legal_name, registration_no, gst_number, pan_number, registered_address, description, permit_doc_url, fitness_doc_url, status, created_at',
    )
    .eq('owner_profile_id', userId)
    .maybeSingle();
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
}
export interface AgencyRouteRow {
  id: string;
  start_location: string | null;
  institutionName: string;
  price_cents: number | null;
  departure_time: string | null;
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
export interface StudentRow {
  student_id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  hidden: boolean;
}

/** The agency owned by the signed-in user (null if none). */
// Memoized per request: the agency layout and the page both need the agency, so
// cache() collapses the duplicate lookups (and the claims read) into one query.
export const getMyAgency = cache(
  async (db: SupabaseClient): Promise<MyAgency | null> => {
    const { userId } = await getSessionClaims(db);
    if (!userId) return null;
    const { data } = await db
      .from('agencies')
      .select('id, name, status, rejected_reason')
      .eq('owner_profile_id', userId)
      .maybeSingle();
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
    .order('created_at', { ascending: false });
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
    .order('created_at', { ascending: false });
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
    .order('created_at', { ascending: false });
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
export async function listMyBusesFull(
  db: SupabaseClient,
  agencyId: string,
): Promise<BusFull[]> {
  const { data, error } = await db
    .from('vehicles')
    .select(
      'id, bus_number, registration_no, capacity, is_ac, bus_model, bus_color, image_url, photos, driver_id, driver_name, driver_phone, driver_email, driver_license_no, driver_experience_years, driver_photo_url',
    )
    .eq('agency_id', agencyId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((v) => ({
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
  }));
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

/** Full details of the agency's routes (for the Manage Routes page). */
export async function listMyRoutesFull(
  db: SupabaseClient,
  agencyId: string,
): Promise<RouteFull[]> {
  const { data, error } = await db
    .from('routes')
    .select(
      'id, name, price_cents, departure_time, institutions(name), vehicles(bus_number, registration_no), route_stops(name, description, lat, lng, address, sequence)',
    )
    .eq('agency_id', agencyId)
    .order('created_at', { ascending: false });
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
  const ids = rows.map((r) => r.id);
  if (ids.length > 0) {
    const { data: bks } = await db.from('bookings').select('route_id').in('route_id', ids);
    const withBookings = new Set((bks ?? []).map((b) => b.route_id as string));
    for (const r of rows) r.hasBookings = withBookings.has(r.id);
  }
  return rows;
}

export async function listMyRoutes(
  db: SupabaseClient,
  agencyId: string,
): Promise<AgencyRouteRow[]> {
  const { data, error } = await db
    .from('routes')
    .select('id, start_location, price_cents, departure_time, institutions(name)')
    .eq('agency_id', agencyId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => {
    const inst = r.institutions as { name: string } | { name: string }[] | null;
    return {
      id: r.id as string,
      start_location: (r.start_location as string) ?? null,
      institutionName: (Array.isArray(inst) ? inst[0]?.name : inst?.name) ?? '—',
      price_cents: (r.price_cents as number) ?? null,
      departure_time: (r.departure_time as string) ?? null,
    };
  });
}

export async function listMyBookings(
  db: SupabaseClient,
  agencyId: string,
): Promise<BookingRow[]> {
  const { data, error } = await db.rpc('agency_bookings', { p_agency_id: agencyId });
  if (error) throw error;
  return (data ?? []) as BookingRow[];
}

export async function listMyStudents(
  db: SupabaseClient,
  agencyId: string,
): Promise<StudentRow[]> {
  const { data, error } = await db.rpc('agency_students', { p_agency_id: agencyId });
  if (error) throw error;
  return (data ?? []) as StudentRow[];
}

export interface DriverRow {
  driver_id: string;
  profile_id: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  license_no: string | null;
  is_active: boolean;
  created_at: string;
}
export async function listMyDrivers(
  db: SupabaseClient,
  agencyId: string,
): Promise<DriverRow[]> {
  const { data, error } = await db.rpc('agency_drivers', { p_agency_id: agencyId });
  if (error) throw error;
  return (data ?? []) as DriverRow[];
}

export interface AgencyCounts {
  services: number;
  buses: number;
  routes: number;
  pending: number;
}
export async function getCounts(
  db: SupabaseClient,
  agencyId: string,
): Promise<AgencyCounts> {
  const bookings = await listMyBookings(db, agencyId);
  const [services, buses, routes] = await Promise.all([
    db.from('agency_services').select('id', { count: 'exact', head: true }).eq('agency_id', agencyId),
    db.from('vehicles').select('id', { count: 'exact', head: true }).eq('agency_id', agencyId),
    db.from('routes').select('id', { count: 'exact', head: true }).eq('agency_id', agencyId),
  ]);
  return {
    services: services.count ?? 0,
    buses: buses.count ?? 0,
    routes: routes.count ?? 0,
    pending: bookings.filter((b) => b.status === 'PENDING').length,
  };
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
export async function getAgencyReport(
  db: SupabaseClient,
  agencyId: string,
): Promise<AgencyReport> {
  const [servicesRes, vehiclesRes, routesRes, bookings, students] = await Promise.all([
    db.from('agency_services').select('id', { count: 'exact', head: true }).eq('agency_id', agencyId),
    db.from('vehicles').select('vehicle_type').eq('agency_id', agencyId),
    db.from('routes').select('vehicle_type, institutions(name)').eq('agency_id', agencyId),
    listMyBookings(db, agencyId),
    listMyStudents(db, agencyId),
  ]);
  if (vehiclesRes.error) throw vehiclesRes.error;
  if (routesRes.error) throw routesRes.error;

  const relName = (rel: { name: string } | { name: string }[] | null): string =>
    (Array.isArray(rel) ? rel[0]?.name : rel?.name) ?? '—';

  // Overall fleet split (all the agency's vehicles).
  const fleet = { buses: 0, vans: 0 };
  for (const v of (vehiclesRes.data ?? []) as { vehicle_type: string }[]) {
    if (v.vehicle_type === 'VAN') fleet.vans += 1;
    else fleet.buses += 1;
  }

  // Per college/school: how many buses & vans the agency runs there (via routes),
  // plus a simple routes-per-college count for the second chart.
  const inst = new Map<string, number>();
  const collegeFleet = new Map<string, CollegeFleetRow>();
  for (const r of (routesRes.data ?? []) as {
    vehicle_type: string;
    institutions: { name: string } | { name: string }[] | null;
  }[]) {
    const name = relName(r.institutions);
    inst.set(name, (inst.get(name) ?? 0) + 1);
    const cf = collegeFleet.get(name) ?? { name, buses: 0, vans: 0 };
    if (r.vehicle_type === 'VAN') cf.vans += 1;
    else cf.buses += 1;
    collegeFleet.set(name, cf);
  }

  const bookingCounts = { pending: 0, confirmed: 0, rejected: 0, cancelled: 0, total: bookings.length };
  const revenue = { todayCents: 0, monthCents: 0, totalCents: 0, byRoute: [] as RevenueByRoute[] };
  const revByRoute = new Map<string, RevenueByRoute>();
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  for (const b of bookings) {
    if (b.status === 'PENDING') bookingCounts.pending += 1;
    else if (b.status === 'CONFIRMED') bookingCounts.confirmed += 1;
    else if (b.status === 'REJECTED') bookingCounts.rejected += 1;
    else if (b.status === 'CANCELLED') bookingCounts.cancelled += 1;

    // Revenue counts only bookings that are both paid and agency-confirmed.
    if (b.status === 'CONFIRMED' && b.is_paid) {
      const cents = b.price_cents ?? 0;
      revenue.totalCents += cents;
      const t = new Date(b.paid_at ?? b.created_at).getTime();
      if (t >= startOfDay) revenue.todayCents += cents;
      if (t >= startOfMonth) revenue.monthCents += cents;
      const name = b.route_name ?? '—';
      const row = revByRoute.get(name) ?? { name, bookings: 0, revenueCents: 0 };
      row.bookings += 1;
      row.revenueCents += cents;
      revByRoute.set(name, row);
    }
  }
  revenue.byRoute = [...revByRoute.values()].sort((a, b) => b.revenueCents - a.revenueCents);

  // "Active students" = distinct students the agency has accepted onto a bus
  // (a CONFIRMED booking), excluding any hidden. Matches the Manage Students
  // roster, which only shows a student once their booking is confirmed.
  const hiddenStudents = new Set(students.filter((s) => s.hidden).map((s) => s.student_id));
  const activeStudents = new Set<string>();
  for (const b of bookings) {
    if (b.status === 'CONFIRMED' && b.student_id && !hiddenStudents.has(b.student_id)) {
      activeStudents.add(b.student_id);
    }
  }

  const routesTotal = routesRes.data?.length ?? 0;
  return {
    counts: {
      services: servicesRes.count ?? 0,
      buses: fleet.buses + fleet.vans,
      routes: routesTotal,
      pending: bookingCounts.pending,
    },
    fleet,
    fleetByCollege: [...collegeFleet.values()].sort((a, b) => a.name.localeCompare(b.name)),
    routesByInstitution: [...inst.entries()]
      .map(([name, routes]) => ({ name, routes }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    bookings: bookingCounts,
    studentsCount: activeStudents.size,
    revenue,
    generatedAt: new Date().toISOString(),
  };
}
