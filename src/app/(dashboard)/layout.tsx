import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSessionRole } from '@/features/auth/session';
import { logoutAction } from '@/features/auth/actions';
import { Button } from '@/components/ui/button';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect('/login');
  const role = (await getSessionRole(db)) ?? 'STUDENT';
  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <span className="font-semibold">Campus Conveyance</span>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">{role}</span>
          <form action={logoutAction}>
            <Button type="submit" variant="outline" size="sm">
              Log out
            </Button>
          </form>
        </div>
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}
