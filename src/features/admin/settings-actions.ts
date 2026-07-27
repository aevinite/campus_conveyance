'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getSessionRole } from '@/features/auth/session';
import { setMaintenance, type MaintenanceTarget } from '@/lib/maintenance';

// Turn maintenance mode on/off for one audience. Only a SUPER_ADMIN may do this.
// While a switch is on, the proxy blocks every non-admin request from that
// audience (Website = browser visitors, App = the native Campus Conveyance app)
// and shows the loader page. The two switches are independent.
export async function toggleMaintenanceAction(formData: FormData): Promise<void> {
  const db = await createClient();
  const role = await getSessionRole(db);
  if (role !== 'SUPER_ADMIN') return;

  const target: MaintenanceTarget = formData.get('target') === 'app' ? 'app' : 'website';
  const enabled = String(formData.get('enabled')) === 'true';
  await setMaintenance(target, enabled);

  try {
    const { data } = await db.auth.getClaims();
    const actorId = (data?.claims as { sub?: string } | null)?.sub ?? null;
    const label = target === 'app' ? 'APP' : 'WEBSITE';
    await db.from('audit_logs').insert({
      actor_id: actorId,
      action: enabled ? `MAINTENANCE_${label}_ON` : `MAINTENANCE_${label}_OFF`,
      entity: 'app_settings',
    });
  } catch {
    /* logging is best-effort */
  }
  revalidatePath('/', 'layout');
  revalidatePath('/aevinite/settings');
}
