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
  Activity,
  LayoutDashboard,
  Radio,
  Ticket,
  Wallet,
  Bus,
  BusFront,
  Route,
  MapPlus,
  Milestone,
  IdCard,
  UsersRound,
  Users,
  UserMinus,
  Building2,
  Building,
  School,
  PlusCircle,
  Inbox,
  ClipboardList,
  Eye,
  Star,
  Mail,
  Bell,
  Trash2,
  ReceiptText,
  History,
  UserCircle,
  Settings,
} from 'lucide-react';
import { BrandMark } from '@/components/brand';
import { ThemeToggle } from '@/components/theme-toggle';
import { AutoRefresh } from '@/components/auto-refresh';
import { NotificationBell } from '@/components/notification-bell';
import { logoutAction } from '@/features/auth/actions';
import type { NotificationRow } from '@/features/notifications/repository';
import { cn } from '@/lib/utils';

// A Server Component can't pass component functions across the server→client
// boundary, so a layout references each icon by name (a string) and we resolve
// it to the Lucide component here on the client. This registry covers every
// panel (admin / agency / institution / driver).
const ICONS = {
  LayoutDashboard,
  Radio,
  Ticket,
  Wallet,
  Bus,
  BusFront,
  Route,
  MapPlus,
  Milestone,
  IdCard,
  UsersRound,
  Users,
  UserMinus,
  Building2,
  Building,
  School,
  PlusCircle,
  Inbox,
  ClipboardList,
  Eye,
  Star,
  Mail,
  Bell,
  Trash2,
  ReceiptText,
  History,
  UserCircle,
  Settings,
} as const;

export type PanelIcon = keyof typeof ICONS;

export interface PanelNavItem {
  label: string;
  href: string;
  icon: PanelIcon;
}

export interface PanelNavGroup {
  heading: string;
  items: PanelNavItem[];
}

function LogoutButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-label="Log out"
      title="Log out"
      className="grid size-9 place-items-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50"
    >
      {pending ? <Loader2 className="size-[18px] animate-spin" /> : <LogOut className="size-[18px]" />}
    </button>
  );
}

/** The grouped nav list, shared by the desktop rail and the mobile drawer. */
function PanelNav({
  groups,
  pathname,
  homeHref,
  onNavigate,
}: {
  groups: PanelNavGroup[];
  pathname: string;
  homeHref: string;
  onNavigate?: () => void;
}) {
  return (
    <nav className="scrollbar-slim flex-1 space-y-5 overflow-y-auto px-3 pb-4">
      {groups.map((group) => (
        <div key={group.heading}>
          <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/80">
            {group.heading}
          </p>
          <div className="space-y-0.5">
            {group.items.map((it) => {
              // Exact match for the home root, prefix match for sub-pages.
              const active =
                pathname === it.href ||
                (it.href !== homeHref && pathname.startsWith(it.href + '/'));
              const Icon = ICONS[it.icon];
              return (
                <Link
                  key={it.href}
                  href={it.href}
                  onClick={onNavigate}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-all',
                    active
                      ? 'bg-sidebar-accent font-semibold text-sidebar-accent-foreground'
                      : 'font-medium text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground',
                  )}
                >
                  {active && (
                    <span className="accent-bar absolute inset-y-1.5 left-0 w-1 rounded-full" />
                  )}
                  <Icon
                    className={cn('size-[18px] shrink-0 transition-colors', active && 'text-primary')}
                  />
                  <span className="truncate">{it.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

/** Brand block at the top of the rail — mark + product name + a role/org subtitle. */
function BrandBlock({ homeHref, subtitle }: { homeHref: string; subtitle: string }) {
  return (
    <Link href={homeHref} className="group flex items-center gap-3" aria-label="Campus Conveyance">
      <BrandMark className="size-10 shrink-0 rounded-[12px] shadow-sm transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-105" />
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate font-heading text-[15px] font-bold tracking-tight text-foreground">
          Campus Conveyance
        </span>
        <span className="truncate text-xs text-muted-foreground">{subtitle}</span>
      </span>
    </Link>
  );
}

/**
 * The shared panel chrome — a light, grouped desktop rail + a top bar (Live
 * chip, notifications, theme, logout) + a mobile slide-over drawer. Used by the
 * admin / agency / institution / driver desktop (website) panels so every role
 * gets the same look. Purely presentational apart from the notification data it
 * threads to the bell.
 */
export function PanelShell({
  groups,
  homeHref,
  subtitle,
  footer,
  notifications = [],
  unread = 0,
  userId,
  children,
}: {
  groups: PanelNavGroup[];
  homeHref: string;
  subtitle: string;
  footer?: string;
  notifications?: NotificationRow[];
  unread?: number;
  userId?: string | null;
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
      {/* Keep every panel live without a manual reload. */}
      <AutoRefresh />

      {/* Desktop rail — light, grouped. */}
      <aside className="sticky top-0 hidden h-screen w-72 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex">
        <div className="px-5 py-5">
          <BrandBlock homeHref={homeHref} subtitle={subtitle} />
        </div>
        <PanelNav groups={groups} pathname={pathname} homeHref={homeHref} />
        {footer && (
          <p className="border-t border-sidebar-border px-5 py-3.5 text-xs text-muted-foreground">
            {footer}
          </p>
        )}
      </aside>

      {/* Right column: top bar + main content. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-border bg-background/85 px-4 py-2.5 backdrop-blur sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-label="Open menu"
              className="grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden"
            >
              <Menu className="size-5" />
            </button>
            <Link href={homeHref} className="flex items-center gap-2 lg:hidden" aria-label="Campus Conveyance">
              <BrandMark className="size-8 shrink-0 rounded-[10px] shadow-sm" />
              <span className="truncate font-heading text-sm font-bold tracking-tight">{subtitle}</span>
            </Link>
            {/* Live status — the panel auto-refreshes; this mirrors the reference's
                "Live" chip so the operator knows the data is current. */}
            <span className="ml-1 hidden items-center gap-1.5 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1.5 text-xs font-semibold text-emerald-600 sm:inline-flex dark:text-emerald-400">
              <Activity className="size-3.5" />
              Live
            </span>
          </div>

          <div className="flex items-center gap-2">
            <NotificationBell items={notifications} unread={unread} userId={userId} />
            <ThemeToggle />
            <form action={logoutAction}>
              <LogoutButton />
            </form>
          </div>
        </header>

        <main className="min-w-0 flex-1 overflow-x-auto p-4 sm:p-6 lg:p-8">{children}</main>
      </div>

      {/* Mobile slide-over drawer. */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
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
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground shadow-xl outline-none"
          >
            <div className="flex items-center justify-between gap-2 px-5 py-5">
              <BrandBlock homeHref={homeHref} subtitle={subtitle} />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="size-5" />
              </button>
            </div>
            <PanelNav
              groups={groups}
              pathname={pathname}
              homeHref={homeHref}
              onNavigate={() => setOpen(false)}
            />
            {footer && (
              <p className="border-t border-sidebar-border px-5 py-3.5 text-xs text-muted-foreground">
                {footer}
              </p>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
