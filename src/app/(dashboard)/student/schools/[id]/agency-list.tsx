import Link from 'next/link';
import { ArrowRight, Bus, Truck, Building2, Sparkles } from 'lucide-react';
import { StarRating } from '@/components/ui/star-rating';
import type { InstitutionAgency, VehicleType } from '@/features/catalog/repository';

/** Up to two initials from an agency name, for the logo chip. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Bus / Van chooser at the top of the campus page. The student picks a vehicle
 * type first, then sees only the agencies that run that type. Plain links (the
 * server re-fetches the agency list for the chosen type) — no client state.
 */
export function VehicleTabs({
  basePath,
  active,
}: {
  /** The page these tabs live on, e.g. /student/schools/[id] or
   *  /parent/book/[studentId]. Each tab links to `${basePath}?type=…`. */
  basePath: string;
  active: VehicleType;
}) {
  const tabs: { key: VehicleType; label: string; Icon: typeof Bus }[] = [
    { key: 'BUS', label: 'Bus', Icon: Bus },
    { key: 'VAN', label: 'Van', Icon: Truck },
  ];
  return (
    <div role="tablist" aria-label="Vehicle type" className="inline-flex rounded-xl border border-border bg-card p-1">
      {tabs.map(({ key, label, Icon }) => {
        const on = key === active;
        return (
          <Link
            key={key}
            role="tab"
            aria-selected={on}
            href={`${basePath}?type=${key}`}
            scroll={false}
            className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors ${
              on
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon className="size-4" /> {label}
          </Link>
        );
      })}
    </div>
  );
}

/**
 * The agencies running the chosen vehicle type to a campus — the student picks
 * one before seeing its buses/vans (campus → agency → ride → reserve). Each card
 * links to the agency's route drill-down, carrying the vehicle type through.
 * Shared by the website and the app-native views.
 */
export function AgencyList({
  agencies,
  basePath,
  vehicleType,
}: {
  agencies: InstitutionAgency[];
  /** Where an agency card links: `${basePath}/agencies/[id]?type=…` — e.g.
   *  /student/schools/[id] or /parent/book/[studentId]. */
  basePath: string;
  vehicleType: VehicleType;
}) {
  const isVan = vehicleType === 'VAN';
  const noun = (n: number) => (isVan ? (n === 1 ? 'van' : 'vans') : n === 1 ? 'bus' : 'buses');
  const TypeIcon = isVan ? Truck : Bus;

  if (agencies.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border py-16 text-center">
        <span className="grid size-12 place-items-center rounded-xl bg-primary/10 text-primary">
          <TypeIcon className="size-6" />
        </span>
        <p className="font-semibold">No {isVan ? 'van operators' : 'bus agencies'} yet</p>
        <p className="max-w-xs text-sm text-muted-foreground">
          No {isVan ? 'vans' : 'buses'} serve this campus yet — try the{' '}
          <span className="font-medium text-foreground">{isVan ? 'Bus' : 'Van'}</span> tab,
          or check back soon.
        </p>
      </div>
    );
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {agencies.map((a) => {
        const isCampus = a.id === 'campus';
        return (
          <li key={a.id}>
            <Link
              href={`${basePath}/agencies/${a.id}?type=${vehicleType}`}
              className="group flex h-full items-center gap-4 rounded-2xl border border-border bg-card/60 p-4 shadow-xs transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:bg-card hover:shadow-md sm:p-5"
            >
              {/* Logo chip — initials for a real agency, an icon for the campus group. */}
              <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-primary/15 to-primary/5 text-base font-bold tracking-tight text-primary ring-1 ring-inset ring-primary/15 transition-colors group-hover:from-primary group-hover:to-primary group-hover:text-primary-foreground">
                {isCampus ? <Building2 className="size-6" /> : initials(a.name)}
              </span>

              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{a.name}</p>
                <div className="mt-1 min-h-5">
                  {isCampus ? (
                    <span className="text-xs text-muted-foreground">Direct campus {noun(2)}</span>
                  ) : a.ratingCount > 0 ? (
                    <StarRating value={a.ratingAvg} count={a.ratingCount} size={13} />
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                      <Sparkles className="size-3.5 text-primary" /> New operator
                    </span>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] font-medium">
                  <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-primary">
                    <TypeIcon className="size-3" />
                    <span className="tnum">{a.routeCount}</span> {noun(a.routeCount)}
                  </span>
                </div>
              </div>

              <ArrowRight className="size-5 shrink-0 text-primary transition-transform group-hover:translate-x-0.5" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
