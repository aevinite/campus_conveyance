import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { drainEmailOutbox } from '@/lib/email-outbox';
import { drainPushOutbox } from '@/lib/push';

/**
 * Cron drain for the email + push outboxes.
 *
 * The outboxes are normally flushed best-effort via `after()` on user/driver
 * actions, so they empty whenever the app is being used. During quiet periods,
 * though, rows enqueued by DB crons (payment-timeout expiry, waitlist promotion)
 * could sit undelivered until the next request. A pg_cron job hits this endpoint
 * on a short interval so lifecycle notifications go out promptly regardless of
 * traffic. Draining is idempotent (claim = FOR UPDATE SKIP LOCKED) and safe to
 * call repeatedly; with an empty queue it's a no-op.
 *
 * Gated by the Supabase service-role key as a bearer token — the same secret the
 * pg_cron job already holds — so it can't be triggered by arbitrary visitors.
 */
export const runtime = 'nodejs';
// Co-locate with the Supabase DB (ap-northeast-1 / Tokyo) — see src/app/layout.tsx.
export const preferredRegion = 'hnd1';

function authorized(req: Request): boolean {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) return false; // misconfigured — refuse rather than run open
  const header = req.headers.get('authorization') ?? '';
  const expected = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(header);
  // Constant-time compare; timingSafeEqual throws on a length mismatch, which is
  // itself a non-match.
  return got.length === expected.length && timingSafeEqual(got, expected);
}

async function drain(req: Request): Promise<NextResponse> {
  const headers = { 'Cache-Control': 'no-store' };
  if (!authorized(req)) {
    return NextResponse.json({ ok: false }, { status: 401, headers });
  }
  // Drain both; each is independently best-effort and never throws.
  await Promise.allSettled([drainEmailOutbox(), drainPushOutbox()]);
  return NextResponse.json({ ok: true }, { headers });
}

export async function GET(req: Request) {
  return drain(req);
}

export async function POST(req: Request) {
  return drain(req);
}
