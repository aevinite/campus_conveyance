import type { SupabaseClient } from '@supabase/supabase-js';
import { unstable_cache } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';

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
async function agencyApplications(
  db: SupabaseClient,
  status: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<AgencyRequest[]> {
  void db;
  // Service-role read: agencies' GST/PAN/KYC columns aren't granted to signed-in
  // users (0129). Admin-only (the /aevinite layout is SUPER_ADMIN-gated).
  let q = createAdminClient()
    .from('agencies')
    .select(REQUEST_COLS)
    .eq('status', status)
    .eq('is_deleted', false)
    .order('created_at', { ascending: false });
  if (opts.limit != null) {
    const off = opts.offset ?? 0;
    q = q.range(off, off + opts.limit - 1);
  }
  const { data, error } = await q;
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

/** Pending applications awaiting admin review. Paginated: though admins clear
 *  the queue, a backlog could otherwise hit PostgREST's 1000-row cap. */
export const listAgencyRequests = (
  db: SupabaseClient,
  opts: { limit?: number; offset?: number } = {},
) => agencyApplications(db, 'PENDING', opts);

/** Live count of pending applications — read uncached on the admin dashboard so
 *  the "Requests" card reflects a brand-new application immediately (the report
 *  counts are cached 60s and a new signup isn't an admin action that busts them). */
export async function countPendingAgencies(db: SupabaseClient): Promise<number> {
  const { count, error } = await db
    .from('agencies')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'PENDING')
    .eq('is_deleted', false);
  if (error) throw error;
  return count ?? 0;
}
/** Rejected applications — kept visible so the admin can re-approve or remove
 *  them (previously they vanished from every admin page). Paginated because,
 *  unlike pending (which admins clear), rejected rows accumulate forever and
 *  would eventually hit PostgREST's 1000-row cap. */
export const listRejectedAgencies = (
  db: SupabaseClient,
  opts: { limit?: number; offset?: number } = {},
) => agencyApplications(db, 'REJECTED', opts);

/** Count of rejected applications, for the Rejected section pager. */
export async function countRejectedAgencies(db: SupabaseClient): Promise<number> {
  const { count, error } = await db
    .from('agencies')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'REJECTED')
    .eq('is_deleted', false);
  if (error) throw error;
  return count ?? 0;
}

export interface ServiceRequest {
  id: string;
  name: string;
  description: string;
  vehicle_type: string;
  created_at: string;
  agencyName: string;
  institutionName: string;
  status: string; // admin's final decision
  campusStatus: string; // the campus's decision
  institutionId: string;
  /** Campus has no campus admin, so the platform admin decides both stages. */
  noCampusAdmin?: boolean;
}

const SR_SELECT =
  'id, name, description, vehicle_type, status, campus_status, created_at, institution_id, agencies(name), institutions(name)';

function mapServiceRequest(r: Record<string, unknown>): ServiceRequest {
  const ag = r.agencies as { name: string } | { name: string }[] | null;
  const inst = r.institutions as { name: string } | { name: string }[] | null;
  return {
    id: r.id as string,
    name: r.name as string,
    description: (r.description as string) ?? '',
    vehicle_type: r.vehicle_type as string,
    status: r.status as string,
    campusStatus: r.campus_status as string,
    institutionId: r.institution_id as string,
    created_at: r.created_at as string,
    agencyName: (Array.isArray(ag) ? ag[0]?.name : ag?.name) ?? '—',
    institutionName: (Array.isArray(inst) ? inst[0]?.name : inst?.name) ?? '—',
  };
}

/**
 * Campuses (of the given ids) that have at least one live campus admin. A
 * request at a campus WITHOUT one can never get a campus decision, so the
 * platform admin decides it directly. Service-role read (profiles).
 */
export async function campusesWithAdmin(institutionIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(institutionIds)];
  if (ids.length === 0) return new Set();
  const { data, error } = await createAdminClient()
    .from('profiles')
    .select('institution_id')
    .eq('role', 'INSTITUTION_ADMIN')
    .eq('is_deleted', false)
    .in('institution_id', ids);
  if (error) throw error;
  return new Set(((data ?? []) as { institution_id: string }[]).map((r) => r.institution_id));
}

/**
 * Requests the admin can act on NOW (status PENDING): the campus has accepted
 * (campus_status APPROVED), or the campus has no campus admin to ever decide it
 * (flagged noCampusAdmin). Oldest first (FIFO). Not paginated — this actionable
 * set is naturally small.
 */
export async function listActionableServiceRequests(db: SupabaseClient): Promise<ServiceRequest[]> {
  const { data, error } = await db
    .from('agency_service_requests')
    .select(SR_SELECT)
    .in('campus_status', ['APPROVED', 'PENDING'])
    .eq('status', 'PENDING')
    .order('created_at', { ascending: true });
  if (error) throw error;
  const rows = (data ?? []).map(mapServiceRequest);
  const awaitingCampus = rows.filter((r) => r.campusStatus === 'PENDING');
  const staffed = await campusesWithAdmin(awaitingCampus.map((r) => r.institutionId));
  return rows
    .filter((r) => r.campusStatus === 'APPROVED' || !staffed.has(r.institutionId))
    .map((r) => (r.campusStatus === 'PENDING' ? { ...r, noCampusAdmin: true } : r));
}

/**
 * The rest of the pipeline (everything NOT currently awaiting the admin) — for
 * read-only visibility: awaiting campus, rejected by campus, live, rejected by
 * admin. Most-recent first, paginated.
 */
export async function listServiceRequests(
  db: SupabaseClient,
  opts: { limit?: number; offset?: number } = {},
): Promise<ServiceRequest[]> {
  let q = db
    .from('agency_service_requests')
    .select(SR_SELECT)
    // NOT (campus_status=APPROVED AND status=PENDING) — that set is the
    // actionable list shown separately.
    .or('campus_status.neq.APPROVED,status.neq.PENDING')
    .order('created_at', { ascending: false });
  if (opts.limit != null) {
    const off = opts.offset ?? 0;
    q = q.range(off, off + opts.limit - 1);
  }
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(mapServiceRequest);
}

/** Count of pipeline (non-actionable) requests, for that page's pager. */
export async function countServiceRequests(db: SupabaseClient): Promise<number> {
  const { count, error } = await db
    .from('agency_service_requests')
    .select('id', { count: 'exact', head: true })
    .or('campus_status.neq.APPROVED,status.neq.PENDING');
  if (error) throw error;
  return count ?? 0;
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
export async function listAgenciesDetailed(
  db: SupabaseClient,
  opts: PageOpts = {},
): Promise<Paged<AgencyDetail>> {
  void db;
  // Service-role read: agencies' GST/PAN/KYC columns aren't granted to signed-in
  // users (0129). Admin-only (the /aevinite layout is SUPER_ADMIN-gated).
  let q = createAdminClient()
    .from('agencies')
    .select(AGENCY_DETAIL_COLS, { count: 'exact' })
    .eq('status', 'APPROVED')
    .eq('is_deleted', false)
    .order('name');
  if (opts.limit != null) q = q.range(opts.offset ?? 0, (opts.offset ?? 0) + opts.limit - 1);
  const { data, error, count } = await q;
  if (error) throw error;
  return { rows: (data ?? []).map((a) => mapAgencyDetail(a as Record<string, unknown>)), total: count ?? 0 };
}

/** One provider's full detail (for the admin edit page). */
export async function getAgencyDetail(db: SupabaseClient, id: string): Promise<AgencyDetail | null> {
  void db;
  // Service-role read: agencies' GST/PAN/KYC columns aren't granted to signed-in
  // users (0129). Admin-only (the /aevinite layout is SUPER_ADMIN-gated).
  const { data, error } = await createAdminClient().from('agencies').select(AGENCY_DETAIL_COLS).eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? mapAgencyDetail(data as Record<string, unknown>) : null;
}

export async function listDeletedAgencies(db: SupabaseClient, opts: PageOpts = {}): Promise<Paged<AgencyRow>> {
  let q = db
    .from('agencies')
    .select('id, name, email, phone', { count: 'exact' })
    .eq('is_deleted', true)
    .order('name');
  if (opts.limit != null) q = q.range(opts.offset ?? 0, (opts.offset ?? 0) + opts.limit - 1);
  const { data, error, count } = await q;
  if (error) throw error;
  return { rows: (data ?? []) as AgencyRow[], total: count ?? 0 };
}

// Server-side paging so these list pages don't silently truncate at PostgREST's
// ~1000-row cap (which also undercounted). Each returns the page rows + the exact
// total (count: 'exact', head-free) for the pager.
export const ADMIN_PAGE_SIZE = 50;
export interface Paged<T> { rows: T[]; total: number; }
export interface PageOpts { limit?: number; offset?: number }

async function students(db: SupabaseClient, deleted: boolean, opts: PageOpts = {}): Promise<Paged<StudentRow>> {
  let q = db
    .from('profiles')
    .select('id, full_name, email, phone', { count: 'exact' })
    .eq('role', 'STUDENT')
    .eq('is_deleted', deleted)
    .order('full_name');
  if (opts.limit != null) q = q.range(opts.offset ?? 0, (opts.offset ?? 0) + opts.limit - 1);
  const { data, error, count } = await q;
  if (error) throw error;
  return { rows: (data ?? []) as StudentRow[], total: count ?? 0 };
}
export const listStudents = (db: SupabaseClient, opts?: PageOpts) => students(db, false, opts);

export interface ManagedChildRow {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  campus: string | null;
  parents: string | null;
}

/**
 * Parent-managed children (students rows with no login, profile_id NULL) — they
 * have no profiles row, so the profile-based student list above never shows
 * them. Service-role read (admin panel only).
 */
export async function listManagedChildren(opts: PageOpts = {}): Promise<Paged<ManagedChildRow>> {
  const admin = createAdminClient();
  let q = admin
    .from('students')
    .select(
      'id, full_name, email, phone, institutions(name), parent_students(parents(profiles(full_name, email)))',
      { count: 'exact' },
    )
    .is('profile_id', null)
    .order('full_name');
  if (opts.limit != null) q = q.range(opts.offset ?? 0, (opts.offset ?? 0) + opts.limit - 1);
  const { data, error, count } = await q;
  if (error) throw error;
  const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
  const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => {
    const links = (r.parent_students ?? []) as { parents: unknown }[];
    const parentNames = links
      .map((l) => {
        const pa = one(l.parents as { profiles: unknown } | { profiles: unknown }[] | null);
        const pr = one(pa?.profiles as { full_name: string | null; email: string | null } | null);
        return pr?.full_name ?? pr?.email ?? null;
      })
      .filter(Boolean);
    return {
      id: r.id as string,
      full_name: (r.full_name as string) ?? null,
      email: (r.email as string) ?? null,
      phone: (r.phone as string) ?? null,
      campus: one(r.institutions as { name: string } | { name: string }[] | null)?.name ?? null,
      parents: parentNames.length ? parentNames.join(', ') : null,
    };
  });
  return { rows, total: count ?? 0 };
}
export const listDeletedStudents = (db: SupabaseClient, opts?: PageOpts) => students(db, true, opts);

async function colleges(db: SupabaseClient, deleted: boolean, opts: PageOpts = {}): Promise<Paged<CollegeRow>> {
  let q = db
    .from('institutions')
    .select('id, name, kind, area, city, image_url, description, is_active, is_verified', { count: 'exact' })
    .eq('is_deleted', deleted)
    .order('name');
  if (opts.limit != null) q = q.range(opts.offset ?? 0, (opts.offset ?? 0) + opts.limit - 1);
  const { data, error, count } = await q;
  if (error) throw error;
  return { rows: (data ?? []) as CollegeRow[], total: count ?? 0 };
}
export const listColleges = (db: SupabaseClient, opts?: PageOpts) => colleges(db, false, opts);
export const listDeletedColleges = (db: SupabaseClient, opts?: PageOpts) => colleges(db, true, opts);

export interface PendingCampusApplication {
  id: string;
  name: string;
  kind: string;
  city: string | null;
  area: string | null;
  adminName: string | null;
  adminEmail: string | null;
  adminPhone: string | null;
  createdAt: string;
}

/**
 * Self-registered campuses awaiting a SUPER_ADMIN's review: hidden (is_active=
 * false) + unverified + not deleted, AND with at least one live campus admin
 * linked — the last condition distinguishes a genuine application from an admin-
 * created college that was merely disabled. Service-role read (joins profiles).
 */
export async function listPendingCampusApplications(): Promise<PendingCampusApplication[]> {
  const admin = createAdminClient();
  const { data: insts, error } = await admin
    .from('institutions')
    .select('id, name, kind, city, area, created_at')
    .eq('is_deleted', false)
    .eq('is_active', false)
    .eq('is_verified', false)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const rows = (insts ?? []) as {
    id: string; name: string; kind: string; city: string | null; area: string | null; created_at: string;
  }[];
  if (rows.length === 0) return [];

  const { data: adminRows } = await admin
    .from('profiles')
    .select('institution_id, full_name, email, phone')
    .eq('role', 'INSTITUTION_ADMIN')
    .eq('is_deleted', false)
    .in('institution_id', rows.map((r) => r.id));
  const byInst = new Map<string, { full_name: string | null; email: string | null; phone: string | null }>();
  for (const a of (adminRows ?? []) as { institution_id: string; full_name: string | null; email: string | null; phone: string | null }[]) {
    if (!byInst.has(a.institution_id)) byInst.set(a.institution_id, { full_name: a.full_name, email: a.email, phone: a.phone });
  }
  return rows
    .filter((r) => byInst.has(r.id)) // only campuses that actually have an applicant admin
    .map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      city: r.city,
      area: r.area,
      adminName: byInst.get(r.id)?.full_name ?? null,
      adminEmail: byInst.get(r.id)?.email ?? null,
      adminPhone: byInst.get(r.id)?.phone ?? null,
      createdAt: r.created_at,
    }));
}

export interface AdminCounts {
  requests: number;
  agencies: number;
  students: number;
  colleges: number;
}
// The 4 dashboard count cards. Cached 60s + service-role and tagged
// 'admin-report' — the same tag the report agg uses — so the dashboard and the
// CSV export share ONE computation (was 4 uncached count queries on every
// dashboard render AND every CSV download), and an admin mutation busting the
// tag refreshes both instantly. Counts are global, so the service-role client
// (not the per-request one) is correct here.
const cachedCounts = unstable_cache(
  async (): Promise<AdminCounts> => {
    const admin = createAdminClient();
    const [requests, agencies, studentCount, colleges] = await Promise.all([
      admin.from('agencies').select('id', { count: 'exact', head: true }).eq('status', 'PENDING').eq('is_deleted', false),
      admin.from('agencies').select('id', { count: 'exact', head: true }).eq('status', 'APPROVED').eq('is_deleted', false),
      admin.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'STUDENT').eq('is_deleted', false),
      admin.from('institutions').select('id', { count: 'exact', head: true }).eq('is_deleted', false),
    ]);
    return {
      requests: requests.count ?? 0,
      agencies: agencies.count ?? 0,
      students: studentCount.count ?? 0,
      colleges: colleges.count ?? 0,
    };
  },
  ['admin-counts'],
  { revalidate: 60, tags: ['admin-report'] },
);

export function getCounts(): Promise<AdminCounts> {
  return cachedCounts();
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

// Provider fleet/rider rows + payment summary, aggregated in SQL (GROUP BY) via
// the admin_report RPC instead of streaming every booking/vehicle row into Node.
// Cached 60s + service-role (the RPC is security-definer, granted to service_role
// only), so the dashboard and the CSV export share one computation instead of two
// full-table scans each. Was also silently truncating at PostgREST's ~1000-row
// cap before this.
const cachedAdminReportAgg = unstable_cache(
  async () => {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc('admin_report');
    // Throw so a transient failure misses the cache (caching {} would serve
    // all-zeros dashboards for 60s after recovery).
    if (error) throw error;
    const agg = (data ?? {}) as {
      providers?: ProviderReportRow[];
      totals?: { buses: number; vans: number; students: number };
      payments?: PaymentSummary;
    };
    // Stamp WHEN the data was actually computed (cache-fill time) — not when the
    // page read it — so generatedAt can't claim "now" over ≤60s-stale cached data.
    return { ...agg, generatedAt: new Date().toISOString() };
  },
  ['admin-report-agg'],
  // Tagged so admin mutations can bust it immediately (revalidateTag) instead of
  // the charts lagging up to 60s behind the count cards.
  { revalidate: 60, tags: ['admin-report'] },
);

// No db param needed: both halves read via the cached service-role clients.
export async function getAdminReport(): Promise<AdminReport> {
  const [counts, agg] = await Promise.all([cachedCounts(), cachedAdminReportAgg()]);
  return {
    counts,
    providers: agg.providers ?? [],
    totals: agg.totals ?? { buses: 0, vans: 0, students: 0 },
    payments: agg.payments ?? { paidCount: 0, unpaidCount: 0, paidCents: 0, unpaidCents: 0 },
    generatedAt: agg.generatedAt ?? new Date().toISOString(),
  };
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
export async function listAuditLogs(db: SupabaseClient, opts: PageOpts = {}): Promise<Paged<AuditLogRow>> {
  // Default to one page, not 1000 — a caller that omits `limit` should get a
  // bounded read, not a near-unbounded one that hits PostgREST's row cap.
  const limit = opts.limit ?? ADMIN_PAGE_SIZE;
  const offset = opts.offset ?? 0;
  const { data, error, count } = await db
    .from('audit_logs')
    .select('id, action, entity, entity_id, metadata, created_at, profiles(full_name, email)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  const rows = (data ?? []).map((r) => {
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
  return { rows, total: count ?? 0 };
}
