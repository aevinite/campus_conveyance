import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSessionRole } from '@/features/auth/session';
import { logoutAction } from '@/features/auth/actions';
import { Logo } from '@/components/brand';
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
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/80 px-6 py-3 backdrop-blur">
        <Logo href="/student" />
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-muted-foreground">
            {role}
          </span>
          <form action={logoutAction}>
            <Button type="submit" variant="outline" size="sm">
              Log out
            </Button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-6">{children}</main>
    </div>
  );
}
