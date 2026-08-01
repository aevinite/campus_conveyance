import { redirect } from 'next/navigation';
import { UsersRound, GraduationCap, Mail, Phone, MapPin, Bus, KeyRound, UserPlus } from 'lucide-react';
import { listParentsDetailed, listActiveLinkCodes, OPS_PAGE_SIZE } from '@/features/admin/ops-repository';
import { Pager, pageParams } from '@/components/pager';
import { formatDateTime } from '@/lib/format-date';

export const dynamic = 'force-dynamic';

function initials(name: string | null): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function RideBadge({ route, status }: { route: string | null; status: string | null }) {
  if (!status) {
    return <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">No active ride</span>;
  }
  const confirmed = status === 'CONFIRMED';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${confirmed ? 'border-success/30 bg-success/10 text-success' : 'border-warning/30 bg-warning/10 text-warning'}`}>
      <Bus className="size-3" />
      {route ?? 'Ride'} · {confirmed ? 'Confirmed' : 'Pending'}
    </span>
  );
}

export default async function AdminParentsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const { page, offset } = pageParams(pageParam, OPS_PAGE_SIZE);
  const [{ rows, total }, codes] = await Promise.all([
    listParentsDetailed({ limit: OPS_PAGE_SIZE, offset }),
    listActiveLinkCodes(),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / OPS_PAGE_SIZE));
  if (total > 0 && page > totalPages) redirect(`/aevinite/parents?page=${totalPages}`);

  return (
    <section className="space-y-6">
      <div>
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-primary">
          <UsersRound className="size-3.5" />
          Parents
        </span>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Parents &amp; linked children</h1>
        <p className="text-muted-foreground">
          Every parent account ({total}) and the full details of each child that granted them access.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border py-16 text-center">
          <span className="grid size-12 place-items-center rounded-xl bg-primary/10 text-primary"><UsersRound className="size-6" /></span>
          <p className="font-semibold">No parent accounts yet</p>
          <p className="max-w-xs text-sm text-muted-foreground">Parents appear here once they sign up and link a child.</p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {rows.map((p) => (
            <div key={p.id} className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
              {/* Parent header */}
              <div className="flex items-start gap-3 border-b border-border bg-muted/30 p-4">
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 text-sm font-bold text-primary ring-1 ring-inset ring-primary/15">
                  {initials(p.name)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{p.name ?? 'Unnamed parent'}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    {p.email && <span className="inline-flex items-center gap-1"><Mail className="size-3" />{p.email}</span>}
                    {p.phone && <span className="inline-flex items-center gap-1"><Phone className="size-3" />{p.phone}</span>}
                  </p>
                </div>
                <span className="shrink-0 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                  {p.children.length} {p.children.length === 1 ? 'child' : 'children'}
                </span>
              </div>

              {/* Children */}
              {p.children.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">No linked children.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {p.children.map((c) => (
                    <li key={c.studentId} className="flex items-start gap-3 p-4">
                      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-secondary text-muted-foreground">
                        <GraduationCap className="size-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2 font-medium">
                          <span className="truncate">{c.name ?? 'Unnamed'}</span>
                          <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${c.managed ? 'border-border bg-muted text-muted-foreground' : 'border-primary/30 bg-primary/10 text-primary'}`}>
                            {c.managed ? 'Managed' : 'Student login'}
                          </span>
                        </p>
                        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                          {c.email && <span className="inline-flex items-center gap-1"><Mail className="size-3" />{c.email}</span>}
                          {c.phone && <span className="inline-flex items-center gap-1"><Phone className="size-3" />{c.phone}</span>}
                          {c.campus && <span className="inline-flex items-center gap-1"><MapPin className="size-3" />{c.campus}</span>}
                        </p>
                        <div className="mt-1.5"><RideBadge route={c.rideRoute} status={c.rideStatus} /></div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
      <Pager page={page} totalPages={totalPages} basePath="/aevinite/parents" />

      {/* Active link codes */}
      <div className="space-y-3 rounded-2xl border border-border bg-card p-5 shadow-xs">
        <div className="flex items-center gap-2">
          <span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary"><KeyRound className="size-5" /></span>
          <div>
            <h2 className="font-semibold">Active link codes ({codes.length})</h2>
            <p className="text-sm text-muted-foreground">
              One-time codes a student generated so a parent can link to them — they expire shortly after issue.
            </p>
          </div>
        </div>
        {codes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active link codes right now.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {codes.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background/50 px-4 py-2.5">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-lg font-bold tracking-widest text-primary">{c.code}</span>
                  <span className="inline-flex items-center gap-1 text-sm text-muted-foreground"><UserPlus className="size-3.5" />{c.studentName ?? '—'}</span>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">exp {formatDateTime(c.expires_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
