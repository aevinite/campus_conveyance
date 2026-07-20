import { redirect } from 'next/navigation';
import Link from 'next/link';
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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Manage College</h1>
        <Link href="/aevinite/add-college" className={buttonVariants({ size: 'sm' })}>
          Add College
        </Link>
      </div>
      {colleges.length === 0 ? (
        <p className="text-muted-foreground">No colleges or schools yet.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {colleges.map((c) => (
            <Card key={c.id} className={cn('overflow-hidden', !c.is_active && 'opacity-75')}>
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
                        'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
                        c.is_active
                          ? 'bg-success/15 text-success'
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
