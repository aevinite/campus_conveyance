'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Users, Building2, ArrowRight } from 'lucide-react';
import { StudentLogin } from '@/components/auth/student-login';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Tab = 'user' | 'agency';

/**
 * App-only login entry: a User / Agency chooser (drivers/admins sign in from the
 * web). "User" shows the normal student/parent login; "Agency" links into the
 * existing agency sign-in and registration flows. Shown in place of the plain
 * login form when the request comes from inside the native app.
 */
export function AppLogin() {
  const [tab, setTab] = useState<Tab>('user');
  return (
    <div className="w-full max-w-sm space-y-5">
      <div className="grid grid-cols-2 gap-1 rounded-full border border-border bg-muted/60 p-1">
        <TabButton active={tab === 'user'} onClick={() => setTab('user')} icon={<Users className="size-4" />} label="User" />
        <TabButton active={tab === 'agency'} onClick={() => setTab('agency')} icon={<Building2 className="size-4" />} label="Agency" />
      </div>

      {tab === 'user' ? (
        <StudentLogin />
      ) : (
        <Card className="w-full shadow-lg">
          <CardHeader>
            <CardTitle className="text-2xl">Agency portal</CardTitle>
            <CardDescription>
              Sign in to manage your buses, routes and bookings — or register your agency.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Link href="/agency/login" className={cn(buttonVariants({ className: 'w-full gap-2' }))}>
              Agency sign in
              <ArrowRight className="size-4" />
            </Link>
            <Link
              href="/agency/register"
              className={cn(buttonVariants({ variant: 'outline', className: 'w-full' }))}
            >
              Register your agency
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex items-center justify-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-colors',
        active
          ? 'bg-primary text-primary-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {icon}
      {label}
    </button>
  );
}
