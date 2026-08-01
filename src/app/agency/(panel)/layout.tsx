import { Clock3, ShieldAlert } from 'lucide-react';
import { requireRole } from '@/features/auth/guard';
import { createClient } from '@/lib/supabase/server';
import { isAppRequest } from '@/lib/app-context';
import { getMyAgency } from '@/features/agency/repository';
import { PanelSidebar, type SidebarItem } from '@/components/panel-sidebar';
import { AutoRefresh } from '@/components/auto-refresh';
import { AgencyBottomNav } from '@/components/agency-bottom-nav';
import { Logo } from '@/components/brand';
import { ThemeToggle } from '@/components/theme-toggle';
import { logoutAction } from '@/features/auth/actions';
import { SubmitButton } from '@/components/submit-button';

const ITEMS: SidebarItem[] = [
  { label: 'Dashboard', href: '/agency', icon: 'LayoutDashboard' },
  { label: 'Manage Students', href: '/agency/students', icon: 'Users' },
  { label: 'Deleted Students', href: '/agency/deleted-students', icon: 'UserMinus' },
  { label: 'Manage Booking', href: '/agency/bookings', icon: 'ClipboardList' },
  { label: 'View Booking', href: '/agency/view-bookings', icon: 'Eye' },
  { label: 'Completed Payments', href: '/agency/payments', icon: 'Wallet' },
  { label: 'Cancellations & Refunds', href: '/agency/refunds', icon: 'ReceiptText' },
  { label: 'Reviews', href: '/agency/reviews', icon: 'Star' },
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
  const [agency, app] = await Promise.all([getMyAgency(db), isAppRequest()]);

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

  // Native app: compact top bar + fixed bottom tab bar (with a "More" sheet for
  // the long tail of sections) instead of the desktop sidebar. Website keeps the
  // PanelSidebar shell below.
  if (app) {
    return (
      <div className="flex min-h-screen flex-col bg-muted/30">
        <header
          className="dark sticky top-0 z-20 border-b border-sidebar-border bg-sidebar/95 text-sidebar-foreground backdrop-blur-xl"
          style={{ paddingTop: 'env(safe-area-inset-top)' }}
        >
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <Logo href="/agency" />
            <ThemeToggle />
          </div>
        </header>
        <main className="flex-1 p-4 pb-28"><AutoRefresh />{children}</main>
        <AgencyBottomNav />
      </div>
    );
  }

  return (
    <PanelSidebar items={ITEMS} homeHref="/agency" greeting={`Hi, ${agency.name}`}>
      {children}
    </PanelSidebar>
  );
}
