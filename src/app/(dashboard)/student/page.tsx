import Link from 'next/link';
import { requireRole } from '@/features/auth/guard';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

export default async function StudentDashboard() {
  await requireRole('STUDENT');
  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Student Dashboard</h1>
        <p className="text-muted-foreground">
          Book a seat on your campus routes and manage your trips.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/student/routes">
          <Card className="transition-colors hover:bg-muted/50">
            <CardHeader>
              <CardTitle className="text-lg">Browse routes</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Find a route, pick your stops and reserve a seat.
            </CardContent>
          </Card>
        </Link>
        <Link href="/student/bookings">
          <Card className="transition-colors hover:bg-muted/50">
            <CardHeader>
              <CardTitle className="text-lg">My bookings</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              View and cancel your reservations.
            </CardContent>
          </Card>
        </Link>
      </div>
    </section>
  );
}
