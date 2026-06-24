import { requireRole } from '@/features/auth/guard';
import { createClient } from '@/lib/supabase/server';
import { listInstitutions } from '@/features/catalog/repository';
import { CatalogBrowser } from './catalog-browser';

export default async function SchoolsPage() {
  await requireRole('STUDENT');
  const db = await createClient();
  const institutions = await listInstitutions(db);

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Schools &amp; Colleges</h1>
        <p className="text-muted-foreground">
          Pick your campus to see the agencies and routes that serve it.
        </p>
      </div>
      <CatalogBrowser institutions={institutions} />
    </section>
  );
}
