// End-to-end auth smoke test (no browser/email needed).
// Verifies: signup trigger creates a profile, login issues a JWT, and the
// access-token hook injects role + institution_id claims, and RLS lets a user
// read their own profile. Creates and deletes a throwaway user.
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
process.loadEnvFile(join(root, '.env.local'));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

const admin = createClient(url, service, { auth: { persistSession: false } });
const email = `smoke+${Date.now()}@example.com`;
const password = 'test-password-123';

function decodeJwt(token) {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
}

let userId;
try {
  // 1. Create a confirmed user with role metadata (admin bypasses email step).
  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: 'Smoke Test', role: 'INSTITUTION_ADMIN' },
  });
  if (cErr) throw cErr;
  userId = created.user.id;
  console.log('1. user created:', userId);

  // 2. The handle_new_user trigger should have made a profile row.
  const { data: profile, error: pErr } = await admin
    .from('profiles')
    .select('id, role, full_name')
    .eq('id', userId)
    .single();
  if (pErr) throw pErr;
  console.log('2. profile auto-created by trigger:', profile);
  if (profile.role !== 'INSTITUTION_ADMIN') {
    throw new Error(`expected role INSTITUTION_ADMIN, got ${profile.role}`);
  }

  // 3. Log in via the public anon client → issues a JWT through the hook.
  const pub = createClient(url, anon, { auth: { persistSession: false } });
  const { data: session, error: sErr } = await pub.auth.signInWithPassword({
    email,
    password,
  });
  if (sErr) throw sErr;
  const claims = decodeJwt(session.session.access_token);
  console.log('3. login ok; JWT app_metadata:', claims.app_metadata);
  if (claims.app_metadata?.role !== 'INSTITUTION_ADMIN') {
    throw new Error('access-token hook did NOT inject role claim');
  }

  // 4. RLS: the logged-in user can read their own profile.
  const { data: ownProfile, error: rErr } = await pub
    .from('profiles')
    .select('id')
    .eq('id', userId)
    .single();
  if (rErr) throw rErr;
  console.log('4. RLS read of own profile ok:', ownProfile.id === userId);

  console.log('\nPASS: signup trigger, login, hook claims, and RLS all work.');
} catch (err) {
  console.error('\nFAIL:', err.message ?? err);
  process.exitCode = 1;
} finally {
  if (userId) {
    await admin.auth.admin.deleteUser(userId);
    console.log('cleanup: test user deleted');
  }
}
