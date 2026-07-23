import { AlertTriangle, Settings } from 'lucide-react';
import { getMaintenance } from '@/lib/maintenance';
import { toggleMaintenanceAction } from '@/features/admin/settings-actions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SubmitButton } from '@/components/submit-button';
import { formatDateTime } from '@/lib/format-date';

export default async function AdminSettingsPage() {
  const { enabled, updatedAt } = await getMaintenance();
  const since = updatedAt ? formatDateTime(updatedAt) : null;

  return (
    <section className="space-y-6">
      <div>
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-primary">
          <Settings className="size-3.5" />
          Platform
        </span>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Settings</h1>
        <p className="text-muted-foreground">Platform-wide controls.</p>
      </div>

      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle>Maintenance mode</CardTitle>
          <p className="text-sm text-muted-foreground">
            When on, students, agencies and drivers see a maintenance screen and cannot use the
            app. You (admin) keep full access so you can turn it back off.
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-muted/30 p-4">
            <div className="flex items-center gap-3">
              <span
                className={`inline-flex size-2.5 shrink-0 rounded-full ${enabled ? 'bg-warning' : 'bg-success'}`}
              />
              <div>
                <p className="font-medium">
                  Maintenance mode is {enabled ? 'ON' : 'OFF'}
                </p>
                <p className="text-sm text-muted-foreground">
                  {enabled
                    ? 'The site is currently paused for everyone except admins.'
                    : 'The site is live and accessible to everyone.'}
                  {since && ` · Last changed ${since}`}
                </p>
              </div>
            </div>
          </div>

          {enabled && (
            <p className="flex items-start gap-2 rounded-xl border border-warning/30 bg-[color:var(--warning)]/10 px-3 py-2 text-sm text-foreground">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
              The app is live-blocked right now. Turn maintenance off to restore access for all users.
            </p>
          )}

          <form action={toggleMaintenanceAction}>
            <input type="hidden" name="enabled" value={enabled ? 'false' : 'true'} />
            <SubmitButton
              variant={enabled ? 'default' : 'destructive'}
              pendingText={enabled ? 'Turning off…' : 'Turning on…'}
              className="w-full sm:w-auto"
            >
              {enabled ? 'Turn maintenance OFF' : 'Turn maintenance ON'}
            </SubmitButton>
          </form>
        </CardContent>
      </Card>
    </section>
  );
}
