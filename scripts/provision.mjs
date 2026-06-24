// Provisions the Supabase project from the local repo:
//   1. runs every SQL file in supabase/migrations (in order)
//   2. enables the custom access-token hook + sets auth URLs
// Requires SUPABASE_ACCESS_TOKEN (a Personal Access Token, sbp_...) and
// SUPABASE_PROJECT_REF in .env.local.
//
// Run with:  npm run db:provision
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

// Load .env.local (Node 24+).
try {
  process.loadEnvFile(join(root, '.env.local'));
} catch {
  // ignore — env may already be set in the shell
}

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const REF = process.env.SUPABASE_PROJECT_REF;
const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
const API = 'https://api.supabase.com';

if (!TOKEN || !REF) {
  console.error(
    'Missing SUPABASE_ACCESS_TOKEN or SUPABASE_PROJECT_REF in .env.local.\n' +
      'Create a Personal Access Token at https://supabase.com/dashboard/account/tokens',
  );
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
};

async function runSql(query, label) {
  const res = await fetch(`${API}/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    throw new Error(`SQL failed (${label}): ${res.status} ${await res.text()}`);
  }
  console.log(`  ✓ ${label}`);
}

async function enableAuthHook() {
  const res = await fetch(`${API}/v1/projects/${REF}/config/auth`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      hook_custom_access_token_enabled: true,
      hook_custom_access_token_uri:
        'pg-functions://postgres/public/custom_access_token_hook',
      site_url: SITE,
      uri_allow_list: `${SITE}/auth/callback,${SITE}/reset`,
    }),
  });
  if (!res.ok) {
    throw new Error(`Auth config failed: ${res.status} ${await res.text()}`);
  }
  console.log('  ✓ access-token hook enabled + auth URLs set');
}

async function main() {
  const dir = join(root, 'supabase', 'migrations');
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  console.log(`Provisioning project ${REF}…`);
  console.log('Running migrations:');
  for (const file of files) {
    const sql = readFileSync(join(dir, file), 'utf8');
    await runSql(sql, file);
  }
  console.log('Configuring auth:');
  await enableAuthHook();
  console.log('\nDone. The database and auth hook are ready.');
}

main().catch((err) => {
  console.error('\nProvisioning failed:\n', err.message);
  process.exit(1);
});
