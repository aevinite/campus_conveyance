import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Route, MapPin, Users, Milestone } from 'lucide-react';
import { getRouteDetail } from '@/features/admin/ops-repository';
import { Card, CardContent } from '@/components/ui/card';
import { DataTable } from '@/components/data-table';
import { StatusBadge, BoolBadge } from '@/components/status-badge';
import RouteStopsMap from '@/app/(dashboard)/student/routes/[id]/route-stops-map';
import { formatDateTime } from '@/lib/format-date';
import { rupees } from '@/lib/format';

export const dynamic = 'force-dynamic';

const s = (v: unknown): string | null => (v == null || v === '' ? null : String(v));
const hhmm = (t: string | null) => (t ? t.slice(0, 5) : '—');

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-border/50 py-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm sm:text-right">{value || '—'}</dd>
    </div>
  );
}

export default async function AdminRouteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getRouteDetail(id);
  if (!detail) notFound();
  const { route: r, institutionName, agencyName, busNumber, stops, occupancy, riders, progress } = detail;
  const hasGeo = stops.some((st) => st.lat != null && st.lng != null);

  return (
    <section className="space-y-6">
      <div>
        <Link href="/aevinite/routes" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Back to routes
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <Route className="size-6" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{s(r.name)}</h1>
            <p className="text-sm text-muted-foreground">{institutionName} · {agencyName}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="rounded-2xl">
          <CardContent className="space-y-3 py-5">
            <h2 className="font-semibold">Route details</h2>
            {typeof r.image_url === 'string' && r.image_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={r.image_url} alt={s(r.name) ?? 'Route'} className="aspect-[16/9] w-full rounded-xl border border-border object-cover" />
            )}
            <dl>
              <Field label="Start location" value={s(r.start_location)} />
              <Field label="Vehicle type" value={r.vehicle_type === 'VAN' ? 'Van' : 'Bus'} />
              <Field label="Assigned bus" value={busNumber} />
              <Field label="Departure" value={hhmm(s(r.departure_time))} />
              <Field label="Fare" value={rupees(r.price_cents as number)} />
              <Field label="Status" value={<BoolBadge value={!!r.is_active} yes="Active" no="Inactive" />} />
              <Field
                label="Occupancy"
                value={occupancy ? `${occupancy.reservedSeats ?? 0} / ${occupancy.totalSeats ?? '—'} seats` : 'No seat allocation'}
              />
            </dl>
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardContent className="space-y-3 py-5">
            <h2 className="flex items-center gap-2 font-semibold">
              <MapPin className="size-4 text-primary" /> Stops ({stops.length})
            </h2>
            {stops.length === 0 ? (
              <p className="text-sm text-muted-foreground">No stops defined for this route.</p>
            ) : (
              <ol className="space-y-2">
                {stops.map((st) => (
                  <li key={st.id} className="flex items-start gap-3">
                    <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary tabular-nums">
                      {st.sequence ?? '·'}
                    </span>
                    <div className="min-w-0">
                      <p className="font-medium">{st.name}</p>
                      {st.description && <p className="text-xs text-muted-foreground">Exact spot: {st.description}</p>}
                      {st.address && <p className="text-xs text-muted-foreground">{st.address}</p>}
                      {st.lat != null && st.lng != null && (
                        <p className="font-mono text-[11px] text-muted-foreground">{st.lat.toFixed(5)}, {st.lng.toFixed(5)}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Route map — stop pins + the live bus position while the driver is online. */}
      {hasGeo && (
        <Card className="rounded-2xl">
          <CardContent className="space-y-3 py-5">
            <h2 className="flex items-center gap-2 font-semibold">
              <MapPin className="size-4 text-primary" /> Route map
              <span className="text-sm font-normal text-muted-foreground">
                · live bus shows while the driver is online
              </span>
            </h2>
            <RouteStopsMap
              stops={stops.map((st) => ({
                name: st.name,
                lat: st.lat,
                lng: st.lng,
                description: st.description,
                address: st.address,
              }))}
              liveRouteId={r.id as string}
              heightClass="h-96"
            />
          </CardContent>
        </Card>
      )}

      {progress.length > 0 && (
        <div className="space-y-2">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Milestone className="size-5 text-primary" /> Today&apos;s stop progress
          </h2>
          <DataTable
            headers={['Stop', 'Status', 'Recorded']}
            rows={progress.map((p, i) => [
              p.stopName,
              p.status ? <StatusBadge key={i} value={p.status} /> : '—',
              formatDateTime(p.recorded_at),
            ])}
            empty="No stop progress recorded today."
          />
        </div>
      )}

      <div className="space-y-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Users className="size-5 text-primary" /> Riders on this route ({riders.length})
        </h2>
        <DataTable
          headers={['Student', 'Pickup', 'Drop', 'Status', 'Paid']}
          rows={riders.map((rd) => [
            <div key="st" className="min-w-0">
              <p className="font-medium">{rd.studentName ?? '—'}</p>
              <p className="text-xs text-muted-foreground">{rd.studentEmail ?? '—'}</p>
            </div>,
            rd.pickupStop,
            rd.dropStop,
            <StatusBadge key="s" value={rd.status} />,
            <BoolBadge key="p" value={rd.isPaid} yes="Paid" no="Unpaid" />,
          ])}
          empty="No riders booked on this route yet."
        />
      </div>
    </section>
  );
}
