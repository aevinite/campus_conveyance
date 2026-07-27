import { requireRole } from '@/features/auth/guard';
import { createClient } from '@/lib/supabase/server';
import { listMyRideHistory } from '@/features/history/repository';
import { RideHistory } from '@/components/ride-history';

export default async function ParentHistoryPage() {
  await requireRole('PARENT');
  const db = await createClient();
  const rows = await listMyRideHistory(db);

  return (
    <section className="max-w-2xl space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-primary">
          Your children&apos;s rides
        </p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">Trip History</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every ride your linked children have taken — with the date and time they boarded, newest first.
        </p>
      </div>
      <RideHistory rows={rows} />
    </section>
  );
}
