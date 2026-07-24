import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, IdCard } from 'lucide-react';
import { getDriverDetail } from '@/features/admin/ops-repository';
import { Card, CardContent } from '@/components/ui/card';
import { DataTable } from '@/components/data-table';
import { StatusBadge, BoolBadge } from '@/components/status-badge';
import { formatDateTime, formatDateMedium } from '@/lib/format-date';
import { relativeTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

const s = (v: unknown): string | null => (v == null || v === '' ? null : String(v));

function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-border/50 py-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className={`text-sm sm:max-w-[60%] sm:text-right ${mono ? 'font-mono text-xs' : ''}`}>{value || '—'}</dd>
    </div>
  );
}

export default async function AdminDriverDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getDriverDetail(id);
  if (!detail) notFound();
  const { driver: d, name, email, phone, agencyName, vehicle, isOnline, lastPing, changes } = detail;

  return (
    <section className="space-y-6">
      <div>
        <Link href="/aevinite/drivers" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Back to drivers
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <IdCard className="size-6" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{name ?? 'Driver'}</h1>
            <p className="text-sm text-muted-foreground">
              {agencyName} · <StatusBadge value={isOnline ? 'Online' : 'Offline'} />
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="rounded-2xl">
          <CardContent className="space-y-3 py-5">
            <h2 className="font-semibold">Account</h2>
            <dl>
              <Field label="Full name" value={name} />
              <Field label="Login email" value={email} />
              <Field label="Phone" value={phone} />
              <Field label="Status" value={<BoolBadge value={!!d.is_active} yes="Active" no="Inactive" />} />
              <Field label="Assigned bus" value={vehicle ? (vehicle.bus_number ?? vehicle.registration_no) : null} />
              <Field label="Last GPS ping" value={lastPing ? `${formatDateTime(lastPing)} (${relativeTime(lastPing)})` : null} />
            </dl>
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardContent className="space-y-3 py-5">
            <h2 className="font-semibold">KYC entered by the provider</h2>
            <dl>
              <Field label="Licence no." value={s(d.license_no)} mono />
              <Field label="Aadhaar / ID no." value={s(d.aadhaar_no)} mono />
              <Field label="Date of birth" value={formatDateMedium(s(d.dob))} />
              <Field label="Blood group" value={s(d.blood_group)} />
              <Field label="Alternate / emergency phone" value={s(d.alt_phone)} />
              <Field label="Home address" value={s(d.address)} />
            </dl>
          </CardContent>
        </Card>
      </div>

      {changes.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">Assignment change history</h2>
          <DataTable
            headers={['Name', 'Phone', 'Role', 'Reason', 'Effective', 'Recorded']}
            rows={changes.map((c) => [
              c.driver_name ?? '—',
              c.driver_phone ?? '—',
              c.role ?? '—',
              c.reason ?? '—',
              formatDateMedium(c.effective_date),
              formatDateMedium(c.created_at),
            ])}
            empty="No changes recorded."
          />
        </div>
      )}
    </section>
  );
}
