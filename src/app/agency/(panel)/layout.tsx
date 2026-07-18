import { requireRole } from '@/features/auth/guard';
import { createClient } from '@/lib/supabase/server';
import { getMyAgency } from '@/features/agency/repository';
import { PanelSidebar, type SidebarItem } from '@/components/panel-sidebar';
import { logoutAction } from '@/features/auth/actions';
import { SubmitButton } from '@/components/submit-button';

const ITEMS: SidebarItem[] = [
  { label: 'Dashboard', href: '/agency', icon: 'LayoutDashboard' },
  { label: 'Manage Students', href: '/agency/students', icon: 'Users' },
  { label: 'Deleted Students', href: '/agency/deleted-students', icon: 'UserMinus' },
  { label: 'Manage Booking', href: '/agency/bookings', icon: 'ClipboardList' },
  { label: 'View Booking', href: '/agency/view-bookings', icon: 'Eye' },
  { label: 'Add Bus', href: '/agency/add-bus', icon: 'Bus' },
  { label: 'Manage Buses', href: '/agency/buses', icon: 'BusFront' },
  { label: 'Add Route', href: '/agency/add-route', icon: 'MapPlus' },
  { label: 'Manage Routes', href: '/agency/routes', icon: 'Route' },
  { label: 'Manage Drivers', href: '/agency/drivers', icon: 'IdCard' },
  { label: 'Profile', href: '/agency/account', icon: 'UserCircle' },
  { label: 'Settings', href: '/agency/settings', icon: 'Settings' },
];

export default async function AgencyPanelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireRole('AGENCY', '/agency/login');
  const db = await createClient();
  const agency = await getMyAgency(db);

  // Approval gate: only an APPROVED agency sees the panel. PENDING/REJECTED (or
  // a missing row) get a status notice — write actions are unreachable.
  if (!agency || agency.status !== 'APPROVED') {
    const rejected = agency?.status === 'REJECTED';
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-6 text-center">
        <div className="max-w-md space-y-4 rounded-2xl border border-border bg-card/60 p-8">
          <h1 className="text-xl font-semibold">
            {rejected ? 'Application rejected' : 'Application under review'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {rejected
              ? agency?.rejected_reason
                ? `Reason: ${agency.rejected_reason}`
                : 'Your application was not approved. Please contact the platform admin.'
              : 'Your service-provider application is awaiting admin approval. You’ll be able to add buses and routes once it’s approved.'}
          </p>
          <form action={logoutAction}>
            <SubmitButton variant="outline" size="sm" pendingText="Logging out…">
              Log out
            </SubmitButton>
          </form>
        </div>
      </div>
    );
  }

  return (
    <PanelSidebar items={ITEMS} homeHref="/agency" greeting={`Hi, ${agency.name}`}>
      {children}
    </PanelSidebar>
  );
}
