import { Star } from 'lucide-react';
import { requireRole } from '@/features/auth/guard';
import { createClient } from '@/lib/supabase/server';
import { getMyAgency } from '@/features/agency/repository';
import { listAgencyReviews, getAgencyRatings } from '@/features/reviews/repository';
import { StarRating } from '@/components/ui/star-rating';
import { Card, CardContent } from '@/components/ui/card';
import { formatCompactDateTime } from '@/lib/format-date';

export default async function AgencyReviewsPage() {
  await requireRole('AGENCY', '/agency/login');
  const db = await createClient();
  const agency = await getMyAgency(db);
  if (!agency) return null;

  const [reviews, ratings] = await Promise.all([
    listAgencyReviews(db, agency.id, { limit: 100 }),
    getAgencyRatings(db, [agency.id]),
  ]);
  const rating = ratings.get(agency.id) ?? { avg: 0, count: 0 };

  return (
    <section className="max-w-3xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-primary">
          What riders say
        </p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">Reviews</h1>
      </div>

      {/* Aggregate */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-3 py-5">
          <div>
            <p className="tnum text-4xl font-bold leading-none">
              {rating.count > 0 ? rating.avg.toFixed(1) : '—'}
            </p>
            <div className="mt-2">
              <StarRating value={rating.avg} size={18} />
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            {rating.count > 0
              ? `Based on ${rating.count} review${rating.count > 1 ? 's' : ''} from riders who booked with you.`
              : 'No reviews yet. Riders can rate you after a confirmed booking.'}
          </p>
        </CardContent>
      </Card>

      {/* List */}
      {reviews.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border py-16 text-center">
          <span className="grid size-12 place-items-center rounded-xl bg-primary/10 text-primary">
            <Star className="size-6" />
          </span>
          <p className="font-semibold">No reviews yet</p>
          <p className="max-w-xs text-sm text-muted-foreground">
            Once riders complete a booking with you, their ratings will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {reviews.map((r) => (
            <Card key={r.id}>
              <CardContent className="space-y-2 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <StarRating value={r.rating} size={15} />
                    <span className="text-sm font-semibold">{r.reviewer}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {formatCompactDateTime(r.created_at)}
                  </span>
                </div>
                {r.comment && (
                  <p className="text-sm leading-relaxed text-muted-foreground">{r.comment}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
