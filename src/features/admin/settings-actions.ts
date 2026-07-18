'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getSessionRole } from '@/features/auth/session';
import { setMaintenance } from '@/lib/maintenance';

// Turn platform-wide maintenance mode on/off. Only a SUPER_ADMIN may do this;
// while on, the proxy blocks every non-admin request and shows the loader page.
export async function toggleMaintenanceAction(formData: FormData): Promise<void> {
  const db = await createClient();
  const role = await getSessionRole(db);
  if (role !== 'SUPER_ADMIN') return;
  const enabled = String(formData.get('enabled')) === 'true';
  await setMaintenance(enabled);
  try {
    const { data } = await db.auth.getClaims();
    const actorId = (data?.claims as { sub?: string } | null)?.sub ?? null;
    await db.from('audit_logs').insert({
      actor_id: actorId,
      action: enabled ? 'MAINTENANCE_ON' : 'MAINTENANCE_OFF',
      entity: 'app_settings',
    });
  } catch {
    /* logging is best-effort */
  }
  revalidatePath('/', 'layout');
  revalidatePath('/aevinite/settings');
}
