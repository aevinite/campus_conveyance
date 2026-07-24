import 'server-only';
import crypto from 'node:crypto';

// Stateless email-OTP for the agency signup form. No DB row is needed: the
// 6-digit code lives only in the emailed message, and an HMAC signature (keyed by
// a server-only secret) is what travels back and forth. That signature is what we
// verify — the code itself is never trusted from the client.

const OTP_TTL_MS = 10 * 60 * 1000; // code is valid for 10 minutes
// "verified" proof valid for 2 hours — the agency KYC form is long, and a 30-min
// proof would expire mid-fill and fail submit with "Please verify your email"
// while the UI still showed a green Verified badge. The form ALSO auto-resets the
// badge if this ever lapses, so a stale badge can't dead-end the applicant.
const VERIFIED_TTL_MS = 2 * 60 * 60 * 1000;

function secret(): string {
  // Server-only key; never shipped to the browser.
  const real = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.GMAIL_APP_PASSWORD;
  if (real) return real;
  // The old code fell back to a HARDCODED constant so local dev worked without a
  // key — but if that ever ran in production (missing env), the OTP-signing key
  // would be public, letting anyone forge a "verified email" token. Refuse it in
  // production; keep the convenience fallback only for local dev.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('OTP secret unavailable: set SUPABASE_SERVICE_ROLE_KEY.');
  }
  return 'campus-conveyance-otp-dev-secret';
}

const norm = (email: string) => email.trim().toLowerCase();

function hmac(payload: string): string {
  return crypto.createHmac('sha256', secret()).update(payload).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/** A `<expiresAt>.<sig>` token whose signature is derived from the parts. */
function sign(parts: string[], expiresAt: number): string {
  return `${expiresAt}.${hmac([...parts, expiresAt].join('|'))}`;
}
function checkSigned(parts: string[], token: string): boolean {
  const [expStr, sig] = (token ?? '').split('.');
  const expiresAt = Number(expStr);
  if (!expStr || !sig || !Number.isFinite(expiresAt) || Date.now() > expiresAt) return false;
  return safeEqual(sig, hmac([...parts, expiresAt].join('|')));
}

/** Create a random 6-digit code + the challenge token that pins it to this email. */
export function createOtpChallenge(email: string): { token: string; code: string } {
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const expiresAt = Date.now() + OTP_TTL_MS;
  return { token: sign(['otp', norm(email), code], expiresAt), code };
}

/** Confirm the user typed the right code; on success mint a short-lived proof. */
export function verifyOtpChallenge(
  email: string,
  code: string,
  token: string,
): { ok: boolean; verifiedToken?: string } {
  const [expStr] = (token ?? '').split('.');
  const expiresAt = Number(expStr);
  if (!Number.isFinite(expiresAt)) return { ok: false };
  // Re-derive the challenge signature from the submitted code and compare.
  const expected = sign(['otp', norm(email), (code ?? '').trim()], expiresAt);
  if (!safeEqual(token, expected) || Date.now() > expiresAt) return { ok: false };
  return { ok: true, verifiedToken: createVerifiedToken(email) };
}

function createVerifiedToken(email: string): string {
  return sign(['verified', norm(email)], Date.now() + VERIFIED_TTL_MS);
}

/** Used by the registration action to confirm the submitted email was verified. */
export function isEmailVerified(email: string, verifiedToken: string): boolean {
  return checkSigned(['verified', norm(email)], verifiedToken);
}
