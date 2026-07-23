import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Building2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { listAgenciesDetailed, ADMIN_PAGE_SIZE, type AgencyDetail } from '@/features/admin/repository';
import { deleteAgencyAction } from '@/features/admin/actions';
import { Card, CardContent } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { ConfirmSubmit } from '@/components/confirm-submit';
import { Pager, pageParams } from '@/components/pager';
import { formatDateMedium } from '@/lib/format-date';

const fmtDate = (v?: string | null) => formatDateMedium(v);

export default async function AdminProvidersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const { page, offset } = pageParams(pageParam, ADMIN_PAGE_SIZE);
  const db = await createClient();
  const { rows: agencies, total } = await listAgenciesDetailed(db, { limit: ADMIN_PAGE_SIZE, offset });
  const totalPages = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));
  if (total > 0 && page > totalPages) redirect(`/aevinite/providers?page=${totalPages}`);

  return (
    <section className="space-y-4">
      <div>
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-primary">
          <Building2 className="size-3.5" />
          Providers
        </span>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Manage Service Providers</h1>
        <p className="text-muted-foreground">
          The full details each provider submitted at signup. Use Edit to update anything that changes.
        </p>
      </div>

      {agencies.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border py-16 text-center">
          <span className="grid size-12 place-items-center rounded-xl bg-primary/10 text-primary">
            <Building2 className="size-6" />
          </span>
          <p className="font-medium">No approved service providers</p>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {agencies.map((a) => (
            <ProviderCard key={a.id} a={a} />
          ))}
        </div>
      )}
      <Pager page={page} totalPages={totalPages} basePath="/aevinite/providers" />
    </section>
  );
}

function ProviderCard({ a }: { a: AgencyDetail }) {
  const rows: { label: string; value: string | null; mono?: boolean }[] = [
    { label: 'Contact person', value: a.contact_person },
    { label: 'Email', value: a.email },
    { label: 'Phone', value: a.phone },
    { label: 'Registered legal name', value: a.legal_name },
    { label: 'Registration no.', value: a.registration_no, mono: true },
    { label: 'GST number', value: a.gst_number, mono: true },
    { label: 'PAN number', value: a.pan_number, mono: true },
    { label: 'Registered address', value: a.registered_address },
    { label: 'Description', value: a.description },
    { label: 'Member since', value: fmtDate(a.created_at) },
  ];

  return (
    <Card className="rounded-2xl transition-all duration-200 hover:border-primary/40 hover:shadow-md">
      <CardContent className="space-y-4 py-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <Building2 className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-lg font-semibold">{a.name}</p>
              <p className="text-xs text-muted-foreground">Approved service provider</p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            <Link
              href={`/aevinite/providers/${a.id}/edit`}
              className={buttonVariants({ size: 'sm', variant: 'outline' })}
            >
              Edit
            </Link>
            <ConfirmSubmit
              action={deleteAgencyAction}
              fields={{ agencyId: a.id }}
              triggerLabel="Delete"
              title="Delete this service provider?"
              description={`“${a.name}” will be moved to Deleted Service Providers. You can restore it from there.`}
              confirmLabel="Delete"
              pendingText="Deleting…"
            />
          </div>
        </div>

        <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
          {rows.map((r) => (
            <div
              key={r.label}
              className="flex flex-col gap-0.5 border-b border-border/50 py-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
            >
              <dt className="text-sm text-muted-foreground">{r.label}</dt>
              <dd className={`text-sm sm:max-w-[60%] sm:text-right ${r.mono ? 'font-mono text-xs' : ''}`}>
                {r.value || '—'}
              </dd>
            </div>
          ))}
        </dl>

        <div className="flex flex-wrap gap-3 text-sm">
          {a.permit_doc_url && (
            <a
              href={a.permit_doc_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline-offset-4 hover:underline"
            >
              Transport permit ↗
            </a>
          )}
          {a.fitness_doc_url && (
            <a
              href={a.fitness_doc_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline-offset-4 hover:underline"
            >
              Fitness certificate ↗
            </a>
          )}
        </div>

        <div>
          <p className="mb-1.5 text-sm font-medium">Service areas</p>
          {a.services.length === 0 ? (
            <p className="text-sm text-muted-foreground">No service areas yet.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {a.services.map((s, i) => (
                <span
                  key={`${s.institutionName}-${s.vehicleType}-${i}`}
                  className="rounded-full border border-border bg-muted/50 px-2.5 py-0.5 text-xs"
                >
                  {s.institutionName} · {s.vehicleType === 'VAN' ? 'Van' : 'Bus'}
                </span>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
