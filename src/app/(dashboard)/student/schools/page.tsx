import { requireRole } from '@/features/auth/guard';
import { createClient } from '@/lib/supabase/server';
import { listInstitutions } from '@/features/catalog/repository';
import { BookingSteps } from '../booking-steps';
import { CatalogBrowser } from './catalog-browser';

export default async function SchoolsPage() {
  await requireRole('STUDENT');
  const db = await createClient();
  const institutions = await listInstitutions(db);

  return (
    <section className="space-y-6">
      <div className="space-y-4">
        <BookingSteps active={1} />
        <div>
          <h1 className="text-2xl font-semibold">Pick your campus</h1>
          <p className="text-muted-foreground">
            Choose your school or college — you&apos;ll see every bus and van that
            goes there next.
          </p>
        </div>
      </div>
      <CatalogBrowser institutions={institutions} />
    </section>
  );
}
