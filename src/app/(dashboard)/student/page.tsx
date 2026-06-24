import Link from 'next/link';
import { Search, Ticket, ArrowRight } from 'lucide-react';
import { requireRole } from '@/features/auth/guard';
import { createClient } from '@/lib/supabase/server';

export default async function StudentHome() {
  await requireRole('STUDENT');
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  const name =
    (user?.user_metadata as { full_name?: string } | undefined)?.full_name ??
    'there';

  return (
    <div className="space-y-10">
      <section className="relative overflow-hidden rounded-3xl border border-border p-8 sm:p-12">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              'radial-gradient(70% 120% at 100% 0%, oklch(0.83 0.17 85 / 0.22), transparent 60%)',
          }}
        />
        <p className="text-sm text-muted-foreground">Welcome back, {name.split(' ')[0]}</p>
        <h1 className="mt-2 max-w-2xl text-3xl font-bold tracking-tight sm:text-5xl">
          Safe travel, the <span className="text-primary">Campus Conveyance.</span>
        </h1>
        <p className="mt-3 max-w-xl text-muted-foreground">
          Browse your campus, choose a bus or van from a trusted agency, and
          reserve your seat in seconds.
        </p>
      </section>

      <section className="grid gap-5 sm:grid-cols-2">
        <Link
          href="/student/schools"
          className="group flex flex-col gap-3 rounded-2xl border border-primary/40 bg-primary/10 p-6 transition-all hover:-translate-y-1 hover:bg-primary/15"
        >
          <span className="grid size-11 place-items-center rounded-xl bg-primary text-primary-foreground">
            <Search className="size-6" />
          </span>
          <h2 className="text-lg font-semibold">Browse campuses</h2>
          <p className="text-sm text-muted-foreground">
            Find your school or college, pick an agency and reserve a seat.
          </p>
          <span className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-primary">
            Start booking <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </span>
        </Link>

        <Link
          href="/student/bookings"
          className="group flex flex-col gap-3 rounded-2xl border border-border bg-card/60 p-6 transition-all hover:-translate-y-1 hover:bg-card"
        >
          <span className="grid size-11 place-items-center rounded-xl bg-secondary text-foreground">
            <Ticket className="size-6" />
          </span>
          <h2 className="text-lg font-semibold">My bookings</h2>
          <p className="text-sm text-muted-foreground">
            View, track and cancel your reservations.
          </p>
          <span className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-primary">
            View bookings <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </span>
        </Link>
      </section>
    </div>
  );
}
