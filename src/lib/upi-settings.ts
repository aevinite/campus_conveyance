// Platform UPI payment config, stored in the DB (app_settings, key 'upi') like
// the maintenance flags — so it works on serverless / multi-instance hosts.
//
// One receiving VPA for the whole platform (single-account model). Families pay
// to this VPA via QR / upi:// deep link; a SUPER_ADMIN then verifies the UTR.
// Written via the service-role client only (app_settings has RLS on, no policy).
import { createAdminClient } from '@/lib/supabase/admin';

const KEY = 'upi';
const CACHE_TTL_MS = 10_000;

export interface UpiSettings {
  /** The platform's UPI VPA, e.g. "campus@okhdfcbank". Empty = not configured. */
  vpa: string;
  /** Payee display name shown in the UPI app. */
  payeeName: string;
  /** When false, the UPI panel shows "payments not set up yet". */
  active: boolean;
  updatedAt?: string;
}

const EMPTY: UpiSettings = { vpa: '', payeeName: '', active: false };

let cache: { state: UpiSettings; at: number } | null = null;

export async function getUpiSettings(): Promise<UpiSettings> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.state;
  try {
    const admin = createAdminClient();
    const { data } = await admin.from('app_settings').select('value').eq('key', KEY).maybeSingle();
    const v = (data?.value ?? {}) as Partial<UpiSettings>;
    const state: UpiSettings = {
      vpa: v.vpa ?? '',
      payeeName: v.payeeName ?? '',
      active: v.active ?? false,
      updatedAt: v.updatedAt,
    };
    cache = { state, at: Date.now() };
    return state;
  } catch {
    // DB unreachable / not provisioned → treat as not configured (panel disabled).
    return EMPTY;
  }
}

export async function setUpiSettings(input: {
  vpa: string;
  payeeName: string;
  active: boolean;
}): Promise<UpiSettings> {
  const state: UpiSettings = {
    vpa: input.vpa.trim(),
    payeeName: input.payeeName.trim(),
    active: input.active,
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

/**
 * Build the UPI intent/QR string for a payment. `amountRupees` is a plain rupee
 * amount (e.g. "900.00"). Returns null when UPI isn't configured/active.
 * The `tr` reference matches payments.reference set by submit_upi_payment.
 */
export function buildUpiString(
  s: UpiSettings,
  opts: { amountRupees: string; note: string; reference: string },
): string | null {
  if (!s.active || !s.vpa) return null;
  const p = new URLSearchParams({
    pa: s.vpa,
    pn: s.payeeName || 'Campus Conveyance',
    am: opts.amountRupees,
    cu: 'INR',
    tn: opts.note,
    tr: opts.reference,
  });
  return `upi://pay?${p.toString()}`;
}
