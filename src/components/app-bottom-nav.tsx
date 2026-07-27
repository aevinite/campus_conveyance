'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Compass, Ticket, User, History, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

type Item = { href: string; label: string; icon: LucideIcon };

// Tab sets per role. The role root (Home) is matched exactly; every other tab is
// matched by prefix so sub-pages (e.g. /student/schools/[id]) keep it active.
const NAV: Record<'STUDENT' | 'PARENT', Item[]> = {
  STUDENT: [
    { href: '/student', label: 'Home', icon: Home },
    { href: '/student/schools', label: 'Browse', icon: Compass },
    { href: '/student/bookings', label: 'Bookings', icon: Ticket },
    { href: '/student/profile', label: 'Profile', icon: User },
  ],
  PARENT: [
    { href: '/parent', label: 'Home', icon: Home },
    { href: '/parent/history', label: 'History', icon: History },
    { href: '/parent/profile', label: 'Profile', icon: User },
  ],
};

/**
 * Fixed bottom tab bar shown only inside the native app for the user/parent
 * dashboard, giving it a native app feel. The dashboard layout adds bottom
 * padding so page content is never hidden behind it.
 */
export function AppBottomNav({ role }: { role: 'STUDENT' | 'PARENT' }) {
  const pathname = usePathname();
  const items = NAV[role];
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 backdrop-blur-xl"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="mx-auto grid max-w-md grid-cols-4" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map(({ href, label, icon: Icon }) => {
          const active = href === `/${role.toLowerCase()}` ? pathname === href : pathname.startsWith(href);
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
