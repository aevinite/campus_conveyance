import type { SupabaseClient } from '@supabase/supabase-js';

export interface AgencyRequest {
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
  rejected_reason?: string | null;
  // Colleges/schools + vehicle types the agency picked at signup (seeded services).
  services: { institutionName: string; vehicleType: string }[];
}
export interface AgencyRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
}
export interface StudentRow {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
}
export interface CollegeRow {
  id: string;
  name: string;
  kind: string;
  area: string | null;
  city: string | null;
  image_url: string | null;
  description: string | null;
  is_active: boolean;
  is_verified: boolean;
}

const REQUEST_COLS =
  'id, name, email, phone, contact_person, legal_name, registration_no, gst_number, pan_number, registered_address, rejected_reason, agency_services(vehicle_type, institutions(name))';

/** Agency applications in a given status (PENDING for review, REJECTED so a
 *  rejected provider stays visible and can be re-approved or removed). */
async function agencyApplications(db: SupabaseClient, status: string): Promise<AgencyRequest[]> {
  const { data, error } = await db
    .from('agencies')
    .select(REQUEST_COLS)
    .eq('status', status)
    .eq('is_deleted', false)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((a) => {
    const rows = (a.agency_services ?? []) as {
      vehicle_type: string;
      institutions: { name: string } | { name: string }[] | null;
    }[];
    return {
      id: a.id as string,
      name: a.name as string,
      email: (a.email as string) ?? null,
      phone: (a.phone as string) ?? null,
      contact_person: (a.contact_person as string) ?? null,
      legal_name: (a.legal_name as string) ?? null,
      registration_no: (a.registration_no as string) ?? null,
      gst_number: (a.gst_number as string) ?? null,
      pan_number: (a.pan_number as string) ?? null,
      registered_address: (a.registered_address as string) ?? null,
      rejected_reason: (a.rejected_reason as string) ?? null,
      services: rows.map((s) => {
        const inst = s.institutions;
        return {
          institutionName: (Array.isArray(inst) ? inst[0]?.name : inst?.name) ?? '—',
          vehicleType: s.vehicle_type,
        };
      }),
    };
  });
}

/** Pending applications awaiting admin review. */
export const listAgencyRequests = (db: SupabaseClient) => agencyApplications(db, 'PENDING');
/** Rejected applications — kept visible so the admin can re-approve or remove
 *  them (previously they vanished from every admin page). */
export const listRejectedAgencies = (db: SupabaseClient) => agencyApplications(db, 'REJECTED');

export interface ServiceRequest {
  id: string;
  name: string;
  description: string;
  vehicle_type: string;
  created_at: string;
  agencyName: string;
  institutionName: string;
}

/** Pending agency service-area requests, for admin review. */
export async function listServiceRequests(db: SupabaseClient): Promise<ServiceRequest[]> {
  const { data, error } = await db
    .from('agency_service_requests')
    .select('id, name, description, vehicle_type, created_at, agencies(name), institutions(name)')
    .eq('status', 'PENDING')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => {
    const ag = r.agencies as { name: string } | { name: string }[] | null;
    const inst = r.institutions as { name: string } | { name: string }[] | null;
    return {
      id: r.id as string,
      name: r.name as string,
      description: (r.description as string) ?? '',
      vehicle_type: r.vehicle_type as string,
      created_at: r.created_at as string,
      agencyName: (Array.isArray(ag) ? ag[0]?.name : ag?.name) ?? '—',
      institutionName: (Array.isArray(inst) ? inst[0]?.name : inst?.name) ?? '—',
    };
  });
}

export async function listAgencies(db: SupabaseClient): Promise<AgencyRow[]> {
  const { data, error } = await db
    .from('agencies')
    .select('id, name, email, phone')
    .eq('status', 'APPROVED')
    .eq('is_deleted', false)
    .order('name');
  if (error) throw error;
  return (data ?? []) as AgencyRow[];
}

// Full provider record — everything captured at signup — for the admin Manage
// Service Providers page, so the admin can review and edit it in place.
export interface AgencyDetail {
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
  status: string;
  created_at: string | null;
  services: { institutionName: string; vehicleType: string }[];
}

const AGENCY_DETAIL_COLS =
  'id, name, email, phone, contact_person, legal_name, registration_no, gst_number, pan_number, registered_address, description, permit_doc_url, fitness_doc_url, status, created_at, agency_services(vehicle_type, institutions(name))';

function mapAgencyDetail(a: Record<string, unknown>): AgencyDetail {
  const rows = (a.agency_services ?? []) as {
    vehicle_type: string;
    institutions: { name: string } | { name: string }[] | null;
  }[];
  return {
    id: a.id as string,
    name: a.name as string,
    email: (a.email as string) ?? null,
    phone: (a.phone as string) ?? null,
    contact_person: (a.contact_person as string) ?? null,
    legal_name: (a.legal_name as string) ?? null,
    registration_no: (a.registration_no as string) ?? null,
    gst_number: (a.gst_number as string) ?? null,
    pan_number: (a.pan_number as string) ?? null,
    registered_address: (a.registered_address as string) ?? null,
    description: (a.description as string) ?? null,
    permit_doc_url: (a.permit_doc_url as string) ?? null,
    fitness_doc_url: (a.fitness_doc_url as string) ?? null,
    status: a.status as string,
    created_at: (a.created_at as string) ?? null,
    services: rows.map((s) => {
      const inst = s.institutions;
      return {
        institutionName: (Array.isArray(inst) ? inst[0]?.name : inst?.name) ?? '—',
        vehicleType: s.vehicle_type,
      };
    }),
  };
}

/** Approved (non-deleted) providers with full signup detail, for the admin list. */
export async function listAgenciesDetailed(db: SupabaseClient): Promise<AgencyDetail[]> {
  const { data, error } = await db
    .from('agencies')
    .select(AGENCY_DETAIL_COLS)
    .eq('status', 'APPROVED')
    .eq('is_deleted', false)
    .order('name');
  if (error) throw error;
  return (data ?? []).map((a) => mapAgencyDetail(a as Record<string, unknown>));
}

/** One provider's full detail (for the admin edit page). */
export async function getAgencyDetail(db: SupabaseClient, id: string): Promise<AgencyDetail | null> {
  const { data, error } = await db.from('agencies').select(AGENCY_DETAIL_COLS).eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? mapAgencyDetail(data as Record<string, unknown>) : null;
}

export async function listDeletedAgencies(db: SupabaseClient): Promise<AgencyRow[]> {
  const { data, error } = await db
    .from('agencies')
    .select('id, name, email, phone')
    .eq('is_deleted', true)
    .order('name');
  if (error) throw error;
  return (data ?? []) as AgencyRow[];
}

async function students(db: SupabaseClient, deleted: boolean): Promise<StudentRow[]> {
  const { data, error } = await db
    .from('profiles')
    .select('id, full_name, email, phone')
    .eq('role', 'STUDENT')
    .eq('is_deleted', deleted)
    .order('full_name');
  if (error) throw error;
  return (data ?? []) as StudentRow[];
}
export const listStudents = (db: SupabaseClient) => students(db, false);
export const listDeletedStudents = (db: SupabaseClient) => students(db, true);

async function colleges(db: SupabaseClient, deleted: boolean): Promise<CollegeRow[]> {
  const { data, error } = await db
    .from('institutions')
    .select('id, name, kind, area, city, image_url, description, is_active, is_verified')
    .eq('is_deleted', deleted)
    .order('name');
  if (error) throw error;
  return (data ?? []) as CollegeRow[];
}
export const listColleges = (db: SupabaseClient) => colleges(db, false);
export const listDeletedColleges = (db: SupabaseClient) => colleges(db, true);

export interface AdminCounts {
  requests: number;
  agencies: number;
  students: number;
  colleges: number;
}
export async function getCounts(db: SupabaseClient): Promise<AdminCounts> {
  const [requests, agencies, studentCount, colleges] = await Promise.all([
    db.from('agencies').select('id', { count: 'exact', head: true }).eq('status', 'PENDING').eq('is_deleted', false),
    db.from('agencies').select('id', { count: 'exact', head: true }).eq('status', 'APPROVED').eq('is_deleted', false),
    db.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'STUDENT').eq('is_deleted', false),
    db.from('institutions').select('id', { count: 'exact', head: true }).eq('is_deleted', false),
  ]);
  return {
    requests: requests.count ?? 0,
    agencies: agencies.count ?? 0,
    students: studentCount.count ?? 0,
    colleges: colleges.count ?? 0,
  };
}

// ---- Admin report ---------------------------------------------------------
// A single roll-up powering the dashboard graphs and the downloadable report:
// per-provider fleet (buses/vans) and rider counts, plus a payment summary.

export interface ProviderReportRow {
  agencyId: string;
  name: string;
  buses: number;
  vans: number;
  students: number; // distinct students with an active booking on this provider
}
// Derived from the actual booking flow: a booking is "paid" once pay_booking
// flips bookings.is_paid, and the fee is the route's price_cents. (The legacy
// `payments` table is never written to by the app, so reading it always showed
// zero — issue 1.) We only count live bookings (not CANCELLED).
export interface PaymentSummary {
  paidCount: number;
  unpaidCount: number;
  paidCents: number;
  unpaidCents: number;
}
export interface AdminReport {
  counts: AdminCounts;
  providers: ProviderReportRow[];
  totals: { buses: number; vans: number; students: number };
  payments: PaymentSummary;
  generatedAt: string;
}

const ACTIVE_BOOKING = ['PENDING', 'CONFIRMED'];

export async function getAdminReport(db: SupabaseClient): Promise<AdminReport> {
  const [counts, agenciesRes, vehiclesRes, bookingsRes, feesRes] = await Promise.all([
    getCounts(db),
    db.from('agencies').select('id, name').eq('status', 'APPROVED').eq('is_deleted', false).order('name'),
    db.from('vehicles').select('agency_id, vehicle_type').not('agency_id', 'is', null),
    // Each active booking, tagged with its provider via the route it's on.
    db.from('bookings').select('student_id, status, routes(agency_id)').in('status', ACTIVE_BOOKING),
    // Fee/payment status comes from the booking itself (is_paid) and the route
    // price. Only ACTIVE bookings (PENDING/CONFIRMED) count toward revenue —
    // REJECTED and WAITLISTED bookings are not money owed and were wrongly
    // inflating "unpaid due" (they merely weren't CANCELLED).
    db.from('bookings').select('is_paid, routes(price_cents)').in('status', ACTIVE_BOOKING),
  ]);
  if (agenciesRes.error) throw agenciesRes.error;
  if (vehiclesRes.error) throw vehiclesRes.error;
  if (bookingsRes.error) throw bookingsRes.error;
  if (feesRes.error) throw feesRes.error;

  // Seed one row per approved provider so every provider shows on the chart.
  const rows = new Map<string, ProviderReportRow>();
  for (const a of (agenciesRes.data ?? []) as { id: string; name: string }[]) {
    rows.set(a.id, { agencyId: a.id, name: a.name, buses: 0, vans: 0, students: 0 });
  }

  for (const v of (vehiclesRes.data ?? []) as { agency_id: string | null; vehicle_type: string }[]) {
    const row = v.agency_id ? rows.get(v.agency_id) : undefined;
    if (!row) continue;
    if (v.vehicle_type === 'VAN') row.vans += 1;
    else row.buses += 1;
  }

  // Count each student once per provider they ride with.
  const seen = new Set<string>();
  for (const b of (bookingsRes.data ?? []) as {
    student_id: string;
    routes: { agency_id: string | null } | { agency_id: string | null }[] | null;
  }[]) {
    const route = Array.isArray(b.routes) ? b.routes[0] : b.routes;
    const agencyId = route?.agency_id;
    const row = agencyId ? rows.get(agencyId) : undefined;
    if (!row) continue;
    const key = `${agencyId}:${b.student_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    row.students += 1;
  }

  const providers = [...rows.values()];
  const totals = providers.reduce(
    (acc, r) => ({ buses: acc.buses + r.buses, vans: acc.vans + r.vans, students: acc.students + r.students }),
    { buses: 0, vans: 0, students: 0 },
  );

  const payments: PaymentSummary = { paidCount: 0, unpaidCount: 0, paidCents: 0, unpaidCents: 0 };
  for (const b of (feesRes.data ?? []) as {
    is_paid: boolean;
    routes: { price_cents: number | null } | { price_cents: number | null }[] | null;
  }[]) {
    const route = Array.isArray(b.routes) ? b.routes[0] : b.routes;
    const cents = Number(route?.price_cents) || 0;
    if (b.is_paid) { payments.paidCount += 1; payments.paidCents += cents; }
    else { payments.unpaidCount += 1; payments.unpaidCents += cents; }
  }

  return { counts, providers, totals, payments, generatedAt: new Date().toISOString() };
}

// ---- Admin activity log ---------------------------------------------------

export interface AuditLogRow {
  id: string;
  action: string;
  entity: string | null;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  actorName: string | null;
  actorEmail: string | null;
}

/** Most recent admin actions (approvals/rejections/deletes/restores/toggles). */
export async function listAuditLogs(db: SupabaseClient, limit = 1000): Promise<AuditLogRow[]> {
  const { data, error } = await db
    .from('audit_logs')
    .select('id, action, entity, entity_id, metadata, created_at, profiles(full_name, email)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((r) => {
    const actor = (Array.isArray(r.profiles) ? r.profiles[0] : r.profiles) as
      | { full_name: string | null; email: string | null }
      | null;
    return {
      id: r.id as string,
      action: r.action as string,
      entity: (r.entity as string) ?? null,
      entity_id: (r.entity_id as string) ?? null,
      metadata: (r.metadata as Record<string, unknown>) ?? {},
      created_at: r.created_at as string,
      actorName: actor?.full_name ?? null,
      actorEmail: actor?.email ?? null,
    };
  });
}
