import { createAdminClient } from '@/lib/supabase/admin';
import { AgencyRegisterForm } from './agency-register-form';

export default async function AgencyRegisterPage() {
  // Institutions are RLS-restricted, so read them with the service role for this
  // public application form. Use the shared server-only admin helper (never build
  // the service-role client inline — a future 'use client' would leak the key).
  const admin = createAdminClient();
  const { data } = await admin
    .from('institutions')
    .select('id, name, kind')
    .eq('is_active', true)
    .order('name');
  const institutions = (data ?? []) as {
    id: string;
    name: string;
    kind: string;
  }[];
  return <AgencyRegisterForm institutions={institutions} />;
}
