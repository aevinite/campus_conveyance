import type { SupabaseClient } from '@supabase/supabase-js';

export interface NotificationRow {
  id: string;
  title: string;
  body: string | null;
  is_read: boolean;
  created_at: string;
}

/** The signed-in user's own notifications, newest first (max 50). */
export async function listNotifications(db: SupabaseClient): Promise<NotificationRow[]> {
  const { data, error } = await db.rpc('my_notifications');
  if (error) throw error;
  return (data ?? []) as NotificationRow[];
}

/** Count of unread notifications for the signed-in user. */
export async function unreadNotificationCount(db: SupabaseClient): Promise<number> {
  const { data, error } = await db.rpc('unread_notification_count');
  if (error) throw error;
  return (data as number) ?? 0;
}
