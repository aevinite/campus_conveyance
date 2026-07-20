'use server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
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
  return { ok: true };
}
