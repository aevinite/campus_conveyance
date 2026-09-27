import { Building2, Clock } from 'lucide-react';
import { requireRole } from '@/features/auth/guard';
import { createClient } from '@/lib/supabase/server';
import { getSessionClaims } from '@/features/auth/session';
import { resolveInstitutionId, getCampusApproval } from '@/features/institution/repository';
import { getInstitution } from '@/features/catalog/repository';
import { listNotifications, unreadNotificationCount } from '@/features/notifications/repository';
import { PanelShell, type PanelNavGroup } from '@/components/panel/panel-shell';
import { logoutAction } from '@/features/auth/actions';
import { SubmitButton } from '@/components/submit-button';

// Campus oversight console. Read-only across the board EXCEPT "Agency Requests",
// where the campus admin approves/rejects which agencies may serve this campus
// (the panel's one write path). Web/desktop only — no native bottom-nav branch.
const GROUPS: PanelNavGroup[] = [
  {
    heading: 'Operate',
    items: [
      { label: 'Dashboard', href: '/institution', icon: 'LayoutDashboard' },
      { label: 'Live', href: '/institution/live', icon: 'Radio' },
      { label: 'Riders', href: '/institution/riders', icon: 'UsersRound' },
      { label: 'Bookings', href: '/institution/bookings', icon: 'Ticket' },
    ],
  },
  {
    heading: 'Network',
    items: [
      { label: 'Routes', href: '/institution/routes', icon: 'Route' },
      { label: 'Agencies', href: '/institution/agencies', icon: 'Building2' },
      { label: 'Agency Requests', href: '/institution/requests', icon: 'ClipboardList' },
      { label: 'Drivers', href: '/institution/drivers', icon: 'IdCard' },
    ],
  },
  {
    heading: 'More',
    items: [
      { label: 'Reviews', href: '/institution/reviews', icon: 'Star' },
      { label: 'Settings', href: '/institution/settings', icon: 'Settings' },
    ],
  },
];

export default async function InstitutionPanelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Campus admins have their own login — send a not-signed-in hit there (not the
  // student /login).
  await requireRole('INSTITUTION_ADMIN', '/institution/login');
  const institutionId = await resolveInstitutionId();

  // Not linked to a campus yet — every page would be empty, so show a notice with
  // logout instead of a hollow panel. (SUPER_ADMIN with no campus lands here too;
  // they run the platform from /aevinite.)
  if (!institutionId) {
    return (
      <div className="bg-aurora relative flex min-h-screen flex-col items-center justify-center p-4 text-center sm:p-6">
        <div className="w-full max-w-md space-y-5 rounded-3xl border border-border bg-card p-6 shadow-lg sm:p-8">
          <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
            <Building2 className="size-7" />
          </span>
          <div className="space-y-2">
            <h1 className="text-xl font-heading font-bold tracking-tight sm:text-2xl">
              No campus linked yet
            </h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              This account isn&apos;t linked to a school or college. Ask the platform admin to link
              your account to your campus, then sign in again.
            </p>
          </div>
          <form action={logoutAction}>
            <SubmitButton variant="outline" size="sm" className="w-full sm:w-auto" pendingText="Logging out…">
              Log out
            </SubmitButton>
          </form>
        </div>
      </div>
    );
  }

  // A SELF-REGISTERED campus stays hidden (is_active=false) until a SUPER_ADMIN
  // approves it. Show a "pending verification" notice instead of a live console
  // so the admin knows their application is in review rather than seeing empty
  // pages. (Admin-provisioned campuses are active immediately and skip this.)
  const approval = await getCampusApproval(institutionId);
  if (approval && !approval.isActive) {
    return (
      <div className="bg-aurora relative flex min-h-screen flex-col items-center justify-center p-4 text-center sm:p-6">
        <div className="w-full max-w-md space-y-5 rounded-3xl border border-border bg-card p-6 shadow-lg sm:p-8">
          <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
            <Clock className="size-7" />
          </span>
          <div className="space-y-2">
            <h1 className="text-xl font-heading font-bold tracking-tight sm:text-2xl">
              Campus pending verification
            </h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Thanks for registering <span className="font-medium text-foreground">{approval.name}</span>.
              Our team is reviewing your campus. Once it&apos;s approved, your oversight console
              unlocks and your campus becomes visible to agencies and students. We&apos;ll be quick.
            </p>
          </div>
          <form action={logoutAction}>
            <SubmitButton variant="outline" size="sm" className="w-full sm:w-auto" pendingText="Logging out…">
              Log out
            </SubmitButton>
          </form>
        </div>
      </div>
    );
  }

  const db = await createClient();
  const [campus, { userId }, notifications, unread] = await Promise.all([
    getInstitution(db, institutionId),
    getSessionClaims(db),
    listNotifications(db),
    unreadNotificationCount(db),
  ]);

  return (
    <PanelShell
      groups={GROUPS}
      homeHref="/institution"
      subtitle={campus?.name ?? 'Your campus'}
      footer="Campus Conveyance · Campus admin"
      notifications={notifications}
      unread={unread}
      userId={userId}
    >
      {children}
    </PanelShell>
  );
}
