'use client';
import { useTransition } from 'react';
import Link from 'next/link';
import { User, Ticket, Settings, LogOut } from 'lucide-react';
import { logoutAction } from '@/features/auth/actions';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

// Per-role menu targets — the menu previously hardcoded the STUDENT paths for
// everyone, so an agency/driver/admin got links into /student/* that bounced off
// the role guard. `bookings` is only meaningful for riders.
const MENU: Record<string, { profile: string; settings: string; bookings?: string }> = {
  STUDENT: { profile: '/student/profile', settings: '/student/profile', bookings: '/student/bookings' },
  PARENT: { profile: '/parent/profile', settings: '/parent/profile' },
  AGENCY: { profile: '/agency/account', settings: '/agency/settings' },
  DRIVER: { profile: '/driver/profile', settings: '/driver/profile' },
  INSTITUTION_ADMIN: { profile: '/institution', settings: '/institution' },
  SUPER_ADMIN: { profile: '/aevinite/profile', settings: '/aevinite/settings' },
};

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'U';
  return parts
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
}

export function UserMenu({
  name,
  email,
  role,
}: {
  name: string;
  email: string;
  role: string;
}) {
  const [pending, startTransition] = useTransition();
  const display = name || 'Your account';
  const links = MENU[role] ?? MENU.STUDENT;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        // On mobile it's a clean, symmetric circle (just the avatar); on wider
        // screens it expands into a pill with the first name. Keeping the padding
        // even on mobile stops the avatar looking off-centre inside the ring.
        className="flex items-center gap-2 rounded-full border border-border bg-background/60 p-1 text-sm font-medium transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none data-[popup-open]:bg-secondary sm:pr-2.5"
        aria-label="Open profile menu"
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/20 text-xs font-semibold text-primary">
          {initialsOf(display)}
        </span>
        <span className="hidden max-w-[8rem] truncate sm:inline">
          {display.split(' ')[0]}
        </span>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" sideOffset={8} className="w-64">
        <div className="flex items-center gap-3 px-2 py-2.5">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/15 text-sm font-semibold text-primary">
            {initialsOf(display)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{display}</p>
            <p className="truncate text-xs text-muted-foreground">{email}</p>
            <span className="mt-1 inline-block rounded-full border border-border bg-secondary px-2 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
              {role}
            </span>
          </div>
        </div>

        <DropdownMenuSeparator />

        <DropdownMenuItem render={<Link href={links.profile} />}>
          <User />
          Profile
        </DropdownMenuItem>
        {links.bookings && (
          <DropdownMenuItem render={<Link href={links.bookings} />}>
            <Ticket />
            My bookings
          </DropdownMenuItem>
        )}
        <DropdownMenuItem render={<Link href={links.settings} />}>
          <Settings />
          Settings
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          variant="destructive"
          disabled={pending}
          // Keep the menu from closing before the transition kicks off, then run
          // the server action (which redirects to /login).
          onClick={() => startTransition(() => logoutAction())}
        >
          <LogOut />
          {pending ? 'Logging out…' : 'Log out'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
