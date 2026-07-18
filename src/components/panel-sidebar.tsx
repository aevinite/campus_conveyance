'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useFormStatus } from 'react-dom';
import {
  LogOut,
  Loader2,
  LayoutDashboard,
  Inbox,
  Users,
  UserMinus,
  Building2,
  Building,
  PlusCircle,
  School,
  IdCard,
  ClipboardList,
  Eye,
  Bus,
  BusFront,
  MapPlus,
  Route,
  UserCircle,
  Settings,
  History,
  Trash2,
} from 'lucide-react';
import { Logo } from '@/components/brand';
import { ThemeToggle } from '@/components/theme-toggle';
import { logoutAction } from '@/features/auth/actions';
import { cn } from '@/lib/utils';

// Icon registry. A Server Component can't pass component functions across the
// server→client boundary, so layouts reference an icon by name (a string) and
// we resolve it to the actual Lucide component here on the client.
const ICONS = {
  LayoutDashboard,
  Inbox,
  Users,
  UserMinus,
  Building2,
  Building,
  PlusCircle,
  School,
  IdCard,
  ClipboardList,
  Eye,
  Bus,
  BusFront,
  MapPlus,
  Route,
  UserCircle,
  Settings,
  History,
  Trash2,
} as const;

export type SidebarIcon = keyof typeof ICONS;

function LogoutButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground disabled:opacity-50"
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
      {pending ? 'Logging out…' : 'Log out'}
    </button>
  );
}

export interface SidebarItem {
  label: string;
  href: string;
  icon: SidebarIcon;
}

export function PanelSidebar({
  items,
  greeting,
  homeHref,
  children,
}: {
  items: SidebarItem[];
  greeting?: string;
  homeHref: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  return (
    <div className="flex min-h-screen bg-muted/30">
      <aside className="sticky top-0 flex h-screen w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
        <div className="flex items-center justify-between gap-2 px-5 py-5">
          <Logo href={homeHref} />
          <ThemeToggle className="size-8" />
        </div>
        {greeting && (
          <p className="truncate px-5 pb-4 text-xs text-muted-foreground">{greeting}</p>
        )}
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3">
          {items.map((it) => {
            // Exact match for the dashboard root, prefix match for sub-pages.
            const active =
              pathname === it.href ||
              (it.href !== homeHref && pathname.startsWith(it.href + '/'));
            const Icon = ICONS[it.icon];
            return (
              <Link
                key={it.href}
                href={it.href}
                className={cn(
                  'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  active
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                    : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground',
                )}
              >
                {active && (
                  <span className="absolute inset-y-1.5 left-0 w-1 rounded-full bg-primary" />
                )}
                <Icon className={cn('size-4 shrink-0', active && 'text-primary')} />
                {it.label}
              </Link>
            );
          })}
        </nav>
        <form action={logoutAction} className="border-t border-sidebar-border p-3">
          <LogoutButton />
        </form>
      </aside>
      <main className="min-w-0 flex-1 overflow-x-auto p-6 lg:p-8">{children}</main>
    </div>
  );
}
