// Seeds a demo institution with one route (3 stops), a vehicle, an assignment,
// and a 2-seat allocation, then links the test student to the institution.
// Re-runnable: deletes the demo institution (cascade) and recreates it.
//
//   node scripts/seed.mjs
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
process.loadEnvFile(join(root, '.env.local'));

const STUDENT_EMAIL = 'aarav.demo@gmail.com';
const SLUG = 'demo-institute';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const must = (error, label) => {
  if (error) throw new Error(`${label}: ${error.message}`);
};

// Find the test student's auth user id.
const { data: list, error: lErr } = await db.auth.admin.listUsers({ perPage: 200 });
must(lErr, 'listUsers');
const student = list.users.find((u) => u.email === STUDENT_EMAIL);
if (!student) {
  throw new Error(`Register ${STUDENT_EMAIL} in the app first, then re-run.`);
}

// Reset: delete any existing demo institution (cascades to its data).
const { data: existing } = await db.from('institutions').select('id').eq('slug', SLUG).maybeSingle();
if (existing) {
  must((await db.from('institutions').delete().eq('id', existing.id)).error, 'delete inst');
}

// Institution
const { data: inst, error: iErr } = await db
  .from('institutions')
  .insert({ name: 'Demo Institute', slug: SLUG, contact_email: 'admin@demo.test' })
  .select()
  .single();
must(iErr, 'insert institution');

// Link the student profile to the institution + create a students row.
must((await db.from('profiles').update({ institution_id: inst.id }).eq('id', student.id)).error, 'link profile');
const { data: studentRow, error: sErr } = await db
  .from('students')
  .insert({ institution_id: inst.id, profile_id: student.id, roll_no: 'S-001', grade: '10' })
  .select()
  .single();
must(sErr, 'insert student');

// Vehicle (capacity 2 so "full" is easy to test)
const { data: vehicle, error: vErr } = await db
  .from('vehicles')
  .insert({ institution_id: inst.id, registration_no: 'KA-01-DEMO', capacity: 2, model: 'Demo Bus' })
  .select()
  .single();
must(vErr, 'insert vehicle');

// Route + 3 stops
const { data: route, error: rErr } = await db
  .from('routes')
  .insert({ institution_id: inst.id, name: 'Route A — City Center' })
  .select()
  .single();
must(rErr, 'insert route');

const stops = [
  { name: 'Central Station', lat: 12.9716, lng: 77.5946, sequence: 1 },
  { name: 'Tech Park', lat: 12.9352, lng: 77.6245, sequence: 2 },
  { name: 'Demo Campus', lat: 12.9081, lng: 77.6476, sequence: 3 },
].map((s) => ({ ...s, institution_id: inst.id, route_id: route.id }));
must((await db.from('route_stops').insert(stops)).error, 'insert stops');

// Assignment + seat allocation
const { data: assignment, error: aErr } = await db
  .from('route_assignments')
  .insert({ institution_id: inst.id, route_id: route.id, vehicle_id: vehicle.id })
  .select()
  .single();
must(aErr, 'insert assignment');

must((await db.from('seat_allocations').insert({
  institution_id: inst.id,
  route_assignment_id: assignment.id,
  total_seats: 2,
  reserved_seats: 0,
}).select().single()).error, 'insert seat_allocation');

console.log('Seed complete:');
console.log('  institution:', inst.id);
console.log('  route:', route.id, '(', route.name, ')');
console.log('  student linked:', studentRow.id);
console.log('  seats: 2');
console.log(`\nNote: ${STUDENT_EMAIL} must log in again to pick up the institution claim.`);
