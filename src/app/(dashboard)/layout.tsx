import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSessionClaims } from '@/features/auth/session';
import { isAccountDeactivated } from '@/features/auth/account-status';
import { dashboardFor } from '@/lib/rbac/roles';
import { Logo } from '@/components/brand';
import { ThemeToggle } from '@/components/theme-toggle';
import { UserMenu } from '@/components/user-menu';
import { NotificationBell } from '@/components/notification-bell';
import { PushToggle } from '@/components/push-toggle';
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
  // Group-level role backstop: this (dashboard) group is for student / parent /
  // institution-admin only. AGENCY and DRIVER have their own panels, so bounce
  // them to their own dashboard — a safety net so a future page that forgets its
  // requireRole line still isn't reachable cross-panel. (SUPER_ADMIN may pass.)
  if (sessionRole === 'AGENCY' || sessionRole === 'DRIVER') {
    redirect(dashboardFor(sessionRole));
  }
  const role = sessionRole ?? 'STUDENT';
  const [notifications, unread] = await Promise.all([
    listNotifications(db),
    unreadNotificationCount(db),
  ]);
  return (
    <div className="min-h-screen bg-muted/30">
      <header className="dark sticky top-0 z-20 border-b border-sidebar-border bg-sidebar/95 text-sidebar-foreground backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          {/* Home link points at the viewer's own dashboard (student/parent/
              institution), not a hardcoded /student that bounces other roles. */}
          <Logo href={dashboardFor(role)} />
          <div className="flex items-center gap-2 sm:gap-2.5">
            <NotificationBell items={notifications} unread={unread} />
            <PushToggle />
            <ThemeToggle />
            <UserMenu name={fullName ?? ''} email={email ?? ''} role={role} />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">{children}</main>
    </div>
  );
}
