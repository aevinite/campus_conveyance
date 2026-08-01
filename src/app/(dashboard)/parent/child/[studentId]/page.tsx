import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, GraduationCap, Mail, Phone, MapPin, Home, Ticket, Bus } from 'lucide-react';
import { requireRole } from '@/features/auth/guard';
import { createClient } from '@/lib/supabase/server';
import { listChildren } from '@/features/parent/repository';
import RouteStopsMap, { type MapStop } from '../../../student/routes/[id]/route-stops-map';

const STATUS_PILL: Record<string, string> = {
  CONFIRMED: 'border-success/30 bg-success/10 text-success',
  PENDING: 'border-warning/30 bg-warning/10 text-warning',
  WAITLISTED: 'border-primary/30 bg-primary/10 text-primary',
};
const STATUS_LABEL: Record<string, string> = {
  CONFIRMED: 'Confirmed',
  PENDING: 'Pending',
  WAITLISTED: 'Waitlisted',
};

export default async function ParentChildHub({
  params,
}: {
  params: Promise<{ studentId: string }>;
}) {
  await requireRole('PARENT');
  const { studentId } = await params;
  const db = await createClient();

  const children = await listChildren(db);
  const child = children.find((c) => c.student_id === studentId);
  if (!child) notFound();

  const childName = child.full_name ?? 'Your child';
  const confirmed = child.active_status === 'CONFIRMED' && !!child.active_route_id;

  // Live map only for a confirmed ride — fetch that route's stops.
  let stops: MapStop[] = [];
  if (confirmed && child.active_route_id) {
    const { data } = await db
      .from('route_stops')
      .select('name, lat, lng, address, description, sequence')
      .eq('route_id', child.active_route_id)
      .order('sequence');
    stops = (data ?? []).map((s) => ({
      name: s.name as string,
      lat: s.lat as number | null,
      lng: s.lng as number | null,
      address: s.address as string | null,
      description: s.description as string | null,
    }));
  }

  const details: { label: string; value: string; icon: typeof Mail }[] = [
    { label: 'Email', value: child.email || 'Not added', icon: Mail },
    { label: 'Phone', value: child.phone || 'Not added', icon: Phone },
    { label: 'Class / grade', value: child.grade || 'Not added', icon: GraduationCap },
    { label: 'Campus', value: child.institution_name || 'Not set', icon: MapPin },
    { label: 'Address', value: child.address || 'Not added', icon: Home },
  ];

  const cta = child.active_status
    ? child.active_route_id
      ? { label: 'Manage booking', href: `/parent/book/${studentId}/routes/${child.active_route_id}` }
      : { label: 'View booking', href: `/parent/book/${studentId}` }
    : { label: 'Book a bus', href: `/parent/book/${studentId}` };

  return (
    <section className="space-y-6">
      <div>
        <Link href="/parent" className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="size-4" /> Back to dashboard
        </Link>
        <div className="mt-3 flex items-center gap-4">
          <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
            <GraduationCap className="size-7" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-bold tracking-tight sm:text-3xl">{childName}</h1>
            <span className="mt-1 inline-block rounded-full border border-border bg-secondary px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
              {child.managed ? 'Managed child' : 'Linked student'}
            </span>
          </div>
        </div>
      </div>

      {/* Booking status + action */}
      <div className="flex flex-col gap-3 rounded-2xl border border-primary/30 bg-primary/[0.06] p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
            <Ticket className="size-5" />
          </span>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-primary">Bus booking</p>
            {child.active_status ? (
              <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm">
                <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STATUS_PILL[child.active_status] ?? STATUS_PILL.PENDING}`}>
                  {STATUS_LABEL[child.active_status] ?? child.active_status}
                </span>
                {child.active_route_name && <span className="font-medium">{child.active_route_name}</span>}
              </p>
            ) : (
              <p className="mt-0.5 text-sm text-muted-foreground">No active booking yet.</p>
            )}
          </div>
        </div>
        <Link
          href={cta.href}
          className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Ticket className="size-4" /> {cta.label}
        </Link>
      </div>

      {/* Live bus map — only once the ride is confirmed. */}
      {confirmed && child.active_route_id && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Bus className="size-5 text-primary" /> Track {childName}&apos;s bus
          </h2>
          <p className="text-sm text-muted-foreground">
            Live location of {child.active_route_name ?? 'their ride'} — shows while the driver is online.
          </p>
          <div className="rounded-2xl border border-border bg-card p-4 shadow-xs">
            <RouteStopsMap stops={stops} liveRouteId={child.active_route_id} heightClass="h-[24rem] sm:h-[28rem]" />
          </div>
        </section>
      )}

      {/* Child details */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-xs sm:p-6">
        <h2 className="text-base font-semibold">Details</h2>
        <dl className="mt-3 grid gap-x-8 gap-y-1 sm:grid-cols-2">
          {details.map((d) => (
            <div key={d.label} className="flex items-start justify-between gap-4 border-b border-border/60 py-3 last:border-b-0 sm:[&:nth-last-child(2)]:border-b-0">
              <dt className="flex items-center gap-2 text-sm text-muted-foreground">
                <d.icon className="size-4" />
                {d.label}
              </dt>
              <dd className="max-w-[60%] truncate text-right text-sm font-medium">{d.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
