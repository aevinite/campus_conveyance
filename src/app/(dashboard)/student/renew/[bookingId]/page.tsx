import { notFound } from 'next/navigation';
import { requireRole } from '@/features/auth/guard';
import { createClient } from '@/lib/supabase/server';
import { getRenewInfo } from '@/features/booking/renewal-repository';
import { getUpiSettings } from '@/lib/upi-settings';
import { RenewPassPanel } from '@/components/renew-pass-panel';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function StudentRenewPage({ params }: { params: Promise<{ bookingId: string }> }) {
  await requireRole('STUDENT');
  const { bookingId } = await params;
  if (!UUID_RE.test(bookingId)) notFound();
  const db = await createClient();
  const [info, s] = await Promise.all([getRenewInfo(db, bookingId), getUpiSettings()]);
  if (!info) notFound();
  return (
    <RenewPassPanel
      info={info}
      upi={{ vpa: s.vpa, payee: s.payeeName, configured: s.active && !!s.vpa }}
      backHref="/student"
    />
  );
}
