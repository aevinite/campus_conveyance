import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, User, Ticket, UsersRound } from 'lucide-react';
import { getStudentDetail } from '@/features/admin/ops-repository';
import { Card, CardContent } from '@/components/ui/card';
import { DataTable } from '@/components/data-table';
import { StatusBadge, BoolBadge } from '@/components/status-badge';
import { formatDateTime } from '@/lib/format-date';

export const dynamic = 'force-dynamic';

function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-border/50 py-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className={`text-sm sm:max-w-[60%] sm:text-right ${mono ? 'font-mono text-xs' : ''}`}>{value || '—'}</dd>
    </div>
  );
}

export default async function AdminStudentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getStudentDetail(id);
  if (!detail) notFound();
  const { profile, student, institutionName, bookings, parents } = detail;

  return (
    <section className="space-y-6">
      <div>
        <Link href="/aevinite/students" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Back to students
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <User className="size-6" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{profile.full_name ?? 'Student'}</h1>
            <p className="text-sm text-muted-foreground">{profile.email ?? '—'}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="rounded-2xl">
          <CardContent className="space-y-3 py-5">
            <h2 className="font-semibold">Account</h2>
            <dl>
              <Field label="Full name" value={profile.full_name} />
              <Field label="Email" value={profile.email} />
              <Field label="Phone" value={profile.phone} />
            </dl>
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardContent className="space-y-3 py-5">
            <h2 className="font-semibold">Details filled by the student</h2>
            {student ? (
              <dl>
                <Field label="Address" value={student.address} />
                <Field label="Class / Year" value={student.grade} />
                <Field label="Guardian name" value={student.guardian_name} />
                <Field label="Guardian phone" value={student.guardian_phone} />
                {student.roll_no && <Field label="Roll no." value={student.roll_no} mono />}
                {institutionName && <Field label="Institution" value={institutionName} />}
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">This student hasn&apos;t filled their travel details yet.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {parents.length > 0 && (
        <div className="space-y-2">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <UsersRound className="size-5 text-primary" /> Linked parents ({parents.length})
          </h2>
          <DataTable
            headers={['Parent', 'Email', 'Phone']}
            rows={parents.map((p, i) => [<span key={i} className="font-medium">{p.name ?? '—'}</span>, p.email ?? '—', p.phone ?? '—'])}
            empty="No parents linked."
          />
        </div>
      )}

      <div className="space-y-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Ticket className="size-5 text-primary" /> Bookings ({bookings.length})
        </h2>
        <DataTable
          headers={['Route', 'Bus', 'Pickup → Drop', 'Status', 'Paid', 'Booked']}
          rows={bookings.map((b) => [
            b.routeName,
            b.busNumber ?? '—',
            <span key="s" className="text-sm">{b.pickupStop} <span className="text-muted-foreground">→</span> {b.dropStop}</span>,
            <StatusBadge key="st" value={b.status} />,
            <BoolBadge key="p" value={b.isPaid} yes="Paid" no="Unpaid" />,
            formatDateTime(b.created_at),
          ])}
          empty="This student has no bookings."
        />
      </div>
    </section>
  );
}
