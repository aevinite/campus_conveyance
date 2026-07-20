import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSessionClaims } from '@/features/auth/session';
import { isAccountDeactivated } from '@/features/auth/account-status';
import { Logo } from '@/components/brand';
import { ThemeToggle } from '@/components/theme-toggle';
import { UserMenu } from '@/components/user-menu';
import { NotificationBell } from '@/components/notification-bell';
import { listNotifications, unreadNotificationCount } from '@/features/notifications/repository';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const db = await createClient();
  const { userId, role: sessionRole, fullName, email } = await getSessionClaims(db);
  if (!userId) redirect('/login');
  // Removed (soft-deleted) accounts keep a live session — deny them at the layout
  // boundary too, not just on individual pages.
  if (await isAccountDeactivated(db, userId, sessionRole)) {
    await db.auth.signOut();
    redirect('/login');
  }
  const role = sessionRole ?? 'STUDENT';
  const [notifications, unread] = await Promise.all([
    listNotifications(db),
    unreadNotificationCount(db),
  ]);
  return (
    <div className="min-h-screen bg-muted/30">
      <header className="sticky top-0 z-20 border-b border-border bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <Logo href="/student" />
          <div className="flex items-center gap-2.5">
            <NotificationBell items={notifications} unread={unread} />
            <ThemeToggle />
            <UserMenu name={fullName ?? ''} email={email ?? ''} role={role} />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-6 lg:py-8">{children}</main>
    </div>
  );
}
