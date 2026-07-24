'use server';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { drainEmailOutbox } from '@/lib/email-outbox';
import { drainPushOutbox } from '@/lib/push';
import { AppError, toErrorResponse } from '@/lib/errors/app-error';

export type NotificationActionResult = { ok?: boolean; error?: string };

const idSchema = z.string().uuid();

// A browser PushSubscription serialised via `subscription.toJSON()`.
const pushSubSchema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({
    p256dh: z.string().min(1).max(500),
    auth: z.string().min(1).max(500),
  }),
});

/**
 * Persist (upsert) the caller's browser Web-Push subscription so the booking
 * lifecycle can push to this device. Keyed by the unique endpoint — re-enabling
 * on the same browser just refreshes the row (incl. last_seen_at).
 */
export async function savePushSubscriptionAction(
  raw: unknown,
): Promise<NotificationActionResult> {
  const parsed = pushSubSchema.safeParse(raw);
  if (!parsed.success) return { error: 'Invalid push subscription.' };
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return { error: 'Not signed in.' };
  try {
    const { endpoint, keys } = parsed.data;
    // RLS (push_sub_* policies) ensures profile_id must equal auth.uid().
    const { error } = await db.from('push_subscriptions').upsert(
      {
        profile_id: user.id,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        user_agent: null,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'endpoint' },
    );
    if (error) throw new AppError('NOTIFICATION', error.message);
  } catch (e) {
    return { error: toErrorResponse(e).message };
  }
  return { ok: true };
}

/** Remove the caller's push subscription for a given browser endpoint. */
export async function removePushSubscriptionAction(
  endpoint: string,
): Promise<NotificationActionResult> {
  const db = await createClient();
  try {
    // RLS restricts the delete to the caller's own rows.
    const { error } = await db
      .from('push_subscriptions')
      .delete()
      .eq('endpoint', endpoint);
    if (error) throw new AppError('NOTIFICATION', error.message);
  } catch (e) {
    return { error: toErrorResponse(e).message };
  }
  return { ok: true };
}

/** Mark one of the caller's own notifications as read. */
export async function markNotificationReadAction(
  id: string,
): Promise<NotificationActionResult> {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return { error: 'Invalid notification.' };
  const db = await createClient();
  try {
    const { error } = await db.rpc('mark_notification_read', { p_id: parsed.data });
    if (error) throw new AppError('NOTIFICATION', error.message);
  } catch (e) {
    return { error: toErrorResponse(e).message };
  }
  // Opportunistically flush any lifecycle emails queued by DB-only paths
  // (payment-timeout / waitlist-promotion cron) that no action drained yet.
  after(() => drainEmailOutbox());
  after(() => drainPushOutbox());
  // The bell (unread badge + list) is rendered in every dashboard layout header.
  revalidatePath('/', 'layout');
  return { ok: true };
}

/** Mark all of the caller's unread notifications as read. */
export async function markAllNotificationsReadAction(): Promise<NotificationActionResult> {
  const db = await createClient();
  try {
    const { error } = await db.rpc('mark_all_notifications_read');
    if (error) throw new AppError('NOTIFICATION', error.message);
  } catch (e) {
    return { error: toErrorResponse(e).message };
  }
  after(() => drainEmailOutbox());
  after(() => drainPushOutbox());
  revalidatePath('/', 'layout');
  return { ok: true };
}
