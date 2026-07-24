import { ShieldAlert } from 'lucide-react';
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
// "Live map" and "Route progress" are only useful to a driver actually driving
// a bus today, so they show on the same condition as the online/offline toggle.
const LIVE_ITEM: SidebarItem = { label: 'Live map', href: '/driver/live', icon: 'Route' };
const STOPS_ITEM: SidebarItem = { label: 'Route progress', href: '/driver/stops', icon: 'Milestone' };

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
      <div className="flex min-h-screen flex-col items-center justify-center bg-aurora p-4 text-center sm:p-6">
        <div className="w-full max-w-md space-y-5 rounded-3xl border border-border bg-card p-6 shadow-lg sm:p-8">
          <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-destructive/10 text-destructive">
            <ShieldAlert className="size-7" />
          </span>
          <div className="space-y-2">
            <h1 className="text-xl font-heading font-bold tracking-tight">
              {me && !me.is_active ? 'Account deactivated' : 'Driver account not set up'}
            </h1>
            <p className="text-sm text-muted-foreground">
              {me && !me.is_active
                ? 'Your driver account has been deactivated. Please contact your service provider.'
                : 'Your driver profile isn’t linked to a service provider yet. Please contact the agency that created your account.'}
            </p>
          </div>
          <form action={logoutAction}>
            <SubmitButton variant="outline" size="lg" pendingText="Logging out…" className="w-full">
              Log out
            </SubmitButton>
          </form>
        </div>
      </div>
    );
  }

  // Dashboard, Live map, Route progress, then My Buses / My Riders / Profile.
  const items = drivesToday
    ? [BASE_ITEMS[0], LIVE_ITEM, STOPS_ITEM, ...BASE_ITEMS.slice(1)]
    : BASE_ITEMS;

  return (
    <PanelSidebar items={items} homeHref="/driver" greeting={me.name ? `Hi, ${me.name}` : 'Driver'}>
      {drivesToday && <DriverTracker initialOnline={status?.is_online ?? false} />}
      {children}
    </PanelSidebar>
  );
}
