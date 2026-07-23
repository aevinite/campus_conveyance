import { redirect } from 'next/navigation';
import Link from 'next/link';
import { School } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { listColleges, ADMIN_PAGE_SIZE } from '@/features/admin/repository';
import { deleteCollegeAction, toggleCollegeAction } from '@/features/admin/actions';
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
