import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendBookingConfirmationEmail } from '@/lib/mailer';
import { planPrice, periodSuffix, type BillingPeriod } from '@/lib/billing';

const METHOD_LABELS: Record<string, string> = {
  UPI: 'UPI',
  CARD: 'Credit / Debit card',
  NETBANKING: 'Net banking',
};

const inr = (cents: number | null) =>
  cents == null || cents === 0
    ? null
    : `₹${Math.round(cents / 100).toLocaleString('en-IN')}`;

// "HH:MM:SS" → "7:30 AM"
function fmtTime(t: string | null): string | null {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/**
 * Send the booking-confirmed email for a just-paid booking. Reads with the
 * service-role client (the caller's RPC already proved ownership) and is
 * strictly best-effort: any failure is logged, never surfaced — a mail hiccup
 * must not undo or block a completed payment.
 */
export async function sendBookingConfirmedEmail(
  bookingId: string,
  method: string,
): Promise<void> {
  try {
    const db = createAdminClient();
    const { data: b } = await db
      .from('bookings')
      .select(
        `id, status, student_name, student_email, paid_at, pickup_stop_id, billing_period,
         routes(name, price_cents, price_monthly_cents, price_semester_cents, price_yearly_cents, departure_time,
           institutions(name),
           vehicles(bus_number, bus_model, registration_no, is_ac,
                    driver_name, driver_phone, conductor_name, conductor_phone),
           agencies(name))`,
      )
      .eq('id', bookingId)
      .maybeSingle();
    if (!b || b.status !== 'CONFIRMED' || !b.student_email) return;

    const one = <T,>(v: T | T[] | null | undefined): T | null =>
      (Array.isArray(v) ? v[0] : v) ?? null;
    type VehicleRef = {
      bus_number: string | null;
      bus_model: string | null;
      registration_no: string | null;
      is_ac: boolean | null;
      driver_name: string | null;
      driver_phone: string | null;
      conductor_name: string | null;
      conductor_phone: string | null;
    };
    type RouteRef = {
      name: string | null;
      price_cents: number | null;
      price_monthly_cents: number | null;
      price_semester_cents: number | null;
      price_yearly_cents: number | null;
      departure_time: string | null;
      institutions: { name: string | null } | { name: string | null }[] | null;
      vehicles: VehicleRef | VehicleRef[] | null;
      agencies: { name: string | null } | { name: string | null }[] | null;
    };
    const route = one(b.routes as unknown as RouteRef | RouteRef[] | null);
    // Charge/display the plan the booking was made under (fall back to the flat fare).
    const period = ((b.billing_period as string) ?? null) as BillingPeriod | null;
    const fareCents = route ? planPrice(route, period) ?? route.price_cents : null;
    const fareLabel = inr(fareCents);
    const vehicle = one(route?.vehicles ?? null);
    const institution = one(route?.institutions ?? null);
    const agency = one(route?.agencies ?? null);

    let pickupName: string | null = null;
    if (b.pickup_stop_id) {
      const { data: stop } = await db
        .from('route_stops')
        .select('name')
        .eq('id', b.pickup_stop_id)
        .maybeSingle();
      pickupName = (stop?.name as string) ?? null;
    }

    await sendBookingConfirmationEmail(b.student_email as string, {
      studentName: (b.student_name as string) ?? null,
      institutionName: institution?.name ?? null,
      routeName: route?.name ?? null,
      busNumber: vehicle?.bus_number ?? null,
      busModel: vehicle?.bus_model ?? null,
      isAc: vehicle?.is_ac ?? null,
      registrationNo: vehicle?.registration_no ?? null,
      driverName: vehicle?.driver_name ?? null,
      driverPhone: vehicle?.driver_phone ?? null,
      conductorName: vehicle?.conductor_name ?? null,
      conductorPhone: vehicle?.conductor_phone ?? null,
      agencyName: agency?.name ?? null,
      pickupName,
      departureTime: fmtTime((route?.departure_time as string) ?? null),
      fare: fareLabel ? `${fareLabel}${periodSuffix(period)}` : null,
      methodLabel: METHOD_LABELS[method] ?? method,
      paidAt: b.paid_at
        ? new Intl.DateTimeFormat('en-IN', {
            dateStyle: 'medium',
            timeStyle: 'short',
            timeZone: 'Asia/Kolkata',
          }).format(new Date(b.paid_at as string))
        : null,
      bookingRef: (b.id as string).slice(0, 8).toUpperCase(),
    });
  } catch (e) {
    // Best-effort: the seat is confirmed regardless — but log it, otherwise a
    // broken SMTP credential is invisible.
    console.error('Booking-confirmation email failed to send:', e);
  }
}
