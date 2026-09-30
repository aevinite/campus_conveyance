import Link from 'next/link';
import {
  BadgeCheck,
  BusFront,
  CalendarClock,
  GraduationCap,
  Lock,
  Mail,
  MapPin,
  Phone,
  Route as RouteIcon,
  ShieldAlert,
  User,
  Users,
  Home,
  Hash,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Logo } from '@/components/brand';
import { computePass } from '@/lib/pass';
import { periodLabel, type BillingPeriod } from '@/lib/billing';
import { formatDateMedium } from '@/lib/format-date';

// Public scan target of a rider's QR pass (see RidePassQr + migration 0131).
// Anyone who scans sees the verification card; phones / address / parent
// contacts are returned by ride_pass() only to that booking's own staff.
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Ride pass', robots: { index: false, follow: false } };

interface PassData {
  student_name: string | null;
  college_name: string | null;
  route_name: string | null;
  bus_number: string | null;
  pickup_name: string | null;
  agency_name: string | null;
  status: string;
  refund_pending: boolean;
  billing_period: string | null;
  pass_start: string | null;
  staff: boolean;
  details: {
    phone: string | null;
    email: string | null;
    roll_no: string | null;
    grade: string | null;
    address: string | null;
    guardian_name: string | null;
    guardian_phone: string | null;
    driver_name: string | null;
    parents: { name: string | null; phone: string | null }[];
  } | null;
}

type Verdict = { tone: 'ok' | 'warn' | 'bad'; title: string; note: string };

function verdictFor(p: PassData): Verdict {
  if (p.status === 'CONFIRMED') {
    if (p.refund_pending) {
      return { tone: 'warn', title: 'Cancellation in progress', note: 'This booking is being cancelled.' };
    }
    const pass = computePass(p.pass_start, p.billing_period as BillingPeriod | null);
    if (pass?.expired) {
      return { tone: 'bad', title: 'Pass expired', note: `Ended ${formatDateMedium(pass.endsAt.toISOString())}.` };
    }
    return {
      tone: 'ok',
      title: 'Valid pass',
      note: pass ? `Valid until ${formatDateMedium(pass.endsAt.toISOString())}.` : 'Seat confirmed.',
    };
  }
  if (p.status === 'PENDING') {
    return { tone: 'warn', title: 'Not active yet', note: 'Booking made, payment not yet confirmed.' };
  }
  return { tone: 'bad', title: 'Not valid', note: `This booking is ${p.status.toLowerCase()}.` };
}

const TONE = {
  ok: 'border-success/40 bg-success/10 text-success',
  warn: 'border-warning/40 bg-warning/10 text-warning',
  bad: 'border-destructive/40 bg-destructive/10 text-destructive',
};

export default async function PassPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = await createClient();
  const { data } = /^[0-9a-f]{32}$/.test(token)
    ? await db.rpc('ride_pass', { p_token: token })
    : { data: null };
  const pass = (data ?? null) as PassData | null;

  const checkedAt = new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  }).format(new Date());

  return (
    <main className="min-h-screen bg-background px-4 pt-[calc(env(safe-area-inset-top)+1.5rem)] pb-[calc(env(safe-area-inset-bottom)+2rem)]">
      <div className="mx-auto w-full max-w-md space-y-5">
        <Logo />

        {!pass ? (
          <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-6 text-center">
            <ShieldAlert className="mx-auto size-10 text-destructive" />
            <h1 className="mt-3 text-xl font-bold">Pass not found</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              This QR code doesn&apos;t match any ride pass. It may be copied or damaged.
            </p>
          </div>
        ) : (
          <PassCard pass={pass} checkedAt={checkedAt} />
        )}
      </div>
    </main>
  );
}

function PassCard({ pass, checkedAt }: { pass: PassData; checkedAt: string }) {
  const v = verdictFor(pass);
  const d = pass.details;
  const plan = periodLabel(pass.billing_period as BillingPeriod | null);

  return (
    <>
      <div className={`rounded-2xl border p-5 ${TONE[v.tone]}`}>
        <div className="flex items-center gap-3">
          {v.tone === 'ok' ? <BadgeCheck className="size-9 shrink-0" /> : <ShieldAlert className="size-9 shrink-0" />}
          <div>
            <p className="text-xl font-bold">{v.title}</p>
            <p className="text-sm opacity-90">{v.note}</p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <User className="size-6" />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Student</p>
            <p className="truncate text-lg font-bold tracking-tight">{pass.student_name || 'Student'}</p>
          </div>
        </div>
        <dl className="mt-4 space-y-2.5 text-sm">
          <Row icon={GraduationCap} label="Campus" value={pass.college_name} />
          <Row icon={BusFront} label="Bus" value={pass.bus_number ? `Bus ${pass.bus_number}` : null} />
          <Row icon={RouteIcon} label="Route" value={pass.route_name} />
          <Row icon={MapPin} label="Pickup stop" value={pass.pickup_name} />
          <Row icon={CalendarClock} label="Plan" value={plan || null} />
          {pass.agency_name && <Row icon={BusFront} label="Operator" value={pass.agency_name} />}
        </dl>
      </div>

      {d ? (
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Lock className="size-4 text-primary" /> Staff details
          </p>
          <dl className="mt-3 space-y-2.5 text-sm">
            <Row icon={Phone} label="Phone" value={d.phone} tel />
            <Row icon={Mail} label="Email" value={d.email} />
            <Row icon={Hash} label="Roll no" value={d.roll_no} />
            <Row icon={GraduationCap} label="Class / grade" value={d.grade} />
            <Row icon={Home} label="Address" value={d.address} />
            <Row
              icon={Users}
              label="Guardian"
              value={d.guardian_name ? `${d.guardian_name}${d.guardian_phone ? ` · ${d.guardian_phone}` : ''}` : d.guardian_phone}
            />
            {d.parents.map((p, i) => (
              <Row
                key={i}
                icon={Users}
                label="Parent"
                value={[p.name, p.phone].filter(Boolean).join(' · ') || null}
              />
            ))}
            <Row icon={User} label="Driver" value={d.driver_name} />
          </dl>
        </div>
      ) : (
        <p className="rounded-2xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          Driver, operator or campus staff?{' '}
          <Link href="/login" className="font-semibold text-primary hover:underline">
            Sign in
          </Link>{' '}
          and scan again to see contact details.
        </p>
      )}

      <p className="text-center text-xs text-muted-foreground">Checked {checkedAt} IST</p>
    </>
  );
}

function Row({
  icon: Icon,
  label,
  value,
  tel = false,
}: {
  icon: typeof User;
  label: string;
  value: string | null | undefined;
  tel?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <dt className="w-28 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 break-words font-medium">
        {value ? (
          tel ? (
            <a href={`tel:${value}`} className="text-primary hover:underline">
              {value}
            </a>
          ) : (
            value
          )
        ) : (
          <span className="font-normal text-muted-foreground">—</span>
        )}
      </dd>
    </div>
  );
}
