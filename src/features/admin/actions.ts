'use server';
import { revalidatePath, updateTag } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { toErrorResponse, AppError } from '@/lib/errors/app-error';
import { collegeSchema, slugify } from './schemas';
import { agencyProfileSchema } from '@/features/agency/schemas';
import { agencyReportTag } from '@/features/agency/repository';
import { campusesWithAdmin } from './repository';
import { ensureEmailFreeForSignup } from '@/features/auth/services';

export type FormState = { error?: string; message?: string };

type Db = Awaited<ReturnType<typeof createClient>>;

/**
 * Hard gate for actions that use the service-role client (which bypasses RLS):
 * a server action is a public POST endpoint, so the panel's layout guard alone
 * doesn't protect it. Checks the caller's role on the profile row (not just the
 * JWT claim, which can lag a demotion) and that the account isn't deactivated.
 */
async function assertSuperAdmin(): Promise<void> {
  const db = await createClient();
  const { data } = await db.auth.getClaims();
  const uid = (data?.claims as { sub?: string } | null)?.sub;
  if (!uid) throw new AppError('ADMIN', 'Not signed in.');
  const { data: prof } = await createAdminClient()
    .from('profiles')
    .select('role, is_deleted')
    .eq('id', uid)
    .maybeSingle();
  const p = prof as { role: string; is_deleted: boolean } | null;
  if (!p || p.role !== 'SUPER_ADMIN' || p.is_deleted) {
    throw new AppError('ADMIN', 'Only a super admin can do this.');
  }
}

// Guard id-shaped inputs before they reach Postgres — a malformed value would be
// a 22P02 (invalid uuid) crash to the (unstyled, no try/catch) error page.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Record an admin action in audit_logs (issue 6). Best-effort — a logging
 * failure must never break the action the admin actually asked for. Runs as the
 * signed-in SUPER_ADMIN, whose id becomes actor_id; platform-level rows carry a
 * null institution_id.
 */
async function logAction(
  db: Db,
  action: string,
  entity: string,
  entityId: string | null,
  metadata: Record<string, unknown> = {},
  actorId?: string | null,
): Promise<void> {
  try {
    // Reuse an already-resolved actor id when the caller has one (approve reads
    // claims for approved_by), so we don't decode the JWT a second time.
    let uid = actorId;
    if (uid === undefined) {
      const { data } = await db.auth.getClaims();
      uid = (data?.claims as { sub?: string } | null)?.sub ?? null;
    }
    await db.from('audit_logs').insert({ actor_id: uid, action, entity, entity_id: entityId, metadata });
  } catch {
    /* swallow — logging is non-critical */
  }
}

async function setAgency(db: Db, agencyId: string, patch: Record<string, unknown>) {
  const { error } = await db.from('agencies').update(patch).eq('id', agencyId);
  if (error) throw new AppError('ADMIN', error.message);
}

export async function approveAgencyAction(formData: FormData): Promise<void> {
  const id = String(formData.get('agencyId') ?? '');
  if (!UUID_RE.test(id)) return;
  await assertSuperAdmin();
  const db = await createClient();
  const { data: claimsData } = await db.auth.getClaims();
  const userId = (claimsData?.claims as { sub?: string } | null)?.sub ?? null;
  await setAgency(db, id, {
    status: 'APPROVED',
    approved_at: new Date().toISOString(),
    approved_by: userId,
    rejected_reason: null,
  });
  await logAction(db, 'AGENCY_APPROVED', 'agency', id, {}, userId);
  // Signup campuses are NOT seeded here: they were filed as PENDING service
  // requests at signup (0128) and go through the campus → admin review. (The old
  // re-seed read user_metadata, which the account owner can edit.)
  updateTag(agencyReportTag(id));
  revalidatePath('/aevinite/requests');
  revalidatePath('/aevinite/providers');
  revalidatePath('/aevinite'); updateTag('admin-report'); // count cards + report charts
}

export async function rejectAgencyAction(formData: FormData): Promise<void> {
  const id = String(formData.get('agencyId') ?? '');
  if (!UUID_RE.test(id)) return;
  const reason = String(formData.get('reason') ?? '').trim();
  const db = await createClient();
  await setAgency(db, id, { status: 'REJECTED', rejected_reason: reason || null });
  await logAction(db, 'AGENCY_REJECTED', 'agency', id, reason ? { reason } : {});
  revalidatePath('/aevinite/requests');
  revalidatePath('/aevinite'); updateTag('admin-report'); // count cards + report charts
}

export async function deleteAgencyAction(formData: FormData): Promise<void> {
  const id = String(formData.get('agencyId') ?? '');
  if (!UUID_RE.test(id)) return;
  const db = await createClient();
  await setAgency(db, id, { is_deleted: true, deleted_at: new Date().toISOString() });
  await logAction(db, 'AGENCY_DELETED', 'agency', id);
  revalidatePath('/aevinite/providers');
  revalidatePath('/aevinite/deleted-providers');
  revalidatePath('/aevinite/requests'); // rejected providers are listed here too
  revalidatePath('/aevinite'); updateTag('admin-report'); // count cards + report charts
}

export async function restoreAgencyAction(formData: FormData): Promise<void> {
  const id = String(formData.get('agencyId') ?? '');
  if (!UUID_RE.test(id)) return;
  const db = await createClient();
  await setAgency(db, id, { is_deleted: false, deleted_at: null });
  await logAction(db, 'AGENCY_RESTORED', 'agency', id);
  revalidatePath('/aevinite/providers');
  revalidatePath('/aevinite/deleted-providers');
  revalidatePath('/aevinite'); updateTag('admin-report'); // count cards + report charts
}

/**
 * Permanently remove an agency from the database. Hard-deletes the agencies row
 * (cascades agency_services / agency_hidden_students / agency_service_requests,
 * and nulls vehicles.agency_id / routes.agency_id) and deletes the owner's auth
 * user (which cascades their profile), freeing the email for reuse. Irreversible
 * — only reachable from the Deleted Service Providers page. Uses the service-role
 * client so it works regardless of RLS.
 */
export async function permanentlyDeleteAgencyAction(formData: FormData): Promise<void> {
  const id = String(formData.get('agencyId') ?? '');
  if (!UUID_RE.test(id)) return;
  await assertSuperAdmin();
  const admin = createAdminClient();

  // Grab the owner first so we can also remove their login after the row is gone.
  // A SELECT error here must NOT be treated as "no owner" — that would delete the
  // agency row but leave the owner's auth user orphaned (email stuck forever).
  const { data: agency, error: readErr } = await admin
    .from('agencies')
    .select('owner_profile_id, is_deleted')
    .eq('id', id)
    .maybeSingle();
  if (readErr) throw new AppError('ADMIN', readErr.message);
  // Only ever hard-delete something already soft-deleted (parity with the driver
  // purge) — this action is reached from Deleted Providers, so a not-yet-removed
  // provider landing here is a stale view, not an instruction to purge.
  if (!agency || (agency as { is_deleted: boolean }).is_deleted !== true) return;

  const { error } = await admin.from('agencies').delete().eq('id', id);
  if (error) throw new AppError('ADMIN', error.message);

  const ownerId = (agency as { owner_profile_id: string | null } | null)?.owner_profile_id;
  if (ownerId) {
    // Best-effort: the agency is already gone; a missing/failed user delete
    // shouldn't surface as an error to the admin.
    await admin.auth.admin.deleteUser(ownerId);
  }

  await logAction(await createClient(), 'AGENCY_PURGED', 'agency', id);
  revalidatePath('/aevinite/deleted-providers');
  revalidatePath('/aevinite/providers');
  revalidatePath('/aevinite'); updateTag('admin-report'); // count cards + report charts
}

/**
 * Admin edit of a provider's business/verification details — the fields the
 * agency submitted at signup. Runs as SUPER_ADMIN (RLS allows it), validates
 * with the same schema the agency's own edit form uses, and logs the change.
 */
export async function updateAgencyDetailsAction(_: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get('agencyId') ?? '');
  if (!id) return { error: 'Missing provider reference.' };
  const parsed = agencyProfileSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Please check the details.' };
  }
  const db = await createClient();
  const d = parsed.data;
  try {
    const { error } = await db
      .from('agencies')
      .update({
        name: d.name,
        contact_person: d.contactPerson,
        phone: d.phone,
        legal_name: d.legalName,
        registration_no: d.registrationNo,
        gst_number: d.gstNumber,
        pan_number: d.panNumber,
        registered_address: d.registeredAddress,
        description: d.description || null,
        permit_doc_url: d.permitDocUrl || null,
        fitness_doc_url: d.fitnessDocUrl || null,
      })
      .eq('id', id);
    if (error) throw new AppError('ADMIN', error.message);
  } catch (e) {
    return { error: toErrorResponse(e).message };
  }
  await logAction(db, 'AGENCY_UPDATED', 'agency', id, { name: d.name });
  revalidatePath('/aevinite/providers');
  revalidatePath(`/aevinite/providers/${id}/edit`);
  // The name flows into the admin report + CSV and the agency's own dashboard —
  // bust both caches so they don't show the old name ~60s (mirrors the agency's
  // own edit).
  revalidatePath('/aevinite');
  updateTag('admin-report');
  updateTag(agencyReportTag(id));
  return { message: 'Provider details updated.' };
}

async function reviewerId(db: Awaited<ReturnType<typeof createClient>>): Promise<string | null> {
  const { data } = await db.auth.getClaims();
  return (data?.claims as { sub?: string } | null)?.sub ?? null;
}

/**
 * True when this request still awaits a campus decision AND its campus has no
 * live campus admin — the only case where the platform admin may decide the
 * campus stage too (otherwise the request would be stuck forever).
 */
async function campusHasNoAdmin(
  db: Awaited<ReturnType<typeof createClient>>,
  requestId: string,
): Promise<boolean> {
  const { data } = await db
    .from('agency_service_requests')
    .select('institution_id, campus_status')
    .eq('id', requestId)
    .maybeSingle();
  const r = data as { institution_id: string; campus_status: string } | null;
  if (!r || r.campus_status !== 'PENDING') return false;
  const staffed = await campusesWithAdmin([r.institution_id]);
  return !staffed.has(r.institution_id);
}

/** Approve a service-area request: create the live service, then mark it approved. */
export async function approveServiceRequestAction(formData: FormData): Promise<void> {
  const id = String(formData.get('requestId') ?? '');
  if (!UUID_RE.test(id)) return;
  await assertSuperAdmin();
  const db = await createClient();
  const overrideCampus = await campusHasNoAdmin(db, id);

  // Claim the request ATOMICALLY: flip PENDING→APPROVED in one guarded UPDATE.
  // Whoever wins gets the row back; a second (double-click / concurrent) call
  // matches nothing and bails — so we can't run the insert twice and create a
  // duplicate listing that students would then see twice.
  const { data: claimed, error: claimErr } = await db
    .from('agency_service_requests')
    .update({
      status: 'APPROVED',
      // A campus with no campus admin can never decide — the admin decides both stages.
      ...(overrideCampus ? { campus_status: 'APPROVED' } : {}),
      reviewed_at: new Date().toISOString(),
      reviewed_by: await reviewerId(db),
    })
    .eq('id', id)
    .eq('status', 'PENDING')
    // Final approval is only available AFTER the campus has accepted (two-stage
    // flow, migration 0124) — or for an unstaffed campus, while it still awaits one.
    .eq('campus_status', overrideCampus ? 'PENDING' : 'APPROVED')
    .select('id, agency_id, institution_id, vehicle_type, name, description')
    .maybeSingle();
  // A failed write also yields claimed=null — surface it instead of treating it
  // as "already claimed" and silently leaving the request PENDING / service dead.
  if (claimErr) throw new AppError('ADMIN', claimErr.message);
  if (!claimed) return; // already handled by a concurrent approval

  // Upsert (not insert) so an existing service for the same
  // agency+institution+vehicle_type is never duplicated (backed by the unique
  // index in migration 0036). ignoreDuplicates keeps the earliest row/name.
  const { error: insErr } = await db.from('agency_services').upsert(
    {
      agency_id: claimed.agency_id,
      institution_id: claimed.institution_id,
      vehicle_type: claimed.vehicle_type,
      name: claimed.name,
      description: claimed.description,
    },
    { onConflict: 'agency_id,institution_id,vehicle_type', ignoreDuplicates: true },
  );
  if (insErr) throw new AppError('ADMIN', insErr.message);

  await logAction(db, 'SERVICE_REQUEST_APPROVED', 'agency_service_request', id, { name: claimed.name });
  revalidatePath('/aevinite/service-requests');
  // The newly-live service area shows on the providers page — refresh it (and
  // the dashboard) so the change doesn't lag behind the approval.
  revalidatePath('/aevinite/providers');
  revalidatePath('/aevinite'); updateTag('admin-report'); // report tag (future-proof if it aggregates service areas)
  // The agency's OWN dashboard "services" tile is cached per-agency — bust it too,
  // else it lags ~60s behind the approval.
  updateTag(agencyReportTag(claimed.agency_id as string));
}

export async function rejectServiceRequestAction(formData: FormData): Promise<void> {
  const id = String(formData.get('requestId') ?? '');
  if (!UUID_RE.test(id)) return;
  const reason = String(formData.get('reason') ?? '').trim();
  await assertSuperAdmin();
  const db = await createClient();
  const overrideCampus = await campusHasNoAdmin(db, id);
  const { data: updated, error } = await db
    .from('agency_service_requests')
    .update({
      status: 'REJECTED',
      ...(overrideCampus ? { campus_status: 'APPROVED' } : {}), // renders "Rejected by admin"
      rejected_reason: reason || null,
      reviewed_at: new Date().toISOString(),
      reviewed_by: await reviewerId(db),
    })
    .eq('id', id)
    // Only a still-PENDING request the campus has accepted (or an unstaffed
    // campus's still-awaiting one) can be rejected here — mirrors approve's
    // atomic claim, so a reject-after-approve race can't flip an APPROVED
    // request back to REJECTED while leaving the live agency_services row.
    .eq('status', 'PENDING')
    .eq('campus_status', overrideCampus ? 'PENDING' : 'APPROVED')
    .select('id')
    .maybeSingle();
  if (error) throw new AppError('ADMIN', error.message);
  // Zero rows matched (already approved/rejected by a concurrent action) → don't
  // write a misleading audit row or report success; just refresh and bail.
  if (!updated) {
    revalidatePath('/aevinite/service-requests');
    return;
  }
  await logAction(db, 'SERVICE_REQUEST_REJECTED', 'agency_service_request', id, reason ? { reason } : {});
  revalidatePath('/aevinite/service-requests');
  updateTag('admin-report'); // report tag (future-proof)
}

async function setStudent(db: Db, profileId: string, patch: Record<string, unknown>) {
  const { error } = await db.from('profiles').update(patch).eq('id', profileId);
  if (error) throw new AppError('ADMIN', error.message);
}

export async function deleteStudentAction(formData: FormData): Promise<void> {
  const id = String(formData.get('studentId') ?? '');
  if (!UUID_RE.test(id)) return;
  const db = await createClient();
  await setStudent(db, id, { is_deleted: true, deleted_at: new Date().toISOString() });
  await logAction(db, 'STUDENT_DELETED', 'profile', id);
  revalidatePath('/aevinite/students');
  revalidatePath('/aevinite/deleted-students');
  revalidatePath('/aevinite'); updateTag('admin-report'); // count cards + report charts
}

export async function restoreStudentAction(formData: FormData): Promise<void> {
  const id = String(formData.get('studentId') ?? '');
  if (!UUID_RE.test(id)) return;
  const db = await createClient();
  await setStudent(db, id, { is_deleted: false, deleted_at: null });
  await logAction(db, 'STUDENT_RESTORED', 'profile', id);
  revalidatePath('/aevinite/students');
  revalidatePath('/aevinite/deleted-students');
  revalidatePath('/aevinite'); updateTag('admin-report'); // count cards + report charts
}

/**
 * Permanently remove a soft-deleted student: deletes the auth user, which
 * cascades their profile (profiles.id → auth.users on delete cascade) and frees
 * the email for reuse. Irreversible — only reachable from Deleted Students.
 * Mirrors permanentlyDeleteAgencyAction (issue 5: student/agency parity).
 */
export async function permanentlyDeleteStudentAction(formData: FormData): Promise<void> {
  const id = String(formData.get('studentId') ?? '');
  if (!UUID_RE.test(id)) return;
  await assertSuperAdmin();
  const admin = createAdminClient();
  // Only purge an already soft-deleted student (parity with the agency/driver
  // purges) — reached from Deleted Students, so an active student arriving here
  // is a stale view, not an instruction to irreversibly delete a live account.
  const { data: prof, error: readErr } = await admin
    .from('profiles')
    .select('is_deleted')
    .eq('id', id)
    .maybeSingle();
  if (readErr) throw new AppError('ADMIN', readErr.message);
  if (!prof || (prof as { is_deleted: boolean }).is_deleted !== true) return;
  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) throw new AppError('ADMIN', error.message);
  await logAction(await createClient(), 'STUDENT_PURGED', 'profile', id);
  revalidatePath('/aevinite/deleted-students');
  revalidatePath('/aevinite/students');
  revalidatePath('/aevinite'); updateTag('admin-report'); // count cards + report charts
}

export async function addCollegeAction(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = collegeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'Please complete the college form.' };
  const db = await createClient();
  const d = parsed.data;
  let newId: string | null = null;
  try {
    const { data, error } = await db
      .from('institutions')
      .insert({
        name: d.name,
        slug: slugify(d.name),
        kind: d.kind,
        area: d.area || null,
        city: d.city || null,
        image_url: d.imageUrl || null,
        description: d.description || null,
        is_verified: d.verified,
      })
      // Capture the new row's id so the Activity Log "Target" isn't "—".
      .select('id')
      .single();
    if (error) throw new AppError('ADMIN', error.message);
    newId = (data as { id: string }).id;
  } catch (e) {
    return { error: toErrorResponse(e).message };
  }
  await logAction(db, 'COLLEGE_ADDED', 'institution', newId, { name: d.name });
  revalidatePath('/aevinite/colleges');
  revalidatePath('/aevinite'); updateTag('admin-report'); // count cards + report
  // Redirect to the list on success instead of leaving the filled form up —
  // otherwise a second submit (or a back-forward) creates a near-duplicate college.
  redirect('/aevinite/colleges');
}

export async function updateCollegeAction(_: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get('id') ?? '');
  const parsed = collegeSchema.safeParse(Object.fromEntries(formData));
  if (!id || !parsed.success) return { error: 'Please complete the college form.' };
  const db = await createClient();
  const d = parsed.data;
  try {
    const { error } = await db
      .from('institutions')
      .update({
        name: d.name,
        kind: d.kind,
        area: d.area || null,
        city: d.city || null,
        image_url: d.imageUrl || null,
        description: d.description || null,
        is_verified: d.verified,
      })
      .eq('id', id);
    if (error) throw new AppError('ADMIN', error.message);
  } catch (e) {
    return { error: toErrorResponse(e).message };
  }
  await logAction(db, 'COLLEGE_UPDATED', 'institution', id, { name: d.name });
  revalidatePath('/aevinite/colleges');
  // The college name flows into the admin report. (Per-agency cached reports also
  // show it but can't be selectively busted here — they self-heal within 60s.)
  revalidatePath('/aevinite');
  updateTag('admin-report');
  return { message: 'College updated.' };
}

/**
 * Soft-delete a college/school (issue 2). Previously this hard-deleted the row —
 * silently cascading away every route, agency service listing and student
 * booking tied to that institution, and reporting "success" even when the
 * delete failed. Now it just flags the row (reversible from Deleted Colleges),
 * matching how agencies and students behave, and surfaces any DB error.
 */
export async function deleteCollegeAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!UUID_RE.test(id)) return;
  const db = await createClient();
  const { error } = await db
    .from('institutions')
    .update({ is_deleted: true, deleted_at: new Date().toISOString(), is_active: false })
    .eq('id', id);
  if (error) throw new AppError('ADMIN', error.message);
  await logAction(db, 'COLLEGE_DELETED', 'institution', id);
  revalidatePath('/aevinite/colleges');
  revalidatePath('/aevinite/deleted-colleges');
  revalidatePath('/aevinite'); updateTag('admin-report'); // count cards + report charts
}

export async function restoreCollegeAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!UUID_RE.test(id)) return;
  const db = await createClient();
  const { error } = await db
    .from('institutions')
    // Delete set is_active=false to hide it from students; restore must flip it
    // back on, otherwise a "restored" college stays invisible to students.
    .update({ is_deleted: false, deleted_at: null, is_active: true })
    .eq('id', id);
  if (error) throw new AppError('ADMIN', error.message);
  await logAction(db, 'COLLEGE_RESTORED', 'institution', id);
  revalidatePath('/aevinite/colleges');
  revalidatePath('/aevinite/deleted-colleges');
  revalidatePath('/aevinite'); updateTag('admin-report'); // count cards + report charts
}

/**
 * Permanently remove a soft-deleted college. This DOES cascade — wiping the
 * institution's routes, route stops, agency service listings, bookings and
 * payments (all FK `on delete cascade`). Irreversible; only reachable from the
 * Deleted Colleges page behind an explicit confirm dialog. Uses the service-role
 * client so it works regardless of RLS.
 */
export async function permanentlyDeleteCollegeAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!UUID_RE.test(id)) return;
  await assertSuperAdmin();
  const admin = createAdminClient();
  // Only purge an already soft-deleted college (parity with the other purges) —
  // this cascades routes/stops/bookings/payments, so a stale click on a live
  // college must not irreversibly wipe it. Reached only from Deleted Colleges.
  const { data: inst, error: readErr } = await admin
    .from('institutions')
    .select('is_deleted')
    .eq('id', id)
    .maybeSingle();
  if (readErr) throw new AppError('ADMIN', readErr.message);
  if (!inst || (inst as { is_deleted: boolean }).is_deleted !== true) return;
  const { error } = await admin.from('institutions').delete().eq('id', id);
  if (error) throw new AppError('ADMIN', error.message);
  await logAction(await createClient(), 'COLLEGE_PURGED', 'institution', id);
  revalidatePath('/aevinite/deleted-colleges');
  revalidatePath('/aevinite/colleges');
  revalidatePath('/aevinite'); updateTag('admin-report'); // count cards + report charts
}

// Enable/disable a college. A disabled (is_active=false) college is hidden from
// students so they can't browse or apply to it; the admin still sees it here.
export async function toggleCollegeAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!UUID_RE.test(id)) return;
  const active = String(formData.get('active') ?? '') === 'true';
  const db = await createClient();
  const { error } = await db.from('institutions').update({ is_active: active }).eq('id', id);
  if (error) throw new AppError('ADMIN', error.message);
  await logAction(db, active ? 'COLLEGE_ENABLED' : 'COLLEGE_DISABLED', 'institution', id);
  revalidatePath('/aevinite/colleges');
}

// ---------------------------------------------------------------------------
// SELF-REGISTERED campus applications. A school/college that signed itself up
// (via /institution/register) lands as a hidden, unverified institution with a
// linked campus admin. A SUPER_ADMIN reviews it here and either approves it
// (goes live + verified, visible to agencies/students) or rejects it (soft-
// deletes the campus AND its admin login so a bogus application can't operate).
// ---------------------------------------------------------------------------

/** Approve a self-registered campus → make it live (active) and verified. */
export async function approveCampusApplicationAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!UUID_RE.test(id)) return;
  await assertSuperAdmin();
  const db = await createClient();
  // Guarded write: only flip an application that's still pending (hidden +
  // unverified + not deleted), so a stale double-click can't "re-approve" and a
  // wrong id matches zero rows.
  const { error } = await db
    .from('institutions')
    .update({ is_active: true, is_verified: true })
    .eq('id', id)
    .eq('is_active', false)
    .eq('is_verified', false)
    .eq('is_deleted', false);
  if (error) throw new AppError('ADMIN', error.message);
  await logAction(db, 'CAMPUS_APPLICATION_APPROVED', 'institution', id);
  revalidatePath('/aevinite/colleges');
  revalidatePath('/aevinite'); updateTag('admin-report');
}

/** Reject a self-registered campus → soft-delete it and deactivate its admins. */
export async function rejectCampusApplicationAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!UUID_RE.test(id)) return;
  await assertSuperAdmin();
  const admin = createAdminClient();
  // Soft-delete the campus (reversible from Deleted Colleges) — guarded to a
  // still-PENDING application (hidden + UNVERIFIED), so a stale tab can't hit a
  // campus that was already approved, or an admin-disabled (verified) college.
  const { data: rejected, error } = await admin
    .from('institutions')
    .update({ is_deleted: true, deleted_at: new Date().toISOString(), is_active: false })
    .eq('id', id)
    .eq('is_active', false)
    .eq('is_verified', false)
    .eq('is_deleted', false)
    .select('id')
    .maybeSingle();
  if (error) throw new AppError('ADMIN', error.message);
  if (!rejected) {
    // Nothing matched (already approved / rejected / not an application) — leave
    // its campus admins alone.
    revalidatePath('/aevinite/colleges');
    return;
  }
  // … and soft-delete its campus admin(s) so the rejected login loses all access
  // (isAccountDeactivated gates on profiles.is_deleted for INSTITUTION_ADMIN).
  await admin
    .from('profiles')
    .update({ is_deleted: true })
    .eq('institution_id', id)
    .eq('role', 'INSTITUTION_ADMIN');
  await logAction(await createClient(), 'CAMPUS_APPLICATION_REJECTED', 'institution', id);
  revalidatePath('/aevinite/colleges');
  revalidatePath('/aevinite/deleted-colleges');
  revalidatePath('/aevinite'); updateTag('admin-report');
}

// ---------------------------------------------------------------------------
// Institution (campus) admin provisioning. A SUPER_ADMIN creates a campus-admin
// login and links it to a college, so that person can run the /institution
// oversight console for their campus. The account is email-confirmed on the spot
// (admin-vouched) — no email step — and the college link (profiles.institution_id)
// is what the access-token hook injects into their JWT as the campus claim.
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function createInstitutionAdminAction(_: FormState, formData: FormData): Promise<FormState> {
  const collegeId = String(formData.get('collegeId') ?? '');
  const name = String(formData.get('name') ?? '').trim();
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  if (!UUID_RE.test(collegeId)) return { error: 'Missing college.' };
  if (!name) return { error: 'Enter the admin’s name.' };
  if (!EMAIL_RE.test(email)) return { error: 'Enter a valid email address.' };
  if (password.length < 8) return { error: 'Password must be at least 8 characters.' };
  try {
    await assertSuperAdmin();
  } catch (e) {
    return { error: toErrorResponse(e).message };
  }

  const admin = createAdminClient();

  // The college must exist and be live before we attach an admin to it.
  const { data: college, error: cErr } = await admin
    .from('institutions')
    .select('id, name, is_deleted')
    .eq('id', collegeId)
    .maybeSingle();
  if (cErr) return { error: cErr.message };
  if (!college || (college as { is_deleted: boolean }).is_deleted) return { error: 'College not found.' };

  const free = await ensureEmailFreeForSignup(admin, email);
  if (free.error) return { error: free.error };

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // admin-vouched — can sign in immediately, no email step
    user_metadata: { role: 'INSTITUTION_ADMIN', full_name: name },
  });
  if (createErr || !created.user) {
    return { error: createErr?.message ?? 'Could not create the account.' };
  }
  const uid = created.user.id;

  // handle_new_user creates the profile (role INSTITUTION_ADMIN + name + email);
  // link it to this campus. Roll the auth user back if the link fails so the
  // email stays reusable and we don't strand an unlinked admin.
  const { error: linkErr } = await admin
    .from('profiles')
    .update({ full_name: name, institution_id: collegeId })
    .eq('id', uid);
  if (linkErr) {
    await admin.auth.admin.deleteUser(uid);
    return { error: linkErr.message };
  }

  await logAction(await createClient(), 'INSTITUTION_ADMIN_CREATED', 'profile', uid, {
    institution_id: collegeId,
    name: (college as { name: string }).name,
  });
  revalidatePath(`/aevinite/colleges/${collegeId}/edit`);
  return { message: `Campus admin created for ${(college as { name: string }).name}.` };
}

/** Unlink a campus admin from their college — they lose campus access (the panel
 *  shows "no campus linked") but the login is preserved. Reversible by relinking. */
export async function unlinkInstitutionAdminAction(formData: FormData): Promise<void> {
  const profileId = String(formData.get('profileId') ?? '');
  const collegeId = String(formData.get('collegeId') ?? '');
  if (!UUID_RE.test(profileId) || !UUID_RE.test(collegeId)) return;
  await assertSuperAdmin();
  const admin = createAdminClient();
  // Scope the update to this college so a stale form can't detach an admin from a
  // campus they were since moved to.
  const { error } = await admin
    .from('profiles')
    .update({ institution_id: null })
    .eq('id', profileId)
    .eq('institution_id', collegeId)
    .eq('role', 'INSTITUTION_ADMIN');
  if (error) throw new AppError('ADMIN', error.message);
  await logAction(await createClient(), 'INSTITUTION_ADMIN_UNLINKED', 'profile', profileId, {
    institution_id: collegeId,
  });
  revalidatePath(`/aevinite/colleges/${collegeId}/edit`);
}
