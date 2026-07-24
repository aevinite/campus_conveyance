'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getSessionRole } from '@/features/auth/session';

// The one operational write the admin owns: marking a landing-page contact
// inquiry handled (or reopening it). Everything else in the ops console is
// read-only — bookings/seats/rides stay owned by agencies and drivers.
export async function setContactStatusAction(formData: FormData): Promise<void> {
  const db = await createClient();
  const role = await getSessionRole(db);
  if (role !== 'SUPER_ADMIN') return;

  const id = String(formData.get('id') ?? '');
  const status = String(formData.get('status') ?? '');
  if (!id || (status !== 'NEW' && status !== 'HANDLED')) return;

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
