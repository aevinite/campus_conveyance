import { requireRole } from '@/features/auth/guard';
import { createClient } from '@/lib/supabase/server';
import { HelpSupport } from '@/components/help-support';

export default async function StudentHelpPage() {
  await requireRole('STUDENT');
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  const { data: profile } = user
    ? await db.from('profiles').select('full_name').eq('id', user.id).single()
    : { data: null };

  return (
    <section>
      <HelpSupport role="student" name={profile?.full_name ?? ''} email={user?.email ?? ''} />
    </section>
  );
}
