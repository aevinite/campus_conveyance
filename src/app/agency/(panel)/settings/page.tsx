import { createClient } from '@/lib/supabase/server';
import { getMyAgency } from '@/features/agency/repository';
import { logoutAction } from '@/features/auth/actions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SubmitButton } from '@/components/submit-button';
import { ThemeToggle } from '@/components/theme-toggle';

const STATUS_LABEL: Record<string, string> = {
  APPROVED: 'Approved',
  PENDING: 'Awaiting review',
  REJECTED: 'Rejected',
};

export default async function AgencySettingsPage() {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  const agency = await getMyAgency(db);
  const status = agency?.status ?? 'PENDING';

  return (
    <section className="space-y-6">
      <div>
        <span className="text-xs font-semibold uppercase tracking-widest text-primary">Preferences</span>
        <h1 className="mt-1 text-2xl font-heading font-bold tracking-tight sm:text-3xl">Settings</h1>
        <p className="mt-1 text-muted-foreground">Manage your account preferences.</p>
      </div>

      {/* Appearance */}
      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <p className="text-sm text-muted-foreground">
            Switch between light and dark themes. Your choice is remembered on this device.
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border p-4">
            <div>
              <p className="font-medium">Theme</p>
              <p className="text-sm text-muted-foreground">Toggle light / dark mode.</p>
            </div>
            <ThemeToggle />
          </div>
        </CardContent>
      </Card>

      {/* Account status */}
      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <p className="text-sm text-muted-foreground">
            Your service-provider account details. Contact the platform admin to change verification
            details.
          </p>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-8 gap-y-1 sm:grid-cols-2">
            <Detail label="Provider" value={agency?.name ?? '—'} />
            <Detail label="Email" value={user?.email ?? '—'} />
            <Detail
              label="Approval status"
              value={STATUS_LABEL[status] ?? status}
            />
            {agency?.status === 'REJECTED' && agency.rejected_reason && (
              <Detail label="Rejection reason" value={agency.rejected_reason} />
            )}
          </dl>
        </CardContent>
      </Card>

      {/* Session */}
      <Card>
        <CardHeader>
          <CardTitle>Session</CardTitle>
          <p className="text-sm text-muted-foreground">Sign out of your account on this device.</p>
        </CardHeader>
        <CardContent>
          <form action={logoutAction}>
            <SubmitButton variant="outline" className="w-full sm:w-auto" pendingText="Logging out…">
              Log out
            </SubmitButton>
          </form>
        </CardContent>
      </Card>
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/60 py-2.5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="truncate text-right text-sm font-medium">{value}</dd>
    </div>
  );
}
