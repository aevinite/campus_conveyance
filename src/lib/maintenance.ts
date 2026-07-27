// Maintenance-mode flags. Stored in the database (app_settings) rather than a
// local JSON file, so it works on serverless / multi-instance hosts like Vercel
// where the filesystem is ephemeral and not shared between instances (the old
// .maintenance.json approach only worked on a single always-on server).
//
// There are TWO independent switches:
//   • website — pauses ordinary browser visitors.
//   • app     — pauses the installed PWA / packaged APK (standalone display).
// The proxy tells the two apart from a `client_kind` cookie (see
// components/client-kind.tsx) and blocks only the matching audience.
//
// The proxy checks this on every request, so we keep a short in-process cache to
// avoid a DB round-trip per request. Each instance converges on the latest value
// within CACHE_TTL_MS of a toggle; a write refreshes the local cache immediately.
import { createAdminClient } from '@/lib/supabase/admin';

const KEY = 'maintenance';
const CACHE_TTL_MS = 10_000;

export type MaintenanceTarget = 'website' | 'app';

export interface MaintenanceState {
  website: boolean;
  app: boolean;
  updatedAt?: string;
}

let cache: { state: MaintenanceState; at: number } | null = null;

export async function getMaintenance(): Promise<MaintenanceState> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.state;
  try {
    const admin = createAdminClient();
    const { data } = await admin.from('app_settings').select('value').eq('key', KEY).maybeSingle();
    const value = (data?.value ?? {}) as {
      website?: boolean;
      app?: boolean;
      enabled?: boolean; // legacy single-toggle value
      updatedAt?: string;
    };
    // Back-compat: an older single `enabled` flag maps to BOTH audiences until
    // the admin next toggles either switch (which rewrites the new shape).
    const legacy = value.enabled === true;
    const state: MaintenanceState = {
      website: value.website ?? legacy,
      app: value.app ?? legacy,
      updatedAt: value.updatedAt,
    };
    cache = { state, at: Date.now() };
    return state;
  } catch {
    // DB unreachable / not provisioned → fail open (site stays live).
    return { website: false, app: false };
  }
}

// Is the given audience currently paused? `kind` comes from the client_kind
// cookie/marker; anything that isn't the app is treated as the website.
export async function isMaintenanceOn(kind: MaintenanceTarget): Promise<boolean> {
  const state = await getMaintenance();
  return kind === 'app' ? state.app : state.website;
}

export async function setMaintenance(
  target: MaintenanceTarget,
  enabled: boolean,
): Promise<MaintenanceState> {
  const current = await getMaintenance();
  const state: MaintenanceState = {
    website: target === 'website' ? enabled : current.website,
    app: target === 'app' ? enabled : current.app,
    updatedAt: new Date().toISOString(),
  };
  const admin = createAdminClient();
  const { error } = await admin
    .from('app_settings')
    .upsert({ key: KEY, value: state, updated_at: state.updatedAt }, { onConflict: 'key' });
  if (error) throw error;
  cache = { state, at: Date.now() };
  return state;
}
