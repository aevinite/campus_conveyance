'use server';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { drainEmailOutbox } from '@/lib/email-outbox';
import { AppError, toErrorResponse } from '@/lib/errors/app-error';

export type NotificationActionResult = { ok?: boolean; error?: string };

const idSchema = z.string().uuid();

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
  revalidatePath('/', 'layout');
  return { ok: true };
}
