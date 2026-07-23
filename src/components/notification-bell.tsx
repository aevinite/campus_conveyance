'use client';
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, CheckCheck } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from '@/components/ui/dropdown-menu';
import {
  markNotificationReadAction,
  markAllNotificationsReadAction,
} from '@/features/notifications/actions';
import type { NotificationRow } from '@/features/notifications/repository';
import { cn } from '@/lib/utils';
import { formatCompactDateTime } from '@/lib/format-date';

/**
 * In-app notification inbox in the dashboard header. Data is fetched server-side
 * in the layout and passed in; actions mark items read and refresh the route
 * (there's no realtime yet — new updates show on the next navigation/refresh).
 */
export function NotificationBell({
  items,
  unread,
}: {
  items: NotificationRow[];
  unread: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function markRead(id: string) {
    startTransition(async () => {
      await markNotificationReadAction(id);
      router.refresh();
    });
  }
  function markAll() {
    startTransition(async () => {
      await markAllNotificationsReadAction();
      router.refresh();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="relative grid size-9 place-items-center rounded-full border border-border bg-background/60 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none data-[popup-open]:bg-secondary"
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : 'Notifications'}
      >
        <Bell className="size-4" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 grid min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" sideOffset={8} className="w-80 p-0">
        <div className="flex items-center justify-between px-3 py-2.5">
          <p className="text-sm font-semibold">Notifications</p>
          {unread > 0 && (
            <button
              type="button"
              disabled={pending}
              onClick={markAll}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline disabled:opacity-60"
            >
              <CheckCheck className="size-3.5" /> Mark all read
            </button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto border-t border-border">
          {items.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              No notifications yet.
            </p>
          ) : (
            items.map((n) => (
              <button
                key={n.id}
                type="button"
                disabled={pending || n.is_read}
                onClick={() => markRead(n.id)}
                className={cn(
                  'flex w-full flex-col items-start gap-0.5 border-b border-border px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-secondary/40 disabled:cursor-default',
                  !n.is_read && 'bg-primary/5',
                )}
              >
                <span className="flex w-full items-center gap-2">
                  {!n.is_read && <span className="size-1.5 shrink-0 rounded-full bg-primary" />}
                  <span className="text-sm font-medium">{n.title}</span>
                </span>
                {n.body && <span className="text-xs text-muted-foreground">{n.body}</span>}
                <span className="text-[11px] text-muted-foreground">
                  {formatCompactDateTime(n.created_at)}
                </span>
              </button>
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
