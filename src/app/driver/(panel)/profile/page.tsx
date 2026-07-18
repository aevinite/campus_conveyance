import { createClient } from '@/lib/supabase/server';
import { getDriverProfile } from '@/features/driver/repository';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChangePasswordForm } from '@/components/profile/change-password-form';
import { EditProfileForm } from '@/components/profile/edit-profile-form';

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
    { label: 'Status', value: me?.is_active ? 'Active' : 'Inactive' },
    { label: 'Email status', value: user?.email_confirmed_at ? 'Verified ✓' : 'Not verified' },
  ];

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Profile</h1>
        <p className="text-muted-foreground">Your account details and password.</p>
      </div>

      <div className="flex items-center gap-4 rounded-xl border border-border bg-card/40 p-4">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary/15 text-lg font-semibold text-primary">
          {initials}
        </span>
        <div className="min-w-0">
          <p className="truncate text-lg font-medium">{name || '—'}</p>
          <p className="truncate text-sm text-muted-foreground">
            {email} · Driver{me?.agency_name ? ` · ${me.agency_name}` : ''}
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Edit profile</CardTitle>
            <p className="text-sm text-muted-foreground">Update your name and phone number.</p>
          </CardHeader>
          <CardContent>
            <EditProfileForm fullName={name} phone={phone} email={email} />
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Change password</CardTitle>
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
          <CardTitle>Account information</CardTitle>
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
