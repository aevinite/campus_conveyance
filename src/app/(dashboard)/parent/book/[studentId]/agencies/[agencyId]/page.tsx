import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Bus, Truck, MapPin, Star, ArrowRight, ArrowLeft, Building2 } from 'lucide-react';
import { requireRole } from '@/features/auth/guard';
import { createClient } from '@/lib/supabase/server';
import { listChildren } from '@/features/parent/repository';
import {
  listInstitutionAgencies,
  listInstitutionRoutes,
  type VehicleType,
} from '@/features/catalog/repository';

const inr = (cents: number | null) =>
  cents == null || cents === 0 ? null : `₹${Math.round(cents / 100).toLocaleString('en-IN')}`;

function fmtTime(t: string | null): string | null {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  const am = h < 12;
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, '0')} ${am ? 'AM' : 'PM'}`;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default async function ParentBookAgencyRoutes({
  params,
  searchParams,
}: {
  params: Promise<{ studentId: string; agencyId: string }>;
  searchParams: Promise<{ type?: string }>;
}) {
  await requireRole('PARENT');
  const { studentId, agencyId } = await params;
  const sp = await searchParams;
  const vehicleType: VehicleType | undefined =
    sp.type === 'BUS' || sp.type === 'VAN' ? sp.type : undefined;
  const db = await createClient();

  const children = await listChildren(db);
  const child = children.find((c) => c.student_id === studentId);
  if (!child || !child.institution_id) notFound();

  const agencies = await listInstitutionAgencies(db, child.institution_id);
  const agency = agencies.find((a) => a.id === agencyId);
  const backHref = `/parent/book/${studentId}${vehicleType ? `?type=${vehicleType}` : ''}`;
  if (!agency) redirect(backHref);

  const isCampus = agencyId === 'campus';
  const routes = await listInstitutionRoutes(db, child.institution_id, {
    vehicleType,
    agencyId: isCampus ? undefined : agencyId,
    orphanOnly: isCampus,
    limit: 50,
  });

  const childName = child.full_name ?? 'your child';

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <Link href={backHref} className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="size-4" /> Agencies
        </Link>
        <div className="flex items-center gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-primary/15 to-primary/5 text-base font-bold text-primary ring-1 ring-inset ring-primary/15">
            {isCampus ? <Building2 className="size-6" /> : initials(agency.name)}
          </span>
          <div className="min-w-0">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Buses to {child.institution_name} · for {childName}
            </span>
            <h1 className="truncate text-2xl font-bold tracking-tight">{agency.name}</h1>
          </div>
        </div>
      </div>

      {routes.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No rides available here right now. Please check back later.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {routes.map((r) => {
            const soldOut = r.available <= 0 && r.total > 0;
            const price = inr(r.price_cents);
            const Icon = r.vehicleType === 'VAN' ? Truck : Bus;
            return (
              <Link
                key={r.id}
                href={`/parent/book/${studentId}/routes/${r.id}`}
                className="group flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-xs transition-colors hover:border-primary/50"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{r.name}</p>
                    {r.agencyName && <p className="truncate text-sm text-muted-foreground">{r.agencyName}</p>}
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    <Icon className="size-3.5" /> {r.vehicleType === 'VAN' ? 'Van' : 'Bus'}
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
