import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Bus, IdCard, MapPin, Users } from 'lucide-react';
import { getVehicleDetail, type SeatRider } from '@/features/admin/ops-repository';
import { Card, CardContent } from '@/components/ui/card';
import { DataTable } from '@/components/data-table';
import { StatusBadge, BoolBadge } from '@/components/status-badge';
import { formatDateTime, formatDateMedium } from '@/lib/format-date';
import { relativeTime } from '@/lib/format';
import BusGallery from '@/app/(dashboard)/student/routes/[id]/bus-gallery';
import RouteStopsMap from '@/app/(dashboard)/student/routes/[id]/route-stops-map';

export const dynamic = 'force-dynamic';

const s = (v: unknown): string | null => (v == null || v === '' ? null : String(v));

/** Bus photos the provider uploaded — `photos[]` plus `image_url`, de-duped. */
function busPhotos(v: Record<string, unknown>): string[] {
  const arr = Array.isArray(v.photos) ? (v.photos as unknown[]).filter((p): p is string => typeof p === 'string') : [];
  const img = typeof v.image_url === 'string' ? v.image_url : null;
  return [...new Set([...arr, ...(img ? [img] : [])])];
}

function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-border/50 py-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className={`text-sm sm:max-w-[60%] sm:text-right ${mono ? 'font-mono text-xs' : ''}`}>{value || '—'}</dd>
    </div>
  );
}

function DocLink({ href, label }: { href: string | null; label: string }) {
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-sm text-primary transition-colors hover:text-primary/70">
      {label} ↗
    </a>
  );
}

function RiderTable({ riders }: { riders: SeatRider[] }) {
  return (
    <DataTable
      headers={['Student', 'Pickup', 'Drop', 'Status', 'Paid']}
      rows={riders.map((r) => [
        <div key="st" className="min-w-0">
          <p className="font-medium">{r.studentName ?? '—'}</p>
          <p className="text-xs text-muted-foreground">{r.studentEmail ?? '—'}</p>
        </div>,
        r.pickupStop,
        r.dropStop,
        <StatusBadge key="s" value={r.status} />,
        <BoolBadge key="p" value={r.isPaid} yes="Paid" no="Unpaid" />,
      ])}
      empty="No riders booked on this bus yet."
    />
  );
}

export default async function AdminVehicleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getVehicleDetail(id);
  if (!detail) notFound();
  const { vehicle: v, agencyName, assignments, live, changes } = detail;

  return (
    <section className="space-y-6">
      <div>
        <Link href="/aevinite/fleet" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Back to fleet
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <Bus className="size-6" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{s(v.bus_number) ?? s(v.registration_no) ?? 'Vehicle'}</h1>
            <p className="text-sm text-muted-foreground">
              {v.vehicle_type === 'VAN' ? 'Van' : 'Bus'} · {agencyName}
            </p>
          </div>
        </div>
      </div>

      {busPhotos(v).length > 0 && (
        <Card className="rounded-2xl">
          <CardContent className="space-y-3 py-5">
            <h2 className="font-semibold">Bus photos</h2>
            <BusGallery photos={busPhotos(v)} alt={s(v.bus_number) ?? 'Bus'} />
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Vehicle identity */}
        <Card className="rounded-2xl">
          <CardContent className="space-y-3 py-5">
            <h2 className="font-semibold">Vehicle details</h2>
            <dl className="grid gap-x-6 sm:grid-cols-1">
              <Field label="Bus number" value={s(v.bus_number)} />
              <Field label="Registration no." value={s(v.registration_no)} mono />
              <Field label="Type" value={v.vehicle_type === 'VAN' ? 'Van' : 'Bus'} />
              <Field label="Capacity" value={s(v.capacity)} />
              <Field label="Air-conditioned" value={<BoolBadge value={!!v.is_ac} />} />
              <Field label="Model" value={s(v.bus_model) ?? s(v.model)} />
              <Field label="Colour" value={s(v.bus_color)} />
              <Field label="Status" value={<BoolBadge value={!!v.is_active} yes="Active" no="Inactive" />} />
              <Field label="Registered on" value={formatDateMedium(s(v.created_at))} />
            </dl>
            <div className="flex flex-wrap gap-3 pt-1">
              <DocLink href={s(v.rc_url)} label="RC" />
              <DocLink href={s(v.permit_url)} label="Permit" />
              <DocLink href={s(v.fitness_url)} label="Fitness" />
              <DocLink href={s(v.insurance_url)} label="Insurance" />
              <DocLink href={s(v.details_pdf_url)} label="Details PDF" />
            </div>
          </CardContent>
        </Card>

        {/* Driver KYC */}
        <Card className="rounded-2xl">
          <CardContent className="space-y-3 py-5">
            <h2 className="flex items-center gap-2 font-semibold">
              <IdCard className="size-4 text-primary" /> Driver
              {v.driver_verified ? <StatusBadge value="Verified" /> : null}
            </h2>
            <dl>
              <Field label="Name" value={s(v.driver_name)} />
              <Field label="Phone" value={s(v.driver_phone)} />
              <Field label="Alt. phone" value={s(v.driver_alt_phone)} />
              <Field label="Email" value={s(v.driver_email)} />
              <Field label="Licence no." value={s(v.driver_license_no)} mono />
              <Field label="Experience" value={v.driver_experience_years != null ? `${v.driver_experience_years} yrs` : null} />
              <Field label="Govt ID" value={s(v.driver_govt_id)} mono />
              <Field label="Date of birth" value={formatDateMedium(s(v.driver_dob))} />
              <Field label="Blood group" value={s(v.driver_blood_group)} />
              <Field label="Address" value={s(v.driver_address)} />
            </dl>
            <DocLink href={s(v.driver_photo_url)} label="Driver photo" />
          </CardContent>
        </Card>

        {/* Conductor KYC (only if present) */}
        {s(v.conductor_name) && (
          <Card className="rounded-2xl">
            <CardContent className="space-y-3 py-5">
              <h2 className="flex items-center gap-2 font-semibold">
                <IdCard className="size-4 text-primary" /> Conductor
                {v.conductor_verified ? <StatusBadge value="Verified" /> : null}
              </h2>
              <dl>
                <Field label="Name" value={s(v.conductor_name)} />
                <Field label="Phone" value={s(v.conductor_phone)} />
                <Field label="Alt. phone" value={s(v.conductor_alt_phone)} />
                <Field label="Govt ID" value={s(v.conductor_govt_id)} mono />
                <Field label="Date of birth" value={formatDateMedium(s(v.conductor_dob))} />
                <Field label="Blood group" value={s(v.conductor_blood_group)} />
                <Field label="Address" value={s(v.conductor_address)} />
              </dl>
            </CardContent>
          </Card>
        )}

        {/* Live location */}
        <Card className="rounded-2xl">
          <CardContent className="space-y-3 py-5">
            <h2 className="flex items-center gap-2 font-semibold">
              <MapPin className="size-4 text-primary" /> Live location
            </h2>
            {live ? (
              <dl>
                <Field label="Status" value={<StatusBadge value={live.is_online ? 'Online' : 'Offline'} />} />
                <Field label="Coordinates" value={live.lat != null && live.lng != null ? `${live.lat.toFixed(5)}, ${live.lng.toFixed(5)}` : null} mono />
                <Field label="Last update" value={live.updated_at ? `${formatDateTime(live.updated_at)} (${relativeTime(live.updated_at)})` : null} />
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">No live location — this bus has no assigned driver or has never gone online.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Seat roster per route */}
      <div className="space-y-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Users className="size-5 text-primary" /> Seat roster — who is on this bus
        </h2>
        {assignments.length === 0 ? (
          <p className="text-sm text-muted-foreground">This bus is not assigned to any route.</p>
        ) : (
          assignments.map((a) => {
            const geoStops = a.stops.filter((st) => st.lat != null && st.lng != null);
            return (
              <div key={a.assignmentId} className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">
                    {a.routeId ? (
                      <Link href={`/aevinite/routes/${a.routeId}`} className="text-primary transition-colors hover:text-primary/70">
                        {a.routeName}
                      </Link>
                    ) : (
                      a.routeName
                    )}
                  </p>
                  <span className="text-sm text-muted-foreground">
                    Occupancy: <span className="font-semibold text-foreground tabular-nums">{a.reservedSeats ?? 0}</span> / {a.totalSeats ?? '—'} seats
                  </span>
                </div>

                {/* This route's stops + the bus's live position on a map. */}
                {a.stops.length > 0 && (
                  <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
                    <div className="rounded-xl border border-border bg-card p-3">
                      <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
                        <MapPin className="size-4 text-primary" /> Stops ({a.stops.length})
                      </p>
                      <ol className="space-y-2">
                        {a.stops.map((st, i) => (
                          <li key={`${a.assignmentId}-${i}`} className="flex items-start gap-2.5">
                            <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary tabular-nums">
                              {st.sequence ?? '·'}
                            </span>
                            <div className="min-w-0">
                              <p className="text-sm font-medium">{st.name}</p>
                              {st.description && <p className="text-xs text-muted-foreground">Exact spot: {st.description}</p>}
                              {st.address && <p className="text-xs text-muted-foreground">{st.address}</p>}
                            </div>
                          </li>
                        ))}
                      </ol>
                    </div>
                    {geoStops.length > 0 && a.routeId && (
                      <RouteStopsMap
                        stops={a.stops.map((st) => ({
                          name: st.name,
                          lat: st.lat,
                          lng: st.lng,
                          description: st.description,
                          address: st.address,
                        }))}
                        liveRouteId={a.routeId}
                        heightClass="h-80"
                      />
                    )}
                  </div>
                )}

                <RiderTable riders={a.riders} />
              </div>
            );
          })
        )}
      </div>

      {/* Driver change history */}
      {changes.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">Driver / conductor change history</h2>
          <DataTable
            headers={['Name', 'Phone', 'Role', 'Reason', 'Effective', 'Recorded']}
            rows={changes.map((c) => [
              c.driver_name ?? '—',
              c.driver_phone ?? '—',
              c.role ?? '—',
              c.reason ?? '—',
              formatDateMedium(c.effective_date),
              formatDateMedium(c.created_at),
            ])}
            empty="No changes recorded."
          />
        </div>
      )}
    </section>
  );
}
