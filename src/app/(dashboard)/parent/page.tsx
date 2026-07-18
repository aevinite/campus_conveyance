import { Bus, GraduationCap, Phone, Ticket, UserCircle } from 'lucide-react';
import { requireRole } from '@/features/auth/guard';
import { createClient } from '@/lib/supabase/server';
import { getSessionClaims } from '@/features/auth/session';
import { listChildren, listChildrenBookings } from '@/features/parent/repository';
import { LinkChildForm } from './link-child-form';
import { UnlinkChildButton } from './unlink-child-button';

const STATUS_PILL: Record<string, string> = {
  CONFIRMED: 'border-success/30 bg-success/10 text-success',
  WAITLISTED: 'border-warning/30 bg-warning/10 text-warning',
  PENDING: 'border-primary/30 bg-primary/10 text-primary',
  CANCELLED: 'border-border bg-muted text-muted-foreground',
};

const STATUS_LABEL: Record<string, string> = {
  CONFIRMED: 'Confirmed',
  WAITLISTED: 'Waitlisted',
  PENDING: 'Pending',
  CANCELLED: 'Cancelled',
};

const shortDate = new Intl.DateTimeFormat('en-IN', { month: 'short', day: 'numeric' });

export default async function ParentDashboard() {
  await requireRole('PARENT');
  const db = await createClient();
  const [{ fullName }, children, bookings] = await Promise.all([
    getSessionClaims(db),
    listChildren(db),
    listChildrenBookings(db),
  ]);
  const name = (fullName ?? 'there').split(' ')[0];

  return (
    <div className="space-y-8">
      {/* Greeting */}
      <section className="relative overflow-hidden rounded-3xl border border-border bg-card p-7 shadow-sm sm:p-10">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              'radial-gradient(80% 130% at 100% 0%, color-mix(in oklch, var(--primary) 22%, transparent), transparent 62%)',
          }}
        />
        <div aria-hidden className="pointer-events-none absolute -right-10 -bottom-16 -z-10 opacity-[0.07]">
          <UserCircle className="size-64" />
        </div>
        <h1 className="max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">
          Welcome, <span className="text-primary">{name}</span>.
        </h1>
        <p className="mt-3 max-w-xl text-muted-foreground">
          Link your children&apos;s student accounts to follow their bookings,
          buses and drivers — all in one place.
        </p>
      </section>

      <LinkChildForm />

      {/* Children */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Your children</h2>
        {children.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No children linked yet — add your child&apos;s account email above to
            see their trips here.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {children.map((c) => (
              <div key={c.student_id} className="rounded-2xl border border-border bg-card p-5 shadow-xs">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
                      <GraduationCap className="size-5" />
                    </span>
                    <div>
                      <p className="font-semibold">{c.full_name ?? 'Student'}</p>
                      <p className="text-sm text-muted-foreground">{c.email}</p>
                    </div>
                  </div>
                  <UnlinkChildButton studentId={c.student_id} />
                </div>
                <div className="mt-3 space-y-0.5 text-sm text-muted-foreground">
                  {c.grade && <p>Class: {c.grade}</p>}
                  {c.phone && (
                    <p className="inline-flex items-center gap-1.5">
                      <Phone className="size-3.5" /> {c.phone}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Bookings */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Their bookings</h2>
        {bookings.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border py-12 text-center">
            <span className="grid size-11 place-items-center rounded-full bg-secondary text-muted-foreground">
              <Ticket className="size-5" />
            </span>
            <p className="text-sm text-muted-foreground">
              {children.length === 0
                ? 'Bookings will appear here once you link a child.'
                : 'No bookings yet — they will appear here as soon as your child reserves a seat.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {bookings.map((b) => (
              <div
                key={b.booking_id}
                className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-xs sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-x-2 font-medium">
                    {b.route_name ?? 'Route'}
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
                        STATUS_PILL[b.status] ?? STATUS_PILL.PENDING
                      }`}
                    >
                      {STATUS_LABEL[b.status] ?? b.status}
                      {b.status === 'PENDING' && b.is_paid ? ' · Paid' : ''}
                    </span>
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {[
                      b.student_name,
                      b.institution_name,
                      b.pickup_name && `Pickup: ${b.pickup_name}`,
                      `Booked ${shortDate.format(new Date(b.created_at))}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  {(b.bus_number || b.driver_name) && (
                    <p className="mt-1 inline-flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
                      {b.bus_number && (
                        <span className="inline-flex items-center gap-1.5">
                          <Bus className="size-3.5" /> Bus {b.bus_number}
                        </span>
                      )}
                      {b.driver_name && (
                        <span>
                          Driver: {b.driver_name}
                          {b.driver_phone ? ` (${b.driver_phone})` : ''}
                        </span>
                      )}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
