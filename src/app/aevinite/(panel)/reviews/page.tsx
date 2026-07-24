import { redirect } from 'next/navigation';
import { Star } from 'lucide-react';
import { listReviews, OPS_PAGE_SIZE } from '@/features/admin/ops-repository';
import { setReviewHiddenAction } from '@/features/admin/ops-actions';
import { DataTable } from '@/components/data-table';
import { StatusBadge } from '@/components/status-badge';
import { Pager, pageParams } from '@/components/pager';
import { SubmitButton } from '@/components/submit-button';
import { StarRating } from '@/components/ui/star-rating';
import { formatDateTime } from '@/lib/format-date';

export const dynamic = 'force-dynamic';

export default async function AdminReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const { page, offset } = pageParams(pageParam, OPS_PAGE_SIZE);
  const { rows, total } = await listReviews({ limit: OPS_PAGE_SIZE, offset });
  const totalPages = Math.max(1, Math.ceil(total / OPS_PAGE_SIZE));
  if (total > 0 && page > totalPages) redirect(`/aevinite/reviews?page=${totalPages}`);

  return (
    <section className="space-y-4">
      <div>
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-primary">
          <Star className="size-3.5" />
          Moderation
        </span>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Agency Reviews</h1>
        <p className="text-muted-foreground">
          Rider reviews across all agencies ({total}). Hide anything abusive — hidden reviews drop
          out of public browsing and the agency&apos;s rating.
        </p>
      </div>
      <DataTable
        headers={['Agency', 'Rating', 'Review', 'Reviewer', 'Status', 'Posted', 'Action']}
        rows={rows.map((r) => [
          <span key="a" className="font-medium">{r.agencyName}</span>,
          <StarRating key="r" value={r.rating} size={14} />,
          <span key="c" className="block max-w-md text-sm text-muted-foreground">
            {r.comment ?? '—'}
          </span>,
          r.reviewer,
          <StatusBadge key="s" value={r.is_hidden ? 'HIDDEN' : 'VISIBLE'} tone={r.is_hidden ? 'red' : 'green'} />,
          formatDateTime(r.created_at),
          <form key="act" action={setReviewHiddenAction}>
            <input type="hidden" name="id" value={r.id} />
            <input type="hidden" name="hide" value={r.is_hidden ? 'false' : 'true'} />
            <SubmitButton
              size="sm"
              variant="outline"
              pendingText={r.is_hidden ? 'Restoring…' : 'Hiding…'}
            >
              {r.is_hidden ? 'Restore' : 'Hide'}
            </SubmitButton>
          </form>,
        ])}
        empty="No reviews yet."
      />
      <Pager page={page} totalPages={totalPages} basePath="/aevinite/reviews" />
    </section>
  );
}
