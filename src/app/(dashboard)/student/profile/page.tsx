import Link from 'next/link';
import { ArrowLeft, Mail, Phone, ShieldCheck, CalendarDays } from 'lucide-react';
import { requireRole } from '@/features/auth/guard';
import { createClient } from '@/lib/supabase/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EditProfileForm } from '@/components/profile/edit-profile-form';
import { ChangePasswordForm } from '@/components/profile/change-password-form';
import { ParentAccessCard } from './parent-access-card';

const fmtDate = (v?: string | null) =>
  v ? new Date(v).toLocaleDateString('en-IN', { dateStyle: 'long' }) : '—';
const fmtDateTime = (v?: string | null) =>
  v ? new Date(v).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'Never';

export default async function StudentProfilePage() {
  await requireRole('STUDENT');
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();

  const { data: profile } = user
    ? await db
        .from('profiles')
        .select('full_name, phone, created_at, updated_at')
        .eq('id', user.id)
        .single()
    : { data: null };

  const fullName =
    profile?.full_name ??
    (user?.user_metadata as { full_name?: string } | undefined)?.full_name ??
    '';
  const email = user?.email ?? '—';
  const phone = profile?.phone ?? '';
  const display = fullName || 'Your account';
  const initials = display
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p: string) => p[0])
    .join('')
    .toUpperCase();

  const info: { label: string; value: string; icon: typeof Mail }[] = [
    { label: 'Email', value: email, icon: Mail },
    { label: 'Phone', value: phone || 'Not added', icon: Phone },
    {
      label: 'Email status',
      value: user?.email_confirmed_at ? 'Verified' : 'Not verified',
      icon: ShieldCheck,
    },
    { label: 'Member since', value: fmtDate(profile?.created_at), icon: CalendarDays },
    { label: 'Last signed in', value: fmtDateTime(user?.last_sign_in_at), icon: CalendarDays },
  ];

  return (
    <section className="space-y-8">
      <div>
        <Link
          href="/student"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to dashboard
        </Link>
        <h1 className="mt-3 text-2xl font-semibold">Profile &amp; settings</h1>
        <p className="text-muted-foreground">
          Manage your account details, contact info, and password.
        </p>
      </div>

      {/* Identity banner */}
      <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-6 shadow-xs">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              'radial-gradient(70% 120% at 100% 0%, color-mix(in oklch, var(--primary) 16%, transparent), transparent 60%)',
          }}
        />
        <div className="flex items-center gap-4">
          <span className="grid size-16 shrink-0 place-items-center rounded-full bg-primary/15 text-xl font-semibold text-primary">
            {initials || 'U'}
          </span>
          <div className="min-w-0">
            <p className="truncate text-xl font-semibold">{display}</p>
            <p className="truncate text-sm text-muted-foreground">{email}</p>
            <span className="mt-1.5 inline-block rounded-full border border-border bg-secondary px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
              Student
            </span>
          </div>
        </div>
      </div>

      {/* Account details (read-only quick view) */}
      <Card>
        <CardHeader>
          <CardTitle>Account information</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-8 gap-y-1 sm:grid-cols-2">
            {info.map((d) => (
              <div
                key={d.label}
                className="flex items-center justify-between gap-4 border-b border-border/60 py-3 last:border-b-0 sm:[&:nth-last-child(2)]:border-b-0"
              >
                <dt className="flex items-center gap-2 text-sm text-muted-foreground">
                  <d.icon className="size-4" />
                  {d.label}
                </dt>
                <dd className="truncate text-right text-sm font-medium">{d.value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      {/* Parent access */}
      <Card>
        <CardHeader>
          <CardTitle>Parent access</CardTitle>
          <p className="text-sm text-muted-foreground">
            Let a parent follow your trips by linking their account with a
            one-time code.
          </p>
        </CardHeader>
        <CardContent>
          <ParentAccessCard />
        </CardContent>
      </Card>

      {/* Editable sections */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Edit profile</CardTitle>
            <p className="text-sm text-muted-foreground">Update your name and phone number.</p>
          </CardHeader>
          <CardContent>
            <EditProfileForm fullName={fullName} phone={phone} email={email} />
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
    </section>
  );
}
