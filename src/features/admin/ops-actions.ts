'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getSessionRole } from '@/features/auth/session';

// Guard id-shaped input before it reaches Postgres — a malformed value is a
// 22P02 (invalid uuid) crash to the error page rather than a clean no-op.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The one operational write the admin owns: marking a landing-page contact
// inquiry handled (or reopening it). Everything else in the ops console is
// read-only — bookings/seats/rides stay owned by agencies and drivers.
export async function setContactStatusAction(formData: FormData): Promise<void> {
  const db = await createClient();
  const role = await getSessionRole(db);
  if (role !== 'SUPER_ADMIN') return;

  const id = String(formData.get('id') ?? '');
  const status = String(formData.get('status') ?? '');
  if (!UUID_RE.test(id) || (status !== 'NEW' && status !== 'HANDLED')) return;

  // Write via service-role (reads in this console already bypass RLS).
  const admin = createAdminClient();
  const { error } = await admin.from('contact_messages').update({ status }).eq('id', id);
  if (error) throw error;

  try {
    const { data } = await db.auth.getClaims();
    const actorId = (data?.claims as { sub?: string } | null)?.sub ?? null;
    await db.from('audit_logs').insert({
      actor_id: actorId,
      action: status === 'HANDLED' ? 'CONTACT_HANDLED' : 'CONTACT_REOPENED',
      entity: 'contact_messages',
      entity_id: id,
    });
  } catch {
    /* logging is best-effort */
  }
  revalidatePath('/aevinite/inquiries');
}

// Review moderation: hide (or restore) an abusive agency review. Hiding drops it
// from public browsing + the agency's list and excludes it from the aggregate
// (the reviews_recount trigger recomputes on the is_hidden UPDATE).
export async function setReviewHiddenAction(formData: FormData): Promise<void> {
  const db = await createClient();
  const role = await getSessionRole(db);
  if (role !== 'SUPER_ADMIN') return;

  const id = String(formData.get('id') ?? '');
  const hide = String(formData.get('hide') ?? '') === 'true';
  if (!UUID_RE.test(id)) return;

  const admin = createAdminClient();
  const { error } = await admin.from('reviews').update({ is_hidden: hide }).eq('id', id);
  if (error) throw error;

  try {
    const { data } = await db.auth.getClaims();
    const actorId = (data?.claims as { sub?: string } | null)?.sub ?? null;
    await db.from('audit_logs').insert({
      actor_id: actorId,
      action: hide ? 'REVIEW_HIDDEN' : 'REVIEW_RESTORED',
      entity: 'reviews',
      entity_id: id,
    });
  } catch {
    /* logging is best-effort */
  }
  revalidatePath('/aevinite/reviews');
}
