import { requireRole } from '@/features/auth/guard';
import { PanelSidebar, type SidebarItem } from '@/components/panel-sidebar';

const ITEMS: SidebarItem[] = [
  { label: 'Dashboard', href: '/aevinite', icon: 'LayoutDashboard' },
  // Operations — full read-only visibility into the live platform.
  { label: 'Buses & Vans', href: '/aevinite/fleet', icon: 'Bus' },
  { label: 'Routes & Stops', href: '/aevinite/routes', icon: 'Route' },
  { label: 'Bookings', href: '/aevinite/bookings', icon: 'Ticket' },
  { label: 'Payments', href: '/aevinite/payments', icon: 'Wallet' },
  { label: 'Payment History', href: '/aevinite/payments/history', icon: 'ReceiptText' },
  { label: 'Live Rides', href: '/aevinite/live', icon: 'Radio' },
  { label: 'Drivers', href: '/aevinite/drivers', icon: 'IdCard' },
  { label: 'Parents', href: '/aevinite/parents', icon: 'UsersRound' },
  { label: 'Notifications', href: '/aevinite/notifications', icon: 'Bell' },
  { label: 'Contact Inquiries', href: '/aevinite/inquiries', icon: 'Mail' },
  { label: 'Agency Reviews', href: '/aevinite/reviews', icon: 'Star' },
  // Marketplace governance.
  { label: 'Service Provider Requests', href: '/aevinite/requests', icon: 'Inbox' },
  { label: 'Service Area Requests', href: '/aevinite/service-requests', icon: 'ClipboardList' },
  { label: 'Manage Students', href: '/aevinite/students', icon: 'Users' },
  { label: 'Deleted Students', href: '/aevinite/deleted-students', icon: 'UserMinus' },
  { label: 'Manage Service Providers', href: '/aevinite/providers', icon: 'Building2' },
  { label: 'Deleted Service Providers', href: '/aevinite/deleted-providers', icon: 'Building' },
  { label: 'Add College', href: '/aevinite/add-college', icon: 'PlusCircle' },
  { label: 'Manage College', href: '/aevinite/colleges', icon: 'School' },
  { label: 'Deleted Colleges', href: '/aevinite/deleted-colleges', icon: 'Trash2' },
  { label: 'Activity Log', href: '/aevinite/audit', icon: 'History' },
  { label: 'Profile', href: '/aevinite/profile', icon: 'UserCircle' },
  { label: 'Settings', href: '/aevinite/settings', icon: 'Settings' },
];

export default async function AdminPanelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireRole('SUPER_ADMIN', '/aevinite/login');
  return (
    <PanelSidebar items={ITEMS} homeHref="/aevinite" greeting="Admin">
      {children}
    </PanelSidebar>
  );
}
