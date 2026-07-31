import { AlertTriangle, Globe, Settings, Smartphone, IndianRupee } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { getMaintenance } from '@/lib/maintenance';
import { getUpiSettings } from '@/lib/upi-settings';
import { toggleMaintenanceAction } from '@/features/admin/settings-actions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SubmitButton } from '@/components/submit-button';
import { formatDateTime } from '@/lib/format-date';
import { UpiSettingsForm } from './upi-settings-form';

function MaintenanceToggle({
  target,
  title,
  icon: Icon,
  audience,
  enabled,
}: {
  target: 'website' | 'app';
  title: string;
  icon: LucideIcon;
  audience: string;
  enabled: boolean;
}) {
  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="size-5 text-primary" />
          {title}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          When on, {audience} see a maintenance screen and cannot use it. You (admin) keep full
          access so you can turn it back off.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-muted/30 p-4">
          <div className="flex items-center gap-3">
            <span
              className={`inline-flex size-2.5 shrink-0 rounded-full ${enabled ? 'bg-warning' : 'bg-success'}`}
            />
            <div>
              <p className="font-medium">{title} is {enabled ? 'ON' : 'OFF'}</p>
              <p className="text-sm text-muted-foreground">
                {enabled
                  ? `Paused for ${audience} except admins.`
                  : `Live and accessible to ${audience}.`}
              </p>
            </div>
          </div>
        </div>

        {enabled && (
          <p className="flex items-start gap-2 rounded-xl border border-warning/30 bg-[color:var(--warning)]/10 px-3 py-2 text-sm text-foreground">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
            This audience is blocked right now. Turn it off to restore access.
          </p>
        )}

        <form action={toggleMaintenanceAction}>
          <input type="hidden" name="target" value={target} />
          <input type="hidden" name="enabled" value={enabled ? 'false' : 'true'} />
          <SubmitButton
            variant={enabled ? 'default' : 'destructive'}
            pendingText={enabled ? 'Turning off…' : 'Turning on…'}
            className="w-full sm:w-auto"
          >
            {enabled ? `Turn ${title} OFF` : `Turn ${title} ON`}
          </SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}

export default async function AdminSettingsPage() {
  const [{ website, app, updatedAt }, upi] = await Promise.all([
    getMaintenance(),
    getUpiSettings(),
  ]);
  const since = updatedAt ? formatDateTime(updatedAt) : null;

  return (
    <section className="space-y-6">
      <div>
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-primary">
          <Settings className="size-3.5" />
          Platform
        </span>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Settings</h1>
        <p className="text-muted-foreground">
          Pause the website and the mobile app independently.
          {since && ` · Last changed ${since}`}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <MaintenanceToggle
          target="website"
          title="Website maintenance"
          icon={Globe}
          audience="browser visitors"
          enabled={website}
        />
        <MaintenanceToggle
          target="app"
          title="App maintenance"
          icon={Smartphone}
          audience="mobile app users"
          enabled={app}
        />
      </div>

      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <IndianRupee className="size-5 text-primary" />
            UPI payments
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            The single UPI account families pay into. After a rider submits their UPI
            reference (UTR), verify it in{' '}
            <span className="font-medium text-foreground">Payments</span> to confirm the seat.
          </p>
        </CardHeader>
        <CardContent>
          <UpiSettingsForm vpa={upi.vpa} payeeName={upi.payeeName} active={upi.active} />
        </CardContent>
      </Card>
    </section>
  );
}
