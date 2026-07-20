// Concurrency proof for the booking engine: fire many simultaneous reservations
// at a 2-seat route and assert the counter never overbooks.
//   node scripts/test-booking.mjs
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
process.loadEnvFile(join(root, '.env.local'));

const STUDENT_EMAIL = 'aarav.demo@gmail.com';
const PASSWORD = 'demo-password-123';
const ATTEMPTS = 6;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

const pub = createClient(url, anon, { auth: { persistSession: false } });
const admin = createClient(url, service, { auth: { persistSession: false } });

const { error: sErr } = await pub.auth.signInWithPassword({ email: STUDENT_EMAIL, password: PASSWORD });
if (sErr) throw new Error(`login: ${sErr.message}`);

// Read the seeded route + stops via RLS (student is in the institution).
const { data: route, error: rErr } = await pub.from('routes').select('id, name').limit(1).single();
if (rErr) throw new Error(`read route: ${rErr.message}`);
const { data: stops } = await pub.from('route_stops').select('id, sequence').eq('route_id', route.id).order('sequence');
const pickup = stops[0].id, drop = stops[stops.length - 1].id;

console.log(`Firing ${ATTEMPTS} concurrent reservations at "${route.name}" (2 seats)…`);
const results = await Promise.all(
  Array.from({ length: ATTEMPTS }, () =>
    pub.rpc('reserve_seat', { p_route_id: route.id, p_pickup_stop_id: pickup, p_drop_stop_id: drop })),
);

const bookings = results.filter((r) => !r.error).map((r) => r.data);
// reserve_seat HOLDS a seat as PENDING (the approval-first flow; auto-approve in
// 0040 does not confirm at reserve time — payment does). So a successfully-held
// seat is PENDING, and the overflow is WAITLISTED. (Was asserting CONFIRMED,
// which reserve_seat never returns — a guaranteed false FAIL post-0040.)
const held = bookings.filter((b) => b.status === 'PENDING');
const waitlisted = bookings.filter((b) => b.status === 'WAITLISTED');
const errors = results.filter((r) => r.error);

const { data: alloc } = await admin
  .from('seat_allocations').select('reserved_seats, total_seats').limit(1).single();

console.log(`  held (PENDING): ${held.length}`);
console.log(`  waitlisted:     ${waitlisted.length}`);
console.log(`  errors:         ${errors.length}${errors.length ? ' → ' + errors[0].error.message : ''}`);
console.log(`  reserved_seats in DB: ${alloc.reserved_seats}/${alloc.total_seats}`);

const ok = held.length === 2 && waitlisted.length === ATTEMPTS - 2 &&
  alloc.reserved_seats === 2 && errors.length === 0;
console.log(ok ? '\nPASS: never overbooked; exactly 2 seats held under race.' : '\nFAIL: see counts above.');

// Cleanup: cancel everything so the seed stays at 0 reserved.
for (const b of bookings) {
  await pub.rpc('cancel_booking', { p_booking_id: b.id });
}
const { data: after } = await admin.from('seat_allocations').select('reserved_seats').limit(1).single();
console.log(`cleanup: reserved_seats back to ${after.reserved_seats}`);
process.exitCode = ok ? 0 : 1;
