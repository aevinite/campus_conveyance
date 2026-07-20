import { createClient } from '@/lib/supabase/server';
import {
  getMyAgencyProfile,
  listMyServices,
  listMyServiceRequests,
} from '@/features/agency/repository';
import { listInstitutions } from '@/features/catalog/repository';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable } from '@/components/data-table';
import { ChangePasswordForm } from '@/components/profile/change-password-form';
import { EditProfileForm } from '@/components/profile/edit-profile-form';
import { AgencyProfileForm } from './agency-profile-form';
import { ServiceForm } from './service-form';

const fmtDate = (v?: string | null) =>
  v ? new Date(v).toLocaleDateString('en-IN', { dateStyle: 'long' }) : '—';
const fmtDateTime = (v?: string | null) =>
  v ? new Date(v).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'Never';

const STATUS_STYLE: Record<string, string> = {
  PENDING: 'border-warning/40 bg-warning/10 text-warning',
  APPROVED: 'border-success/40 bg-success/10 text-success',
  REJECTED: 'border-destructive/40 bg-destructive/10 text-destructive',
};
const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Awaiting admin',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};

export default async function AgencyAccountPage() {
  const db = await createClient();
  // getUser() and the agency profile are independent — read them in parallel
  // rather than one after the other.
  const [
    {
      data: { user },
    },
    agency,
  ] = await Promise.all([db.auth.getUser(), getMyAgencyProfile(db)]);

  const [profileRes, services, requests, institutions] = await Promise.all([
    user
      ? db.from('profiles').select('full_name, phone, created_at, updated_at').eq('id', user.id).single()
      : Promise.resolve({ data: null }),
    agency ? listMyServices(db, agency.id) : Promise.resolve([]),
    agency ? listMyServiceRequests(db, agency.id) : Promise.resolve([]),
    listInstitutions(db),
  ]);
  const profile = profileRes.data as
    | { full_name: string | null; phone: string | null; created_at: string | null; updated_at: string | null }
    | null;

  const email = user?.email ?? agency?.email ?? '—';
  const loginName =
    profile?.full_name ??
    (user?.user_metadata as { full_name?: string } | undefined)?.full_name ??
    agency?.name ??
    '';
  const loginPhone = profile?.phone ?? agency?.phone ?? '';

  const display = agency?.name || loginName || '—';
  const initials =
    display !== '—'
      ? display.split(' ').map((p: string) => p[0]).slice(0, 2).join('').toUpperCase()
      : 'S';

  const pending = requests.filter((r) => r.status === 'PENDING');
  const history = requests.filter((r) => r.status !== 'PENDING');

  const info: { label: string; value: string; mono?: boolean }[] = [
    { label: 'Role', value: 'Service Provider' },
    { label: 'Approval status', value: STATUS_LABEL[agency?.status ?? ''] ?? agency?.status ?? '—' },
    { label: 'Email status', value: user?.email_confirmed_at ? 'Verified ✓' : 'Not verified' },
    { label: 'Member since', value: fmtDate(agency?.created_at ?? profile?.created_at) },
    { label: 'Last signed in', value: fmtDateTime(user?.last_sign_in_at) },
  ];

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Profile</h1>
        <p className="text-muted-foreground">
          Your account, the details from your application, and your service areas — all editable here.
        </p>
      </div>

      <div className="flex items-center gap-4 rounded-xl border border-border bg-card/40 p-4">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary/15 text-lg font-semibold text-primary">
          {initials}
        </span>
        <div className="min-w-0">
          <p className="truncate text-lg font-medium">{display}</p>
          <p className="truncate text-sm text-muted-foreground">{email} · Service Provider</p>
        </div>
      </div>

      {/* Login account + password */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Login account</CardTitle>
            <p className="text-sm text-muted-foreground">Your sign-in name and phone number.</p>
          </CardHeader>
          <CardContent>
            <EditProfileForm fullName={loginName} phone={loginPhone} email={email} />
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Change password</CardTitle>
            <p className="text-sm text-muted-foreground">
              Enter your current password, then your new password twice to confirm.
            </p>
          </CardHeader>
          <CardContent>
            <ChangePasswordForm />
          </CardContent>
        </Card>
      </div>

      {/* Business & verification details from the application — editable */}
      {agency && (
        <Card>
          <CardHeader>
            <CardTitle>Business &amp; verification details</CardTitle>
            <p className="text-sm text-muted-foreground">
              The details you submitted when applying. Update them here if anything changes.
            </p>
          </CardHeader>
          <CardContent>
            <AgencyProfileForm
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
      )}

      {/* Service areas */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Request a new service area</CardTitle>
            <p className="text-sm text-muted-foreground">
              Want to serve another college/school (e.g. move a service to Delhi Public School)? Submit
              a request with a description — it goes live only after an admin approves it.
            </p>
          </CardHeader>
          <CardContent>
            <ServiceForm institutions={institutions.map((i) => ({ id: i.id, name: i.name }))} />
          </CardContent>
        </Card>

        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Your live services</h2>
          <DataTable
            headers={['Service', 'Type', 'School / College']}
            rows={services.map((s) => [s.name, s.vehicle_type, s.institutionName])}
            empty="No live services yet."
          />
          {pending.length > 0 && (
            <>
              <h3 className="pt-2 text-sm font-semibold text-muted-foreground">Pending requests</h3>
              <div className="space-y-2">
                {pending.map((r) => (
                  <RequestRow key={r.id} r={r} />
                ))}
              </div>
            </>
          )}
          {history.length > 0 && (
            <>
              <h3 className="pt-2 text-sm font-semibold text-muted-foreground">Request history</h3>
              <div className="space-y-2">
                {history.map((r) => (
                  <RequestRow key={r.id} r={r} />
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Read-only account information */}
      <Card>
        <CardHeader>
          <CardTitle>Account information</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-8 gap-y-1 sm:grid-cols-2">
            {info.map((d) => (
              <div key={d.label} className="flex items-center justify-between gap-4 border-b border-border/60 py-2.5">
                <dt className="text-sm text-muted-foreground">{d.label}</dt>
                <dd className={`truncate text-right text-sm font-medium ${d.mono ? 'font-mono text-xs' : ''}`}>
                  {d.value}
                </dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </section>
  );
}

function RequestRow({
  r,
}: {
  r: {
    id: string;
    name: string;
    vehicle_type: string;
    status: string;
    rejected_reason: string | null;
    institutionName: string;
  };
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card/40 p-3">
      <div className="min-w-0">
        <p className="truncate font-medium">
          {r.name} · {r.vehicle_type === 'VAN' ? 'Van' : 'Bus'}
        </p>
        <p className="truncate text-sm text-muted-foreground">
          {r.institutionName}
          {r.status === 'REJECTED' && r.rejected_reason ? ` · Reason: ${r.rejected_reason}` : ''}
        </p>
      </div>
      <span
        className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
          STATUS_STYLE[r.status] ?? 'border-border text-muted-foreground'
        }`}
      >
        {STATUS_LABEL[r.status] ?? r.status}
      </span>
    </div>
  );
}
