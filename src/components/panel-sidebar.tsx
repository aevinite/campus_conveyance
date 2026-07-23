'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useFormStatus } from 'react-dom';
import { useModalFocusTrap } from '@/lib/use-modal-focus-trap';
import {
  LogOut,
  Loader2,
  Menu,
  X,
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

/** The nav link list + logout, shared by the desktop rail and the mobile drawer. */
function SidebarNav({
  items,
  pathname,
  homeHref,
  onNavigate,
}: {
  items: SidebarItem[];
  pathname: string;
  homeHref: string;
  onNavigate?: () => void;
}) {
  return (
    <>
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
              onClick={onNavigate}
              className={cn(
                'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all',
                active
                  ? 'bg-sidebar-accent font-semibold text-sidebar-accent-foreground shadow-xs'
                  : 'font-medium text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground',
              )}
            >
              {active && (
                <span className="brand-gradient absolute inset-y-1.5 left-0 w-1 rounded-full" />
              )}
              <Icon className={cn('size-4 shrink-0 transition-colors', active && 'text-primary')} />
              {it.label}
            </Link>
          );
        })}
      </nav>
      <form action={logoutAction} className="border-t border-sidebar-border p-3">
        <LogoutButton />
      </form>
    </>
  );
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
  const [open, setOpen] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  useModalFocusTrap(open, drawerRef, () => setOpen(false));

  // Close the mobile drawer whenever navigation happens.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen(false);
  }, [pathname]);

  return (
    <div className="flex min-h-screen bg-muted/30">
      {/* Desktop rail */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
        <div className="flex items-center justify-between gap-2 px-5 py-5">
          <Logo href={homeHref} />
          <ThemeToggle className="size-8" />
        </div>
        {greeting && (
          <p className="truncate px-5 pb-4 text-xs text-muted-foreground">{greeting}</p>
        )}
        <SidebarNav items={items} pathname={pathname} homeHref={homeHref} />
      </aside>

      {/* Right column: mobile top bar + main content */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-sidebar-border bg-sidebar/95 px-4 py-3 backdrop-blur md:hidden">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            className="grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground"
          >
            <Menu className="size-5" />
          </button>
          <Logo href={homeHref} />
          <ThemeToggle className="size-8" />
        </header>
        <main className="min-w-0 flex-1 overflow-x-auto p-4 sm:p-6 lg:p-8">{children}</main>
      </div>

      {/* Mobile slide-over drawer */}
      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/50"
            onMouseDown={() => setOpen(false)}
            aria-hidden
          />
          <aside
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            tabIndex={-1}
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col border-r border-sidebar-border bg-sidebar shadow-xl outline-none"
          >
            <div className="flex items-center justify-between gap-2 px-5 py-5">
              <Logo href={homeHref} />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground"
              >
                <X className="size-5" />
              </button>
            </div>
            {greeting && (
              <p className="truncate px-5 pb-4 text-xs text-muted-foreground">{greeting}</p>
            )}
            <SidebarNav
              items={items}
              pathname={pathname}
              homeHref={homeHref}
              onNavigate={() => setOpen(false)}
            />
          </aside>
        </div>
      )}
    </div>
  );
}
