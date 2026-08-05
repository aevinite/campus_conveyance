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

/** Approve an agency's request to serve this campus → create the live service. */
export async function approveCampusServiceRequestAction(formData: FormData): Promise<void> {
  const id = String(formData.get('requestId') ?? '');
  if (!UUID_RE.test(id)) return;
  const campus = await resolveInstitutionId();
  if (!campus) return; // not a campus admin, or unlinked account

  const server = await createClient();
  const { userId } = await getSessionClaims(server);
  const admin = createAdminClient();

  // Atomic claim: flip PENDING→APPROVED only if the request is still pending AND
  // belongs to this campus. A double-click / cross-campus id matches nothing.
  const { data: claimed, error: claimErr } = await admin
    .from('agency_service_requests')
    .update({ status: 'APPROVED', reviewed_at: new Date().toISOString(), reviewed_by: userId })
    .eq('id', id)
    .eq('status', 'PENDING')
    .eq('institution_id', campus)
    .select('id, agency_id, institution_id, vehicle_type, name, description')
    .maybeSingle();
  if (claimErr) throw claimErr;
  if (!claimed) {
    refresh();
    return; // already handled, or not this campus's request
  }

  // Upsert (never duplicate) the live service — backed by the unique index on
  // (agency_id, institution_id, vehicle_type). Mirrors the SUPER_ADMIN flow.
  const { error: insErr } = await admin.from('agency_services').upsert(
    {
      agency_id: claimed.agency_id,
      institution_id: claimed.institution_id,
      vehicle_type: claimed.vehicle_type,
      name: claimed.name,
      description: claimed.description,
    },
    { onConflict: 'agency_id,institution_id,vehicle_type', ignoreDuplicates: true },
  );
  if (insErr) throw insErr;

  // The agency's own dashboard "services" tile is cached per-agency — bust it so
  // it doesn't lag behind the approval.
  updateTag(agencyReportTag(claimed.agency_id as string));
  refresh();
}

/** Reject an agency's request to serve this campus. */
export async function rejectCampusServiceRequestAction(formData: FormData): Promise<void> {
  const id = String(formData.get('requestId') ?? '');
  if (!UUID_RE.test(id)) return;
  const reason = String(formData.get('reason') ?? '').trim();
  const campus = await resolveInstitutionId();
  if (!campus) return;

  const server = await createClient();
  const { userId } = await getSessionClaims(server);
  const admin = createAdminClient();

  await admin
    .from('agency_service_requests')
    .update({
      status: 'REJECTED',
      rejected_reason: reason || null,
      reviewed_at: new Date().toISOString(),
      reviewed_by: userId,
    })
    .eq('id', id)
    .eq('status', 'PENDING')
    .eq('institution_id', campus);
  refresh();
}
