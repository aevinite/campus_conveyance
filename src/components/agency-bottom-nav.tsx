'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  ClipboardList,
  Users,
  BusFront,
  Menu,
  Route,
  Bus,
  MapPlus,
  IdCard,
  Eye,
  Star,
  UserMinus,
  Trash2,
  UserCircle,
  Settings,
  LogOut,
  type LucideIcon,
} from 'lucide-react';
import { logoutAction } from '@/features/auth/actions';
import { cn } from '@/lib/utils';

type Item = { href: string; label: string; Icon: LucideIcon };

// Four daily-use tabs; everything else lives behind the "More" sheet.
const TABS: Item[] = [
  { href: '/agency', label: 'Home', Icon: LayoutDashboard },
  { href: '/agency/bookings', label: 'Bookings', Icon: ClipboardList },
  { href: '/agency/students', label: 'Students', Icon: Users },
  { href: '/agency/buses', label: 'Buses', Icon: BusFront },
];

const MORE: Item[] = [
  { href: '/agency/routes', label: 'Routes', Icon: Route },
  { href: '/agency/add-bus', label: 'Add Bus', Icon: Bus },
  { href: '/agency/add-route', label: 'Add Route', Icon: MapPlus },
  { href: '/agency/drivers', label: 'Drivers', Icon: IdCard },
  { href: '/agency/view-bookings', label: 'View Booking', Icon: Eye },
  { href: '/agency/reviews', label: 'Reviews', Icon: Star },
  { href: '/agency/deleted-students', label: 'Deleted Students', Icon: UserMinus },
  { href: '/agency/deleted-drivers', label: 'Deleted Drivers', Icon: Trash2 },
  { href: '/agency/account', label: 'Profile', Icon: UserCircle },
  { href: '/agency/settings', label: 'Settings', Icon: Settings },
];

/**
 * Fixed bottom tab bar for the agency panel inside the native app — the
 * app-native replacement for the desktop sidebar. Four primary tabs plus a
 * "More" sheet that lists the remaining sections and a log-out button (the panel
 * has 14 sections, too many for a bar). Mirrors DriverBottomNav.
 */
export function AgencyBottomNav() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreActive = MORE.some((m) => pathname.startsWith(m.href));

  return (
    <>
      {moreOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-xs"
          onClick={() => setMoreOpen(false)}
        >
          <div
            className="absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-border bg-card p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-border" />
            <div className="grid grid-cols-3 gap-3">
              {MORE.map(({ href, label, Icon }) => {
                const active = pathname.startsWith(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setMoreOpen(false)}
                    className={cn(
                      'flex flex-col items-center gap-1.5 rounded-xl border p-3 text-center transition-colors',
                      active
                        ? 'border-primary/40 bg-primary/[0.06] text-primary'
                        : 'border-border bg-background/50 text-foreground',
                    )}
                  >
                    <Icon className={cn('size-5', active ? 'text-primary' : 'text-primary/80')} />
                    <span className="text-[11px] font-medium leading-tight">{label}</span>
                  </Link>
                );
              })}
            </div>
            <form action={logoutAction} className="mt-3">
              <button
                type="submit"
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 py-3 text-sm font-semibold text-destructive"
              >
                <LogOut className="size-4" /> Log out
              </button>
            </form>
          </div>
        </div>
      )}

      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 backdrop-blur-xl"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <ul className="mx-auto grid max-w-md grid-cols-5">
          {TABS.map(({ href, label, Icon }) => {
            const active = href === '/agency' ? pathname === href : pathname.startsWith(href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  className={cn(
                    'flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors',
                    active ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Icon className={cn('size-5', active && 'fill-primary/15')} />
                  {label}
                </Link>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              aria-expanded={moreOpen}
              className={cn(
                'flex w-full flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors',
                moreActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Menu className="size-5" />
              More
            </button>
          </li>
        </ul>
      </nav>
    </>
  );
}
