// Global maintenance-mode flag. Stored in the database (app_settings) rather
// than a local JSON file, so it works on serverless / multi-instance hosts like
// Vercel where the filesystem is ephemeral and not shared between instances
// (the old .maintenance.json approach only worked on a single always-on server).
//
// The proxy checks this on every request, so we keep a short in-process cache to
// avoid a DB round-trip per request. Each instance converges on the latest value
// within CACHE_TTL_MS of a toggle; a write refreshes the local cache immediately.
import { createAdminClient } from '@/lib/supabase/admin';

const KEY = 'maintenance';
const CACHE_TTL_MS = 10_000;

export interface MaintenanceState {
  enabled: boolean;
  updatedAt?: string;
}

let cache: { state: MaintenanceState; at: number } | null = null;

export async function getMaintenance(): Promise<MaintenanceState> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.state;
  try {
    const admin = createAdminClient();
    const { data } = await admin.from('app_settings').select('value').eq('key', KEY).maybeSingle();
    const value = (data?.value ?? {}) as { enabled?: boolean; updatedAt?: string };
    const state: MaintenanceState = { enabled: value.enabled === true, updatedAt: value.updatedAt };
    cache = { state, at: Date.now() };
    return state;
  } catch {
    // DB unreachable / not provisioned → fail open (site stays live).
    return { enabled: false };
  }
}

export async function isMaintenanceOn(): Promise<boolean> {
  return (await getMaintenance()).enabled;
}

export async function setMaintenance(enabled: boolean): Promise<MaintenanceState> {
  const state: MaintenanceState = { enabled, updatedAt: new Date().toISOString() };
  const admin = createAdminClient();
  const { error } = await admin
    .from('app_settings')
    .upsert({ key: KEY, value: state, updated_at: state.updatedAt }, { onConflict: 'key' });
  if (error) throw error;
  cache = { state, at: Date.now() };
  return state;
}
