import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getAgencyDetail } from '@/features/admin/repository';
import { updateAgencyDetailsAction } from '@/features/admin/actions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { AgencyProfileForm } from '@/app/agency/(panel)/account/agency-profile-form';
import { cn } from '@/lib/utils';

export default async function EditProviderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const db = await createClient();
  const agency = await getAgencyDetail(db, id);
  if (!agency) notFound();

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="text-xs font-semibold uppercase tracking-widest text-primary">Providers</span>
          <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Edit Provider</h1>
        </div>
        <Link
          href="/aevinite/providers"
          className={cn(buttonVariants({ size: 'sm', variant: 'outline' }), 'w-full sm:w-auto')}
        >
          Back to providers
        </Link>
      </div>
      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle>{agency.name}</CardTitle>
          <p className="text-sm text-muted-foreground">
            The business &amp; verification details this provider submitted at signup. Changes save
            immediately.
            {agency.email ? ` · Login email: ${agency.email}` : ''}
          </p>
        </CardHeader>
        <CardContent>
          <AgencyProfileForm
            action={updateAgencyDetailsAction}
            agencyId={agency.id}
            submitLabel="Save provider details"
            initial={{
              name: agency.name ?? '',
              contactPerson: agency.contact_person ?? '',
              phone: agency.phone ?? '',
              legalName: agency.legal_name ?? '',
              registrationNo: agency.registration_no ?? '',
              gstNumber: agency.gst_number ?? '',
              panNumber: agency.pan_number ?? '',
              registeredAddress: agency.registered_address ?? '',
              description: agency.description ?? '',
              permitDocUrl: agency.permit_doc_url ?? '',
              fitnessDocUrl: agency.fitness_doc_url ?? '',
            }}
          />
        </CardContent>
      </Card>
    </section>
  );
}
