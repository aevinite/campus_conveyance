import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendBookingLifecycleEmail } from '@/lib/mailer';

/**
 * Drain queued booking-lifecycle emails and send them over Gmail/Nodemailer.
 *
 * The `booking_notify` DB trigger enqueues one `email_outbox` row per recipient
 * whenever a booking changes state (from student/agency actions, the waitlist
 * promotion trigger, or the payment-timeout cron). This drainer is invoked
 * best-effort via `after()` from the booking + notification server actions, so
 * the queue flushes promptly whenever the app is being used — no dedicated cron
 * or new infrastructure required.
 *
 * It is intentionally impossible to break a request:
 *   • `claim_email_outbox` atomically claims a batch (FOR UPDATE SKIP LOCKED +
 *     attempts++), so concurrent drains never send the same row twice.
 *   • Every failure — unconfigured SMTP, a single bad address, a network hiccup
 *     — is caught and recorded on the row; the caller never sees it.
 */
export async function drainEmailOutbox(batchSize = 20): Promise<void> {
  // If email isn't configured there's nothing to send — skip silently rather
  // than claim rows we can't deliver (they'd just burn retry attempts).
  if (!process.env.GMAIL_SENDER || !process.env.GMAIL_APP_PASSWORD) return;

  try {
    const db = createAdminClient();
    const { data: rows, error } = await db.rpc('claim_email_outbox', {
      p_limit: batchSize,
    });
    if (error || !rows || rows.length === 0) return;

    for (const row of rows as Array<{
      id: string;
      to_email: string;
      title: string;
      body: string;
    }>) {
      try {
        await sendBookingLifecycleEmail(row.to_email, row.title, row.body);
        await db
          .from('email_outbox')
          .update({ sent_at: new Date().toISOString(), last_error: null })
          .eq('id', row.id);
      } catch (e) {
        // Leave sent_at null; attempts was already bumped by the claim, so it
        // retries on a later drain until it hits the cap (then retention prunes).
        const msg = e instanceof Error ? e.message : String(e);
        await db
          .from('email_outbox')
          .update({ last_error: msg.slice(0, 500) })
          .eq('id', row.id);
        console.error(`Outbox email ${row.id} failed to send:`, msg);
      }
    }
  } catch (e) {
    // Whole-drain failure (e.g. DB unreachable) is best-effort — never surfaces.
    console.error('drainEmailOutbox failed:', e);
  }
}
