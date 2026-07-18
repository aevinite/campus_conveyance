import { createClient } from '@/lib/supabase/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChangePasswordForm } from '@/components/profile/change-password-form';
import { EditProfileForm } from '@/components/profile/edit-profile-form';

const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  INSTITUTION_ADMIN: 'Institution Admin',
  STUDENT: 'Student',
  PARENT: 'Parent',
  DRIVER: 'Driver',
  AGENCY: 'Agency',
};

const fmtDate = (v?: string | null) =>
  v ? new Date(v).toLocaleDateString('en-IN', { dateStyle: 'long' }) : '—';
const fmtDateTime = (v?: string | null) =>
  v ? new Date(v).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'Never';

export default async function AdminProfilePage() {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();

  const { data: profile } = user
    ? await db.from('profiles').select('full_name, phone, role, created_at, updated_at').eq('id', user.id).single()
    : { data: null };

  const fullName =
    profile?.full_name ??
    (user?.user_metadata as { full_name?: string } | undefined)?.full_name ??
    '';
  const email = user?.email ?? '—';
  const phone = profile?.phone ?? '';
  const role = profile?.role ? (ROLE_LABEL[profile.role] ?? profile.role) : '—';

  const info: { label: string; value: string; mono?: boolean }[] = [
    { label: 'Role', value: role },
    { label: 'Account ID', value: user?.id ?? '—', mono: true },
    { label: 'Email status', value: user?.email_confirmed_at ? 'Verified ✓' : 'Not verified' },
    { label: 'Member since', value: fmtDate(profile?.created_at) },
    { label: 'Last signed in', value: fmtDateTime(user?.last_sign_in_at) },
    { label: 'Profile last updated', value: fmtDateTime(profile?.updated_at) },
  ];

  const display = fullName || '—';
  const initials =
    display !== '—'
      ? display.split(' ').map((p: string) => p[0]).slice(0, 2).join('').toUpperCase()
      : 'A';

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Profile</h1>
        <p className="text-muted-foreground">Your account details, information, and password.</p>
      </div>

      <div className="flex items-center gap-4 rounded-xl border border-border bg-card/40 p-4">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary/15 text-lg font-semibold text-primary">
          {initials}
        </span>
        <div className="min-w-0">
          <p className="truncate text-lg font-medium">{display}</p>
          <p className="truncate text-sm text-muted-foreground">
            {email} · {role}
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Edit profile */}
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Edit profile</CardTitle>
            <p className="text-sm text-muted-foreground">Update your name and phone number.</p>
          </CardHeader>
          <CardContent>
            <EditProfileForm fullName={fullName} phone={phone} email={email} />
          </CardContent>
        </Card>

        {/* Change password */}
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

      {/* Account information (read-only) */}
      <Card>
        <CardHeader>
          <CardTitle>Account information</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-8 gap-y-1 sm:grid-cols-2">
            {info.map((d) => (
              <div key={d.label} className="flex items-center justify-between gap-4 border-b border-border/60 py-2.5">
                <dt className="text-sm text-muted-foreground">{d.label}</dt>
                <dd className={`truncate text-right text-sm font-medium ${d.mono ? 'font-mono text-xs' : ''}`}>
                  {d.value}
                </dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </section>
  );
}
