import { notFound } from 'next/navigation';
import { Building2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { updateCollegeAction } from '@/features/admin/actions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CollegeForm } from '../../../college-form';
import { CampusAdminsPanel, type CampusAdmin } from './campus-admins-panel';

export default async function EditCollegePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const db = await createClient();
  const { data: college } = await db
    .from('institutions')
    .select('id, name, kind, area, city, image_url, description, is_verified')
    .eq('id', id)
    .maybeSingle();
  if (!college) notFound();

  // Campus admins linked to this college — read with the service-role client so
  // it's independent of RLS. (SUPER_ADMIN can read profiles via RLS too, but this
  // keeps the query explicit and consistent.)
  const { data: adminRows } = await createAdminClient()
    .from('profiles')
    .select('id, full_name, email')
    .eq('role', 'INSTITUTION_ADMIN')
    .eq('institution_id', id)
    .order('full_name');
  const admins: CampusAdmin[] = (adminRows ?? []).map((a) => ({
    id: a.id as string,
    name: (a.full_name as string) ?? null,
    email: (a.email as string) ?? null,
  }));

  return (
    <section className="space-y-4">
      <div>
        <span className="text-xs font-semibold uppercase tracking-widest text-primary">Institutions</span>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Edit College</h1>
      </div>
      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle>{college.name as string}</CardTitle>
        </CardHeader>
        <CardContent>
          <CollegeForm
            action={updateCollegeAction}
            submitLabel="Save changes"
            defaults={{
              id: college.id as string,
              name: college.name as string,
              kind: college.kind as string,
              area: college.area as string | null,
              city: college.city as string | null,
              imageUrl: college.image_url as string | null,
              description: college.description as string | null,
              verified: college.is_verified as boolean,
            }}
          />
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="size-4 text-primary" /> Campus admins
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Give this campus its own oversight console. A campus admin signs in at the admin login and manages{' '}
            <span className="font-medium text-foreground">{college.name as string}</span> at{' '}
            <span className="font-mono text-xs">/institution</span>.
          </p>
        </CardHeader>
        <CardContent>
          <CampusAdminsPanel collegeId={college.id as string} admins={admins} />
        </CardContent>
      </Card>
    </section>
  );
}
