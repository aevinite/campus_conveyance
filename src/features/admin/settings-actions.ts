'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getSessionRole } from '@/features/auth/session';
import { setMaintenance, type MaintenanceTarget } from '@/lib/maintenance';
import { setUpiSettings } from '@/lib/upi-settings';

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

// Save the platform UPI details families pay to (single receiving account).
// SUPER_ADMIN only. When `active` is off, the booking UPI panel shows a
// "payments not set up yet" note instead of a QR.
export type UpiSettingsState = { ok?: boolean; error?: string };
export async function saveUpiSettingsAction(
  _: UpiSettingsState,
  formData: FormData,
): Promise<UpiSettingsState> {
  const db = await createClient();
  const role = await getSessionRole(db);
  if (role !== 'SUPER_ADMIN') return { error: 'Not allowed.' };

  const vpa = String(formData.get('vpa') ?? '').trim();
  const payeeName = String(formData.get('payeeName') ?? '').trim();
  const active = String(formData.get('active') ?? '') === 'on' || String(formData.get('active') ?? '') === 'true';

  // A UPI VPA looks like name@bank — validate loosely so a typo can't silently
  // ship a broken QR to every payer.
  if (active && !/^[\w.\-]{2,256}@[a-zA-Z]{2,64}$/.test(vpa)) {
    return { error: 'Enter a valid UPI ID like name@bank before turning it on.' };
  }

  try {
    await setUpiSettings({ vpa, payeeName, active });
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not save UPI settings.' };
  }

  try {
    const { data } = await db.auth.getClaims();
    const actorId = (data?.claims as { sub?: string } | null)?.sub ?? null;
    await db.from('audit_logs').insert({
      actor_id: actorId,
      action: active ? 'UPI_SETTINGS_ON' : 'UPI_SETTINGS_OFF',
      entity: 'app_settings',
    });
  } catch {
    /* logging is best-effort */
  }
  revalidatePath('/aevinite/settings');
  return { ok: true };
}
