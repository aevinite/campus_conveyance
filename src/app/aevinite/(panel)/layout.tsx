import { requireRole } from '@/features/auth/guard';
import { createClient } from '@/lib/supabase/server';
import { getSessionClaims } from '@/features/auth/session';
import { listNotifications, unreadNotificationCount } from '@/features/notifications/repository';
import { AdminShell, type AdminNavGroup } from '@/components/admin/admin-shell';

// Grouped nav — mirrors the reference's OPERATE / MANAGE / … sections while
// keeping every existing admin destination. Icons are referenced by name and
// resolved on the client inside AdminShell.
const GROUPS: AdminNavGroup[] = [
  {
    heading: 'Operate',
    items: [
      { label: 'Dashboard', href: '/aevinite', icon: 'LayoutDashboard' },
      { label: 'Live Rides', href: '/aevinite/live', icon: 'Radio' },
      { label: 'Bookings', href: '/aevinite/bookings', icon: 'Ticket' },
      { label: 'Payments', href: '/aevinite/payments', icon: 'Wallet' },
      { label: 'Buses & Vans', href: '/aevinite/fleet', icon: 'Bus' },
      { label: 'Routes & Stops', href: '/aevinite/routes', icon: 'Route' },
      { label: 'Drivers', href: '/aevinite/drivers', icon: 'IdCard' },
      { label: 'Parents', href: '/aevinite/parents', icon: 'UsersRound' },
    ],
  },
  {
    heading: 'Manage',
    items: [
      { label: 'Students', href: '/aevinite/students', icon: 'Users' },
      { label: 'Service Providers', href: '/aevinite/providers', icon: 'Building2' },
      { label: 'Colleges & Schools', href: '/aevinite/colleges', icon: 'School' },
      { label: 'Add College', href: '/aevinite/add-college', icon: 'PlusCircle' },
      { label: 'Provider Requests', href: '/aevinite/requests', icon: 'Inbox' },
      { label: 'Service Area Requests', href: '/aevinite/service-requests', icon: 'ClipboardList' },
      { label: 'Agency Reviews', href: '/aevinite/reviews', icon: 'Star' },
      { label: 'Contact Inquiries', href: '/aevinite/inquiries', icon: 'Mail' },
      { label: 'Notifications', href: '/aevinite/notifications', icon: 'Bell' },
    ],
  },
  {
    heading: 'Recycle bin',
    items: [
      { label: 'Deleted Students', href: '/aevinite/deleted-students', icon: 'UserMinus' },
      { label: 'Deleted Providers', href: '/aevinite/deleted-providers', icon: 'Building' },
      { label: 'Deleted Colleges', href: '/aevinite/deleted-colleges', icon: 'Trash2' },
    ],
  },
  {
    heading: 'Platform',
    items: [
      { label: 'Activity Log', href: '/aevinite/audit', icon: 'History' },
      { label: 'Profile', href: '/aevinite/profile', icon: 'UserCircle' },
      { label: 'Settings', href: '/aevinite/settings', icon: 'Settings' },
    ],
  },
];

export default async function AdminPanelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireRole('SUPER_ADMIN', '/aevinite/login');
  const db = await createClient();
  const { userId } = await getSessionClaims(db);
  const [notifications, unread] = await Promise.all([
    listNotifications(db),
    unreadNotificationCount(db),
  ]);

  return (
    <AdminShell
      groups={GROUPS}
      homeHref="/aevinite"
      footer="Campus Conveyance · Transit OS"
      notifications={notifications}
      unread={unread}
      userId={userId}
    >
      {children}
    </AdminShell>
  );
}
