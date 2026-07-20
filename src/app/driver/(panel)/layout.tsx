import { requireRole } from '@/features/auth/guard';
import { createClient } from '@/lib/supabase/server';
import { getDriverProfile, getDriverStatus, listDriverBuses } from '@/features/driver/repository';
import { PanelSidebar, type SidebarItem } from '@/components/panel-sidebar';
import { DriverTracker } from '@/components/driver-tracker';
import { logoutAction } from '@/features/auth/actions';
import { SubmitButton } from '@/components/submit-button';

const BASE_ITEMS: SidebarItem[] = [
  { label: 'Dashboard', href: '/driver', icon: 'LayoutDashboard' },
  { label: 'My Buses', href: '/driver/buses', icon: 'BusFront' },
  { label: 'My Riders', href: '/driver/riders', icon: 'Users' },
  { label: 'Profile', href: '/driver/profile', icon: 'UserCircle' },
];
// "Live map" is only useful to a driver actually driving a bus today, so it's
// shown on the same condition as the online/offline toggle.
const LIVE_ITEM: SidebarItem = { label: 'Live map', href: '/driver/live', icon: 'Route' };

export default async function DriverPanelLayout({ children }: { children: React.ReactNode }) {
  await requireRole('DRIVER', '/driver/login');
  const db = await createClient();
  // Profile + today's buses in parallel (both cached, shared with the pages).
  const [me, buses] = await Promise.all([getDriverProfile(db), listDriverBuses(db)]);
  // Only drivers actually driving a bus TODAY get the live-tracking toggle. A
  // conductor-substitute (or a driver with no bus today) would otherwise see a
  // "Go online" toggle that writes a location no rider's map ever reads.
  const drivesToday = Boolean(me && me.is_active) && buses.length > 0;
  // Fetch the online status ONLY when the toggle will render — no wasted RPC for
  // a driver with no bus today.
  const status = drivesToday ? await getDriverStatus(db) : null;

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

  const items = drivesToday
    ? [BASE_ITEMS[0], LIVE_ITEM, ...BASE_ITEMS.slice(1)]
    : BASE_ITEMS;

  return (
    <PanelSidebar items={items} homeHref="/driver" greeting={me.name ? `Hi, ${me.name}` : 'Driver'}>
      {drivesToday && <DriverTracker initialOnline={status?.is_online ?? false} />}
      {children}
    </PanelSidebar>
  );
}
