import { requireRole } from '@/features/auth/guard';
import { createClient } from '@/lib/supabase/server';
import { getDriverProfile } from '@/features/driver/repository';
import { PanelSidebar, type SidebarItem } from '@/components/panel-sidebar';
import { logoutAction } from '@/features/auth/actions';
import { SubmitButton } from '@/components/submit-button';

const ITEMS: SidebarItem[] = [
  { label: 'Dashboard', href: '/driver', icon: 'LayoutDashboard' },
  { label: 'My Buses', href: '/driver/buses', icon: 'BusFront' },
  { label: 'My Riders', href: '/driver/riders', icon: 'Users' },
  { label: 'Profile', href: '/driver/profile', icon: 'UserCircle' },
];

export default async function DriverPanelLayout({ children }: { children: React.ReactNode }) {
  await requireRole('DRIVER', '/driver/login');
  const db = await createClient();
  const me = await getDriverProfile(db);

  // Gate: the account must have an active driver record (created by an agency).
  if (!me || !me.is_active) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-6 text-center">
        <div className="max-w-md space-y-4 rounded-2xl border border-border bg-card/60 p-8">
          <h1 className="text-xl font-semibold">
            {me && !me.is_active ? 'Account deactivated' : 'Driver account not set up'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {me && !me.is_active
              ? 'Your driver account has been deactivated. Please contact your service provider.'
              : 'Your driver profile isn’t linked to a service provider yet. Please contact the agency that created your account.'}
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
    <PanelSidebar items={ITEMS} homeHref="/driver" greeting={me.name ? `Hi, ${me.name}` : 'Driver'}>
      {children}
    </PanelSidebar>
  );
}
