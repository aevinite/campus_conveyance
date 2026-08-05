import { Building2 } from 'lucide-react';
import { requireRole } from '@/features/auth/guard';
import { createClient } from '@/lib/supabase/server';
import { resolveInstitutionId } from '@/features/institution/repository';
import { getInstitution } from '@/features/catalog/repository';
import { PanelSidebar, type SidebarItem } from '@/components/panel-sidebar';
import { logoutAction } from '@/features/auth/actions';
import { SubmitButton } from '@/components/submit-button';

// Campus oversight console. Read-only across the board EXCEPT "Agency Requests",
// where the campus admin approves/rejects which agencies may serve this campus
// (the panel's one write path). Web/desktop only — no native bottom-nav branch.
const ITEMS: SidebarItem[] = [
  { label: 'Dashboard', href: '/institution', icon: 'LayoutDashboard' },
  { label: 'Routes', href: '/institution/routes', icon: 'Route' },
  { label: 'Agencies', href: '/institution/agencies', icon: 'Building2' },
  { label: 'Agency Requests', href: '/institution/requests', icon: 'ClipboardList' },
  { label: 'Riders', href: '/institution/riders', icon: 'UsersRound' },
  { label: 'Bookings', href: '/institution/bookings', icon: 'Ticket' },
  { label: 'Drivers', href: '/institution/drivers', icon: 'IdCard' },
  { label: 'Live', href: '/institution/live', icon: 'Radio' },
  { label: 'Reviews', href: '/institution/reviews', icon: 'Star' },
  { label: 'Settings', href: '/institution/settings', icon: 'Settings' },
];

export default async function InstitutionPanelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Institution admins sign in via the admin (aevinite) login — match that here
  // so a not-signed-in hit isn't bounced to the student /login.
  await requireRole('INSTITUTION_ADMIN', '/aevinite/login');
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

  const db = await createClient();
  const campus = await getInstitution(db, institutionId);

  return (
    <PanelSidebar items={ITEMS} homeHref="/institution" greeting={campus?.name ?? 'Your campus'}>
      {children}
    </PanelSidebar>
  );
}
