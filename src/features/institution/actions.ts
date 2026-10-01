'use server';
// ---------------------------------------------------------------------------
// Institution (campus) admin GOVERNANCE actions — the panel's ONLY write path:
// approve/reject an agency's request to serve THIS campus.
//
// Security model matches the read side (institution/repository.ts): the campus
// id is resolved from the authenticated session via resolveInstitutionId()
// (INSTITUTION_ADMIN / SUPER_ADMIN only; null otherwise → bail), NEVER from user
// input. The mutating UPDATE additionally hard-filters `institution_id = campus`
// AND `status = 'PENDING'` in one atomic guarded write, so a campus admin can
// only ever act on a still-pending request belonging to their own campus — a
// wrong/forged requestId simply matches zero rows.
// ---------------------------------------------------------------------------
import { revalidatePath, updateTag } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { getSessionClaims } from '@/features/auth/session';
import { agencyReportTag } from '@/features/agency/repository';
import { resolveInstitutionId } from './repository';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function refresh() {
  revalidatePath('/institution/requests');
  revalidatePath('/institution/agencies');
  revalidatePath('/institution');
}

/**
 * Campus accepts an agency's request to serve this campus. This is the FIRST of
 * two stages: it does NOT create the live service — it forwards the request to
 * the platform admin, who gives the final approval (which creates the service).
 * Flips campus_status PENDING→APPROVED; the admin's `status` stays PENDING.
 */
export async function approveCampusServiceRequestAction(formData: FormData): Promise<void> {
  const id = String(formData.get('requestId') ?? '');
  if (!UUID_RE.test(id)) return;
  const campus = await resolveInstitutionId();
  if (!campus) return; // not a campus admin, or unlinked account

  const server = await createClient();
  const { userId } = await getSessionClaims(server);
  const admin = createAdminClient();

  // Issue #13: an agency that was rejected / never approved / deleted can't be
  // accepted (the DB trigger on agency_service_requests enforces this too).
  const { data: reqRow } = await admin
    .from('agency_service_requests')
    .select('agency_id')
    .eq('id', id)
    .eq('institution_id', campus)
    .maybeSingle();
  if (!reqRow) {
    refresh();
    return;
  }
  const { data: ag } = await admin
    .from('agencies')
    .select('status, is_deleted')
    .eq('id', (reqRow as { agency_id: string }).agency_id)
    .maybeSingle();
  const agRow = ag as { status: string; is_deleted: boolean } | null;
  if (!agRow || agRow.status !== 'APPROVED' || agRow.is_deleted) {
    throw new Error('This agency is no longer approved on the platform, so its request can only be rejected.');
  }

  // Atomic claim: flip campus_status PENDING→APPROVED only if still pending at
  // the campus AND belonging to this campus. A double-click / cross-campus id
  // matches nothing. No agency_services row is created here — that's the admin's
  // final approval step.
  const { data: claimed, error: claimErr } = await admin
    .from('agency_service_requests')
    .update({ campus_status: 'APPROVED', reviewed_at: new Date().toISOString(), reviewed_by: userId })
    .eq('id', id)
    .eq('campus_status', 'PENDING')
    .eq('institution_id', campus)
    .select('id, agency_id')
    .maybeSingle();
  if (claimErr) throw claimErr;
  if (!claimed) {
    refresh();
    return; // already handled, or not this campus's request
  }

  // The agency's own "requests" tile shows the stage — bust its per-agency cache
  // so "Awaiting admin" doesn't lag behind the campus's accept.
  updateTag(agencyReportTag(claimed.agency_id as string));
  refresh();
}

/** Campus rejects an agency's request. Terminal — the request never reaches the
 *  admin as actionable; the admin sees it as "Rejected by campus". */
export async function rejectCampusServiceRequestAction(formData: FormData): Promise<void> {
  const id = String(formData.get('requestId') ?? '');
  if (!UUID_RE.test(id)) return;
  const reason = String(formData.get('reason') ?? '').trim();
  const campus = await resolveInstitutionId();
  if (!campus) return;

  const server = await createClient();
  const { userId } = await getSessionClaims(server);
  const admin = createAdminClient();

  // Mark BOTH columns REJECTED: campus_status records who said no, and clearing
  // status out of 'PENDING' frees the partial unique index so the agency can
  // file a fresh request later.
  await admin
    .from('agency_service_requests')
    .update({
      campus_status: 'REJECTED',
      status: 'REJECTED',
      rejected_reason: reason || null,
      reviewed_at: new Date().toISOString(),
      reviewed_by: userId,
    })
    .eq('id', id)
    .eq('campus_status', 'PENDING')
    .eq('institution_id', campus);
  refresh();
}
