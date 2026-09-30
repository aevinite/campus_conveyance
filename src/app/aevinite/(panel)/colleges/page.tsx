import { redirect } from 'next/navigation';
import Link from 'next/link';
import { School, Clock, Mail, Phone } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { listColleges, listPendingCampusApplications, ADMIN_PAGE_SIZE } from '@/features/admin/repository';
import {
  deleteCollegeAction,
  toggleCollegeAction,
  approveCampusApplicationAction,
  rejectCampusApplicationAction,
} from '@/features/admin/actions';
import { Card, CardContent } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { SubmitButton } from '@/components/submit-button';
import { ConfirmSubmit } from '@/components/confirm-submit';
import { VerifiedBadge } from '@/components/verified-badge';
import { Pager, pageParams } from '@/components/pager';
import { cn } from '@/lib/utils';

export default async function ManageCollegePage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const { page, offset } = pageParams(pageParam, ADMIN_PAGE_SIZE);
  const db = await createClient();
  const { rows: colleges, total } = await listColleges(db, { limit: ADMIN_PAGE_SIZE, offset });
  const totalPages = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));
  if (total > 0 && page > totalPages) redirect(`/aevinite/colleges?page=${totalPages}`);
  // Self-registered campuses awaiting review — only shown on the first page.
  const pending = page === 1 ? await listPendingCampusApplications() : [];

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-primary">
            <School className="size-3.5" />
            Institutions
          </span>
          <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Manage College</h1>
        </div>
        <Link href="/aevinite/add-college" className={cn(buttonVariants({ size: 'sm' }), 'w-full sm:w-auto')}>
          Add College
        </Link>
      </div>

      {pending.length > 0 && (
        <div className="space-y-3 rounded-2xl border border-primary/30 bg-primary/[0.04] p-4">
          <div className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary">
              <Clock className="size-4" />
            </span>
            <div>
              <h2 className="text-sm font-semibold">Pending campus applications</h2>
              <p className="text-xs text-muted-foreground">
                Schools / colleges that registered themselves. Approve to make them live &amp; visible, or reject.
              </p>
            </div>
            <span className="ml-auto rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
              {pending.length}
            </span>
          </div>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {pending.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    {p.name}
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">
                      {p.kind === 'COLLEGE' ? 'College / University' : 'School'}
                    </span>
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    {(p.city || p.area) && <span>{[p.area, p.city].filter(Boolean).join(', ')}</span>}
                    {p.adminEmail && (
                      <span className="inline-flex items-center gap-1">
                        <Mail className="size-3" />
                        {p.adminName ? `${p.adminName} · ` : ''}{p.adminEmail}
                      </span>
                    )}
                    {p.adminPhone && (
                      <span className="inline-flex items-center gap-1">
                        <Phone className="size-3" />
                        {p.adminPhone}
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <form action={approveCampusApplicationAction}>
                    <input type="hidden" name="id" value={p.id} />
                    <SubmitButton size="sm" pendingText="Approving…">
                      Approve
                    </SubmitButton>
                  </form>
                  <ConfirmSubmit
                    action={rejectCampusApplicationAction}
                    fields={{ id: p.id }}
                    triggerLabel="Reject"
                    triggerVariant="outline"
                    title="Reject this campus application?"
                    description={`“${p.name}” will be moved to Deleted Colleges and its admin login deactivated. You can restore it later.`}
                    confirmLabel="Reject"
                    pendingText="Rejecting…"
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {colleges.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border py-16 text-center">
          <span className="grid size-12 place-items-center rounded-xl bg-primary/10 text-primary">
            <School className="size-6" />
          </span>
          <div>
            <p className="font-medium">No colleges or schools yet</p>
            <p className="text-sm text-muted-foreground">Add one to get started.</p>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {colleges.map((c) => (
            <Card
              key={c.id}
              className={cn(
                'overflow-hidden rounded-2xl transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md',
                !c.is_active && 'opacity-75',
              )}
            >
              {c.image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.image_url} alt={c.name} className="h-32 w-full object-cover" />
              )}
              <CardContent className="space-y-2 py-4">
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="flex items-center gap-1.5 font-medium">
                      {c.name}
                      <VerifiedBadge verified={c.is_verified} />
                    </p>
                    <span
                      className={cn(
                        'shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold',
                        c.is_active
                          ? 'bg-[color:var(--success)]/12 text-success'
                          : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {c.is_active ? 'Visible' : 'Hidden'}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {c.kind === 'COLLEGE' ? 'College / University' : 'School'}
                    {c.city ? ` · ${c.city}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link
                    href={`/aevinite/colleges/${c.id}/edit`}
                    className={buttonVariants({ size: 'sm', variant: 'outline' })}
                  >
                    Edit
                  </Link>
                  <form action={toggleCollegeAction}>
                    <input type="hidden" name="id" value={c.id} />
                    <input type="hidden" name="active" value={c.is_active ? 'false' : 'true'} />
                    <SubmitButton
                      size="sm"
                      variant={c.is_active ? 'secondary' : 'default'}
                      pendingText={c.is_active ? 'Disabling…' : 'Enabling…'}
                    >
                      {c.is_active ? 'Disable' : 'Enable'}
                    </SubmitButton>
                  </form>
                  <ConfirmSubmit
                    action={deleteCollegeAction}
                    fields={{ id: c.id }}
                    triggerLabel="Delete"
                    title="Delete this college?"
                    description={`“${c.name}” will be moved to Deleted Colleges and hidden from students. You can restore it from there — nothing is erased.`}
                    confirmLabel="Delete"
                    pendingText="Deleting…"
                  />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <Pager page={page} totalPages={totalPages} basePath="/aevinite/colleges" />
    </section>
  );
}
