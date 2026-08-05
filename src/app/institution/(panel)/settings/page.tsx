import { Settings, BadgeCheck } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { resolveInstitutionId } from '@/features/institution/repository';
import { getInstitution } from '@/features/catalog/repository';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

export default async function InstitutionSettingsPage() {
  const institutionId = await resolveInstitutionId();
  const db = await createClient();
  const campus = institutionId ? await getInstitution(db, institutionId) : null;

  const rows: { label: string; value: React.ReactNode }[] = [
    { label: 'Name', value: campus?.name ?? '—' },
    { label: 'Type', value: campus?.kind === 'SCHOOL' ? 'School' : campus?.kind === 'COLLEGE' ? 'College' : '—' },
    { label: 'Description', value: campus?.description || '—' },
    {
      label: 'Verified',
      value: campus?.is_verified ? (
        <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
          <BadgeCheck className="size-4" /> Verified
        </span>
      ) : (
        'Not verified'
      ),
    },
  ];

  return (
    <section className="space-y-4">
      <div>
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-primary">
          <Settings className="size-3.5" />
          Settings
        </span>
        <h1 className="mt-1 text-2xl font-heading font-bold tracking-tight sm:text-3xl">Campus profile</h1>
        <p className="text-muted-foreground">
          Your campus details as students see them. To change these, contact the platform admin.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{campus?.name ?? 'Your campus'}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="divide-y divide-border">
            {rows.map((r) => (
              <div key={r.label} className="grid grid-cols-1 gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-3 sm:gap-3">
                <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{r.label}</dt>
                <dd className="text-sm sm:col-span-2">{r.value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </section>
  );
}
