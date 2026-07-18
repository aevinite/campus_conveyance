import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { updateCollegeAction } from '@/features/admin/actions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CollegeForm } from '../../../college-form';

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

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Edit College</h1>
      <Card>
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
    </section>
  );
}
