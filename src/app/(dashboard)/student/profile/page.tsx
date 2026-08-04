import Link from 'next/link';
import {
  ArrowLeft,
  Mail,
  Phone,
  ShieldCheck,
  CalendarDays,
  Clock3,
  LogOut,
  CheckCircle2,
  UserRound,
  KeyRound,
  Users,
  LifeBuoy,
  ArrowRight,
} from 'lucide-react';
import { requireRole } from '@/features/auth/guard';
import { createClient } from '@/lib/supabase/server';
import { isAppRequest } from '@/lib/app-context';
import { logoutAction } from '@/features/auth/actions';
import { SubmitButton } from '@/components/submit-button';
import { EditProfileForm } from '@/components/profile/edit-profile-form';
import { ChangePasswordForm } from '@/components/profile/change-password-form';
import { ParentAccessCard } from './parent-access-card';
import { formatDate } from '@/lib/format-date';

const fmtDate = (v?: string | null) => formatDate(v);

export default async function StudentProfilePage() {
  await requireRole('STUDENT');
  const app = await isAppRequest();
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

  const verified = Boolean(user?.email_confirmed_at);
  const memberSince = fmtDate(profile?.created_at);

  // Read-only account facts, shown as tidy info tiles below the hero.
  const info: { label: string; value: string; icon: typeof Mail }[] = [
    { label: 'Email', value: email, icon: Mail },
    { label: 'Phone', value: phone || 'Not added', icon: Phone },
    { label: 'Member since', value: memberSince, icon: CalendarDays },
  ];

  return (
    <section className="space-y-8">
      <div>
        {!app && (
          <Link
            href="/student"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Back to dashboard
          </Link>
        )}
        <h1 className={`${app ? '' : 'mt-3'} text-2xl font-bold tracking-tight sm:text-3xl`}>
          Profile &amp; settings
        </h1>
        {!app && (
          <p className="mt-1 text-muted-foreground">
            Manage your account details, contact info, and password.
          </p>
        )}
      </div>

      {/* ── Dark "ink" identity hero: gold glow + road-lane texture, fixed dark
          surface so it reads the same premium way in light and dark mode. ── */}
      <div
        className="relative overflow-hidden rounded-3xl border border-white/10 p-6 text-white shadow-lg sm:p-8"
        style={{ background: 'linear-gradient(135deg, oklch(0.24 0.02 74), oklch(0.16 0.015 68))' }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(62% 120% at 100% 0%, color-mix(in oklch, var(--primary) 42%, transparent), transparent 60%)',
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              'repeating-linear-gradient(-45deg, rgba(255,255,255,0.045) 0 1px, transparent 1px 14px)',
          }}
        />

        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center">
          <span className="grid size-20 shrink-0 place-items-center rounded-2xl bg-primary text-2xl font-bold text-primary-foreground shadow-md ring-4 ring-primary/20">
            {initials || 'U'}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-heading text-2xl font-bold tracking-tight sm:text-3xl">
              {display}
            </h2>
            <p className="mt-0.5 flex items-center gap-1.5 truncate text-sm text-white/70">
              <Mail className="size-3.5 shrink-0" /> {email}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-semibold text-white ring-1 ring-inset ring-white/15">
                <UserRound className="size-3.5" /> Student
              </span>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${
                  verified
                    ? 'bg-success/20 text-success ring-success/30'
                    : 'bg-warning/20 text-warning ring-warning/30'
                }`}
              >
                {verified ? <CheckCircle2 className="size-3.5" /> : <ShieldCheck className="size-3.5" />}
                {verified ? 'Verified' : 'Not verified'}
              </span>
            </div>
          </div>
        </div>

        {/* Quick facts strip */}
        <div className="relative mt-6 grid grid-cols-2 gap-3 border-t border-white/10 pt-5">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-white/50">Member since</p>
            <p className="tnum mt-0.5 text-sm font-semibold">{memberSince}</p>
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-white/50">Phone</p>
            <p className="tnum mt-0.5 truncate text-sm font-semibold">{phone || 'Not added'}</p>
          </div>
        </div>
      </div>

      {/* ── Account information — icon-chip info tiles ── */}
      <div className="space-y-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">Account</p>
          <h3 className="mt-1 text-lg font-bold tracking-tight">Account information</h3>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {info.map((d) => (
            <div
              key={d.label}
              className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                <d.icon className="size-[1.125rem]" />
              </span>
              <div className="min-w-0">
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  {d.label}
                </p>
                <p className="tnum mt-0.5 truncate text-sm font-semibold">{d.value}</p>
              </div>
            </div>
          ))}
          {/* Email verification status as its own tile with a colored pill. */}
          <div className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <ShieldCheck className="size-[1.125rem]" />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Email status
              </p>
              <span
                className={`mt-1 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                  verified
                    ? 'bg-success/10 text-success ring-1 ring-inset ring-success/25'
                    : 'bg-warning/10 text-warning ring-1 ring-inset ring-warning/25'
                }`}
              >
                {verified ? <CheckCircle2 className="size-3.5" /> : <Clock3 className="size-3.5" />}
                {verified ? 'Verified' : 'Not verified'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Parent access ── */}
      <div className="space-y-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">Family</p>
          <h3 className="mt-1 flex items-center gap-2 text-lg font-bold tracking-tight">
            <Users className="size-[1.125rem] text-primary" /> Parent access
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Let a parent follow your daily commute by linking their account with a one-time code.
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
          <ParentAccessCard />
        </div>
      </div>

      {/* ── Settings: edit profile + change password ── */}
      <div className="space-y-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">Settings</p>
          <h3 className="mt-1 text-lg font-bold tracking-tight">Account settings</h3>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="h-fit rounded-2xl border border-border bg-card p-5 sm:p-6">
            <div className="mb-4 flex items-center gap-2.5">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                <UserRound className="size-[1.125rem]" />
              </span>
              <div>
                <p className="font-semibold leading-tight">Edit profile</p>
                <p className="text-xs text-muted-foreground">Update your name and phone number.</p>
              </div>
            </div>
            <EditProfileForm fullName={fullName} phone={phone} email={email} />
          </div>

          <div className="h-fit rounded-2xl border border-border bg-card p-5 sm:p-6">
            <div className="mb-4 flex items-center gap-2.5">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                <KeyRound className="size-[1.125rem]" />
              </span>
              <div>
                <p className="font-semibold leading-tight">Change password</p>
                <p className="text-xs text-muted-foreground">
                  Enter your current password, then a new one twice.
                </p>
              </div>
            </div>
            <ChangePasswordForm />
          </div>
        </div>
      </div>

      {/* Help & Support — always reachable from the profile. */}
      <Link
        href="/student/help"
        className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 transition-colors hover:border-primary/40"
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <LifeBuoy className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Help &amp; Support</span>
          <span className="block text-xs text-muted-foreground">FAQs and a direct line to our team.</span>
        </span>
        <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
      </Link>

      {/* Log out — pinned at the bottom of the profile inside the app. */}
      {app && (
        <form action={logoutAction} className="pt-2">
          <SubmitButton variant="destructive" className="w-full gap-2" pendingText="Logging out…">
            <LogOut className="size-4" />
            Log out
          </SubmitButton>
        </form>
      )}
    </section>
  );
}
