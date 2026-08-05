import { Star } from 'lucide-react';
import { resolveInstitutionId, listCampusAgencyReviews } from '@/features/institution/repository';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDate } from '@/lib/format-date';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

function Stars({ value }: { value: number }) {
  const rounded = Math.round(value);
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value.toFixed(1)} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={cn('size-4', i <= rounded ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/40')}
        />
      ))}
    </span>
  );
}

export default async function InstitutionReviewsPage() {
  const institutionId = await resolveInstitutionId();
  const agencies = institutionId ? await listCampusAgencyReviews(institutionId) : [];

  return (
    <section className="space-y-5">
      <div>
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-primary">
          <Star className="size-3.5" />
          Reviews
        </span>
        <h1 className="mt-1 text-2xl font-heading font-bold tracking-tight sm:text-3xl">Agency reviews</h1>
        <p className="text-muted-foreground">
          How riders rate the agencies serving your campus. Read-only oversight of rider sentiment.
        </p>
      </div>

      {agencies.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border py-14 text-center">
          <span className="grid size-12 place-items-center rounded-xl bg-primary/10 text-primary">
            <Star className="size-6" />
          </span>
          <p className="font-medium">No agencies to review yet</p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {agencies.map((a) => (
            <Card key={a.agencyId}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-3">
                  <span className="truncate">{a.agencyName}</span>
                  <span className="flex shrink-0 items-center gap-2 text-sm font-normal">
                    <Stars value={a.ratingAvg} />
                    <span className="tnum text-muted-foreground">
                      {a.ratingAvg > 0 ? a.ratingAvg.toFixed(1) : '—'} ({a.ratingCount})
                    </span>
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {a.reviews.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No reviews yet.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {a.reviews.map((r) => (
                      <li key={r.id} className="py-3 first:pt-0 last:pb-0">
                        <div className="flex items-center justify-between gap-3">
                          <Stars value={r.rating} />
                          <span className="text-xs text-muted-foreground">
                            {r.created_at ? formatDate(r.created_at) : ''}
                          </span>
                        </div>
                        {r.comment && <p className="mt-1 text-sm">{r.comment}</p>}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
