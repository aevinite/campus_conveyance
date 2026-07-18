import { createClient as createSbClient } from '@supabase/supabase-js';
import { AgencyRegisterForm } from './agency-register-form';

export default async function AgencyRegisterPage() {
  // Institutions are RLS-restricted, so read them with the service role for this
  // public application form.
  const admin = createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
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
