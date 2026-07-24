import 'server-only';
import webpush from 'web-push';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Drain queued booking-lifecycle web-push notifications and deliver them over
 * VAPID to each recipient's subscribed browsers.
 *
 * The `booking_notify` DB trigger enqueues one `push_outbox` row per recipient
 * whenever a booking changes state. This drainer is invoked best-effort via
 * `after()` from the booking / agency / notification server actions, right next
 * to `drainEmailOutbox()` — so the queue flushes whenever the app is used, with
 * no dedicated cron.
 *
 * It is intentionally impossible to break a request:
 *   • `claim_push_outbox` atomically claims a batch (FOR UPDATE SKIP LOCKED +
 *     attempts++), so concurrent drains never send the same row twice.
 *   • A dead endpoint (404/410 Gone) deletes just that subscription.
 *   • Every other failure is caught and recorded on the row; the caller never
 *     sees it, and the row retries on a later drain until it hits the cap.
 */

let vapidReady: boolean | null = null;

// Configure the VAPID keys once. Returns false (and skips sending) if keys are
// not set, so an unconfigured environment simply doesn't deliver push.
function ensureVapid(): boolean {
  if (vapidReady !== null) return vapidReady;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';
  if (!pub || !priv) {
    vapidReady = false;
    return false;
  }
  try {
    webpush.setVapidDetails(subject, pub, priv);
    vapidReady = true;
  } catch {
    vapidReady = false;
  }
  return vapidReady;
}

type Sub = { endpoint: string; p256dh: string; auth: string };

export async function drainPushOutbox(batchSize = 20): Promise<void> {
  if (!ensureVapid()) return;

  try {
    const db = createAdminClient();
    const { data: rows, error } = await db.rpc('claim_push_outbox', {
      p_limit: batchSize,
    });
    if (error || !rows || rows.length === 0) return;

    for (const row of rows as Array<{
      id: string;
      recipient_id: string | null;
      title: string;
      body: string;
      url: string | null;
    }>) {
      if (!row.recipient_id) {
        // Recipient account was deleted — nothing to deliver; mark it done.
        await markSent(db, row.id);
        continue;
      }
      try {
        const { data: subs } = await db
          .from('push_subscriptions')
          .select('endpoint, p256dh, auth')
          .eq('profile_id', row.recipient_id);

        // No subscriptions is a valid state (user never enabled push) — the row
        // is "delivered" as far as push goes; the in-app bell + email still fire.
        if (subs && subs.length > 0) {
          const payload = JSON.stringify({
            title: row.title,
            body: row.body,
            url: row.url ?? '/',
          });
          await Promise.all(
            (subs as Sub[]).map((s) => sendOne(db, s, payload)),
          );
        }
        await markSent(db, row.id);
      } catch (e) {
        // Leave sent_at null; attempts was already bumped by the claim, so it
        // retries on a later drain until it hits the cap (then retention prunes).
        const msg = e instanceof Error ? e.message : String(e);
        await db
          .from('push_outbox')
          .update({ last_error: msg.slice(0, 500) })
          .eq('id', row.id);
        console.error(`Push outbox ${row.id} failed:`, msg);
      }
    }
  } catch (e) {
    // Whole-drain failure (e.g. DB unreachable) is best-effort — never surfaces.
    console.error('drainPushOutbox failed:', e);
  }
}

async function markSent(
  db: ReturnType<typeof createAdminClient>,
  id: string,
): Promise<void> {
  await db
    .from('push_outbox')
    .update({ sent_at: new Date().toISOString(), last_error: null })
    .eq('id', id);
}

// Send to one subscription. A 404/410 means the endpoint is permanently gone
// (browser cleared / uninstalled) → delete that subscription so it stops being
// retried. Any other error propagates so the caller records + retries the row.
async function sendOne(
  db: ReturnType<typeof createAdminClient>,
  sub: Sub,
  payload: string,
): Promise<void> {
  try {
    await webpush.sendNotification(
      {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      },
      payload,
      { TTL: 60 * 60 * 24 }, // hold up to a day if the device is offline
    );
  } catch (e) {
    const status = (e as { statusCode?: number })?.statusCode;
    if (status === 404 || status === 410) {
      await db.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
      return; // expired endpoint pruned — not a failure worth retrying
    }
    throw e;
  }
}
