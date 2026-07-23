import { Clock3, ShieldAlert } from 'lucide-react';
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
  { label: 'Deleted Drivers', href: '/agency/deleted-drivers', icon: 'Trash2' },
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
      <div className="bg-aurora relative flex min-h-screen flex-col items-center justify-center p-4 text-center sm:p-6">
        <div className="w-full max-w-md space-y-5 rounded-3xl border border-border bg-card p-6 shadow-lg sm:p-8">
          <span
            className={`mx-auto grid size-14 place-items-center rounded-2xl ${
              rejected ? 'bg-destructive/10 text-destructive' : 'bg-warning/10 text-warning'
            }`}
          >
            {rejected ? <ShieldAlert className="size-7" /> : <Clock3 className="size-7" />}
          </span>
          <div className="space-y-2">
            <h1 className="text-xl font-heading font-bold tracking-tight sm:text-2xl">
              {rejected ? 'Application rejected' : 'Application under review'}
            </h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {rejected
                ? agency?.rejected_reason
                  ? `Reason: ${agency.rejected_reason}`
                  : 'Your application was not approved. Please contact the platform admin.'
                : 'Your service-provider application is awaiting admin approval. You’ll be able to add buses and routes once it’s approved.'}
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

  return (
    <PanelSidebar items={ITEMS} homeHref="/agency" greeting={`Hi, ${agency.name}`}>
      {children}
    </PanelSidebar>
  );
}
