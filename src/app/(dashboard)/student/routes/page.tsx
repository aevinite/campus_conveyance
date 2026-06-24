import Link from 'next/link';
import { requireRole } from '@/features/auth/guard';
import { createClient } from '@/lib/supabase/server';
import { listRoutes } from '@/features/booking/repository';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

export default async function RoutesPage() {
  await requireRole('STUDENT');
  const db = await createClient();
  const routes = await listRoutes(db);

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Routes</h1>
      {routes.length === 0 ? (
        <p className="text-muted-foreground">
          No routes are available for your institution yet.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {routes.map((r) => (
            <Link key={r.id} href={`/student/routes/${r.id}`}>
              <Card className="transition-colors hover:bg-muted/50">
                <CardHeader>
                  <CardTitle className="text-lg">{r.name}</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  View stops and reserve a seat →
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
