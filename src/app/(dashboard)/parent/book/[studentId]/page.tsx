import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Bus, GraduationCap, MapPin, Star, ArrowRight, Ticket, Clock3 } from 'lucide-react';
import { requireRole } from '@/features/auth/guard';
import { createClient } from '@/lib/supabase/server';
import { listChildren, getChildActiveBooking } from '@/features/parent/repository';
import { listInstitutionRoutes } from '@/features/catalog/repository';

const inr = (cents: number | null) =>
  cents == null || cents === 0 ? null : `₹${Math.round(cents / 100).toLocaleString('en-IN')}`;

// departure_time comes as "HH:MM:SS" — show a friendly local time.
function fmtTime(t: string | null): string | null {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  const am = h < 12;
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, '0')} ${am ? 'AM' : 'PM'}`;
}

export default async function ParentBookPickRoute({
  params,
}: {
  params: Promise<{ studentId: string }>;
}) {
  await requireRole('PARENT');
  const { studentId } = await params;
  const db = await createClient();

  const children = await listChildren(db);
  const child = children.find((c) => c.student_id === studentId);
  if (!child) notFound(); // not linked to this parent

  const [active, routes] = await Promise.all([
    getChildActiveBooking(db, studentId),
    child.institution_id
      ? listInstitutionRoutes(db, child.institution_id, { limit: 50 })
      : Promise.resolve([]),
  ]);

  const childName = child.full_name ?? 'your child';

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <Link href="/parent" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
          ← Back to dashboard
        </Link>
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-2xl bg-primary/10 text-primary">
            <GraduationCap className="size-6" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Book a bus for {childName}</h1>
            <p className="text-sm text-muted-foreground">
              {child.institution_name ?? 'Their campus'} · pick a ride below
            </p>
          </div>
        </div>
      </div>

      {/* Active booking banner — continue it rather than starting a second one. */}
      {active && (
        <div className="flex flex-col gap-3 rounded-2xl border border-primary/30 bg-primary/[0.06] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2.5 text-sm">
            <Clock3 className="mt-0.5 size-4 shrink-0 text-primary" />
            <span>
              {childName} already has an active booking
              {active.route_name ? (
                <>
                  {' '}on <b>{active.route_name}</b>
                </>
              ) : null}{' '}
              ({active.status.toLowerCase()}). One bus at a time — continue it below.
            </span>
          </div>
          {active.route_id && (
            <Link
              href={`/parent/book/${studentId}/routes/${active.route_id}`}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Ticket className="size-4" /> Continue booking
            </Link>
          )}
        </div>
      )}

      {!child.institution_id ? (
        <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          This child has no campus set yet, so there are no rides to show.
        </p>
      ) : routes.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No rides are available for {child.institution_name ?? 'this campus'} right now. Please check back later.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {routes.map((r) => {
            const soldOut = r.available <= 0 && r.total > 0;
            const price = inr(r.price_cents);
            return (
              <Link
                key={r.id}
                href={`/parent/book/${studentId}/routes/${r.id}`}
                className="group flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-xs transition-colors hover:border-primary/50"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{r.name}</p>
                    {r.agencyName && (
                      <p className="truncate text-sm text-muted-foreground">{r.agencyName}</p>
                    )}
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    <Bus className="size-3.5" /> {r.vehicleType === 'VAN' ? 'Van' : 'Bus'}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                  {r.agencyReviewCount > 0 && (
                    <span className="inline-flex items-center gap-1">
                      <Star className="size-3.5 fill-warning text-warning" /> {r.agencyRating.toFixed(1)}
                    </span>
                  )}
                  {fmtTime(r.departureTime) && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="size-3.5" /> {fmtTime(r.departureTime)}
                    </span>
                  )}
                  {r.busNumber && <span>Bus {r.busNumber}</span>}
                </div>
                <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                  <span className="text-sm">
                    {soldOut ? (
                      <span className="font-medium text-warning">Full</span>
                    ) : (
                      <span className="font-medium text-success">
                        <span className="tnum">{r.available}</span> seats
                      </span>
                    )}
                    {price && <span className="ml-2 tnum font-semibold text-foreground">{price}</span>}
                  </span>
                  <span className="inline-flex items-center gap-1 text-sm font-semibold text-primary group-hover:gap-1.5">
                    Select <ArrowRight className="size-4 transition-all" />
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
