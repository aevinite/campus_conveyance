'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  BusFront,
  Users,
  UserCircle,
  Route,
  Milestone,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard,
  BusFront,
  Users,
  UserCircle,
  Route,
  Milestone,
};

export type DriverNavItem = { href: string; label: string; icon: string };

/**
 * Fixed bottom tab bar for the driver panel inside the native app — the
 * app-native replacement for the desktop sidebar. Items are built in the layout
 * (the driving-today set swaps My Buses for the live Live/Stops tabs). Mirrors
 * the student/parent AppBottomNav (safe-area padding, active-by-prefix).
 */
export function DriverBottomNav({ items }: { items: DriverNavItem[] }) {
  const pathname = usePathname();
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 backdrop-blur-xl"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul
        className="mx-auto grid max-w-md"
        style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
      >
        {items.map(({ href, label, icon }) => {
          const Icon = ICONS[icon] ?? LayoutDashboard;
          // /driver (home) matches exactly; deeper tabs match by prefix.
          const active = href === '/driver' ? pathname === href : pathname.startsWith(href);
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
      </ul>
    </nav>
  );
}
