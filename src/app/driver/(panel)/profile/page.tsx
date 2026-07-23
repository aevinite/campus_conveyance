import { BadgeCheck, CircleDashed, IdCard, ShieldCheck, UserRound } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getDriverProfile } from '@/features/driver/repository';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChangePasswordForm } from '@/components/profile/change-password-form';
import { EditProfileForm } from '@/components/profile/edit-profile-form';
import { cn } from '@/lib/utils';

export default async function DriverProfilePage() {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  const me = await getDriverProfile(db);

  const name = me?.name ?? '';
  const email = me?.email ?? user?.email ?? '—';
  const phone = me?.phone ?? '';
  const initials =
    name ? name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase() : 'D';

  const info: { label: string; value: string }[] = [
    { label: 'Role', value: 'Driver' },
    { label: 'Service provider', value: me?.agency_name ?? '—' },
    { label: 'Licence number', value: me?.license_no ?? '—' },
  ];
  const isActive = Boolean(me?.is_active);
  const emailVerified = Boolean(user?.email_confirmed_at);

  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <p className="text-xs font-semibold tracking-wider text-primary uppercase">Account</p>
        <h1 className="text-2xl font-heading font-bold tracking-tight sm:text-3xl">Profile</h1>
        <p className="text-muted-foreground">Your account details and password.</p>
      </div>

      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-6 text-center sm:flex-row sm:text-left">
          <span className="flex size-16 shrink-0 items-center justify-center rounded-full bg-primary/15 text-lg font-bold text-primary ring-4 ring-primary/5">
            {initials}
          </span>
          <div className="min-w-0 space-y-2">
            <div>
              <p className="truncate text-lg font-semibold">{name || '—'}</p>
              <p className="truncate text-sm text-muted-foreground">
                {email} · Driver{me?.agency_name ? ` · ${me.agency_name}` : ''}
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2 sm:justify-start">
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold',
                  isActive
                    ? 'bg-[color:var(--success)]/12 text-[color:var(--success)]'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                <ShieldCheck className="size-3.5" /> {isActive ? 'Active' : 'Inactive'}
              </span>
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold',
                  emailVerified
                    ? 'bg-[color:var(--success)]/12 text-[color:var(--success)]'
                    : 'bg-[color:var(--warning)]/12 text-[color:var(--warning)]',
                )}
              >
                {emailVerified ? (
                  <BadgeCheck className="size-3.5" />
                ) : (
                  <CircleDashed className="size-3.5" />
                )}
                {emailVerified ? 'Email verified' : 'Email not verified'}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserRound className="size-4 text-primary" /> Edit profile
            </CardTitle>
            <p className="text-sm text-muted-foreground">Update your name and phone number.</p>
          </CardHeader>
          <CardContent>
            <EditProfileForm fullName={name} phone={phone} email={email} />
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-primary" /> Change password
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Enter your current password, then your new password twice to confirm.
            </p>
          </CardHeader>
          <CardContent>
            <ChangePasswordForm />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <IdCard className="size-4 text-primary" /> Account information
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-8 gap-y-1 sm:grid-cols-2">
            {info.map((d) => (
              <div key={d.label} className="flex items-center justify-between gap-4 border-b border-border/60 py-2.5">
                <dt className="text-sm text-muted-foreground">{d.label}</dt>
                <dd className="truncate text-right text-sm font-medium">{d.value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </section>
  );
}
