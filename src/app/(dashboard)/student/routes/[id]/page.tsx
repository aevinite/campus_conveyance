import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/features/auth/guard';
import { createClient } from '@/lib/supabase/server';
import { getRouteWithStops, getAvailability } from '@/features/booking/repository';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { ReserveForm } from './reserve-form';

export default async function RouteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole('STUDENT');
  const { id } = await params;
  const db = await createClient();
  const data = await getRouteWithStops(db, id);
  if (!data) notFound();
  const availability = await getAvailability(db, id);
  const soldOut = availability.available <= 0;

  return (
    <section className="max-w-2xl space-y-6">
      <div>
        <Link href="/student/schools" className="text-sm text-muted-foreground underline">
          ← Back to campuses
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">{data.route.name}</h1>
        <p className="text-sm text-muted-foreground">
          {soldOut ? (
            <span className="text-amber-600">Full — {availability.total} seats taken</span>
          ) : (
            <span className="text-green-600">
              {availability.available} of {availability.total} seats available
            </span>
          )}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Stops</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-1 text-sm">
            {data.stops.map((s) => (
              <li key={s.id} className="flex gap-2">
                <span className="text-muted-foreground">{s.sequence}.</span>
                {s.name}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Reserve a seat</CardTitle>
        </CardHeader>
        <CardContent>
          <ReserveForm routeId={id} stops={data.stops} soldOut={soldOut} />
        </CardContent>
      </Card>
    </section>
  );
}
