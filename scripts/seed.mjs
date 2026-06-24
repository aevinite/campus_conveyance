// Seeds the marketplace catalog: schools/colleges, agencies, and each agency's
// bus/van services (vehicle + route + stops + seat allocation) at a campus.
// Re-runnable: wipes catalog rows first. Bookings/students are cascaded.
//   node scripts/seed.mjs
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
process.loadEnvFile(join(root, '.env.local'));

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const must = (error, label) => {
  if (error) throw new Error(`${label}: ${error.message}`);
};
const ins = async (table, row) => {
  const { data, error } = await db.from(table).insert(row).select().single();
  must(error, `insert ${table}`);
  return data;
};

// Wipe existing catalog (cascades to routes/vehicles/bookings/etc.).
await db.from('agencies').delete().neq('id', '00000000-0000-0000-0000-000000000000');
await db.from('institutions').delete().neq('id', '00000000-0000-0000-0000-000000000000');

const agencies = {};
for (const a of [
  { name: 'Bhagwati Travels', phone: '+91 98250 11111', description: 'Trusted school & college bus operator since 2009. Punctual, GPS-tracked fleet.' },
  { name: 'Dev Travels', phone: '+91 98250 22222', description: 'Premium vans and minibuses with trained drivers and live tracking.' },
  { name: 'Sahyog Transport', phone: '+91 98250 33333', description: 'Affordable, reliable campus transport across the city.' },
]) {
  agencies[a.name] = await ins('agencies', { ...a, email: `${a.name.split(' ')[0].toLowerCase()}@demo.test`, gst_number: '24ABCDE1234F1Z5', pan_number: 'ABCDE1234F' });
}

const institutions = {};
for (const i of [
  { name: 'LJ University', slug: 'lj-university', kind: 'COLLEGE', description: 'A leading university campus with daily transport across the city.' },
  { name: 'Silver Oak University', slug: 'silver-oak-university', kind: 'COLLEGE', description: 'Engineering and management campus served by multiple agencies.' },
  { name: 'Shanti Asiatic School', slug: 'shanti-asiatic-school', kind: 'SCHOOL', description: 'K-12 school with safe, supervised bus and van routes.' },
  { name: 'Vedant Public School', slug: 'vedant-public-school', kind: 'SCHOOL', description: 'Neighbourhood school with door-to-door van service.' },
  { name: 'Delhi Public School', slug: 'delhi-public-school', kind: 'SCHOOL', description: 'Large campus with an extensive bus network.' },
]) {
  institutions[i.name] = await ins('institutions', { ...i, contact_email: `office@${i.slug}.test` });
}

// One agency service at a campus = vehicle + route + 3 stops + assignment + seats.
async function service(instName, agencyName, type, routeName, seats, stops) {
  const inst = institutions[instName];
  const agency = agencies[agencyName];
  const vehicle = await ins('vehicles', {
    institution_id: inst.id, agency_id: agency.id, vehicle_type: type,
    registration_no: `GJ-01-${Math.floor(1000 + Math.random() * 9000)}`,
    capacity: seats, model: type === 'BUS' ? 'Tata Starbus' : 'Force Traveller',
  });
  const route = await ins('routes', {
    institution_id: inst.id, agency_id: agency.id, vehicle_type: type, name: routeName,
  });
  const stopRows = stops.map((name, idx) => ({
    institution_id: inst.id, route_id: route.id, name, sequence: idx + 1,
  }));
  must((await db.from('route_stops').insert(stopRows)).error, 'insert stops');
  const assignment = await ins('route_assignments', {
    institution_id: inst.id, route_id: route.id, vehicle_id: vehicle.id,
  });
  await ins('seat_allocations', {
    institution_id: inst.id, route_assignment_id: assignment.id,
    total_seats: seats, reserved_seats: 0,
  });
}

await service('LJ University', 'Bhagwati Travels', 'BUS', 'Bus Route A — North City', 40, ['Central Station', 'Tech Park', 'LJ Campus Gate']);
await service('LJ University', 'Bhagwati Travels', 'BUS', 'Bus Route B — West City', 40, ['Riverside', 'Market Square', 'LJ Campus Gate']);
await service('LJ University', 'Dev Travels', 'VAN', 'Van Route 1 — Old Town', 12, ['Old Town', 'Museum Road', 'LJ Campus Gate']);
await service('Silver Oak University', 'Dev Travels', 'BUS', 'Bus Route — Ring Road', 45, ['Ring Road', 'IT Circle', 'Silver Oak Gate']);
await service('Shanti Asiatic School', 'Bhagwati Travels', 'BUS', 'Morning Bus — Sector 7', 35, ['Sector 7', 'Sector 12', 'Shanti School']);
await service('Shanti Asiatic School', 'Sahyog Transport', 'VAN', 'Van — Green Park', 10, ['Green Park', 'Lake View', 'Shanti School']);
await service('Vedant Public School', 'Sahyog Transport', 'BUS', 'Bus — East Line', 30, ['East Gate', 'City Mall', 'Vedant School']);
await service('Delhi Public School', 'Bhagwati Travels', 'BUS', 'Bus — Airport Road', 50, ['Airport Road', 'Civil Lines', 'DPS Campus']);

console.log('Marketplace seed complete:');
console.log('  institutions:', Object.keys(institutions).length);
console.log('  agencies:', Object.keys(agencies).length);
console.log('  services created across campuses.');
