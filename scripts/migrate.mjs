// Applies every supabase/migrations/*.sql to the LIVE database, in filename
// order, via the Supabase Management API. This is the piece that was missing —
// migrations were committed but never actually run against live, causing
// repo-vs-DB drift (empty agency_services, stale grants, missing indexes, …).
//
// Migrations-ONLY: unlike scripts/provision.mjs it does NOT touch auth config
// (site_url / hooks), so it's safe to run from any environment (incl. CI, where
// NEXT_PUBLIC_SITE_URL may be localhost). All migrations are idempotent, so
// re-running already-applied ones is a no-op.
//
// Robustness:
//   • CREATE INDEX CONCURRENTLY files can't run inside a transaction (the API
//     wraps a multi-statement query in one), so files containing `concurrently`
//     are split and each statement is sent on its own.
//   • Re-running an older `create or replace function` whose return type a LATER
//     migration changed raises 42P13 ("cannot change return type"). The live
//     function is already the newer/correct one, so that specific error is
//     treated as a benign skip rather than a failure.
//
// Requires SUPABASE_ACCESS_TOKEN (sbp_…) + SUPABASE_PROJECT_REF, from the env or
// .env.local. Run with:  npm run db:migrate
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
try {
  process.loadEnvFile(join(root, '.env.local'));
} catch {
  // env may already be provided by the shell / CI secrets
}

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const REF = process.env.SUPABASE_PROJECT_REF;
if (!TOKEN || !REF) {
  console.error('Missing SUPABASE_ACCESS_TOKEN or SUPABASE_PROJECT_REF.');
  process.exit(1);
}
const headers = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

async function runSql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query }),
  });
  return { ok: res.ok, status: res.status, text: await res.text() };
}

// A re-run error we can safely ignore: the live object is already the newer one.
const isBenign = (t) =>
  /42P13/.test(t) || /cannot change return type of existing function/i.test(t);

// Split a CONCURRENTLY migration into individual statements (safe here: these
// files are simple DDL with no `$$` function bodies).
function splitStatements(sql) {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) =>
      s
        .split(/\r?\n/)
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .trim(),
    )
    .filter((s) => s.length > 0);
}

async function apply(file, sql) {
  if (/create\s+index\s+concurrently/i.test(sql)) {
    for (const stmt of splitStatements(sql)) {
      const r = await runSql(stmt);
      if (!r.ok && !isBenign(r.text)) {
        return { ok: false, detail: `${r.status}: ${r.text.slice(0, 200)}` };
      }
    }
    return { ok: true };
  }
  const r = await runSql(sql);
  if (r.ok) return { ok: true };
  if (isBenign(r.text)) return { ok: true, skipped: true };
  return { ok: false, detail: `${r.status}: ${r.text.slice(0, 300)}` };
}

async function main() {
  const dir = join(root, 'supabase', 'migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  console.log(`Applying ${files.length} migrations to project ${REF}…`);
  const failed = [];
  let applied = 0;
  let skipped = 0;
  for (const file of files) {
    const res = await apply(file, readFileSync(join(dir, file), 'utf8'));
    if (res.ok) {
      if (res.skipped) { skipped++; console.log(`  ~ ${file} (already current)`); }
      else { applied++; console.log(`  ✓ ${file}`); }
    } else {
      failed.push({ file, detail: res.detail });
      console.log(`  ✗ ${file} — ${res.detail}`);
    }
  }
  console.log(`\nApplied ${applied}, skipped ${skipped}, failed ${failed.length}.`);
  if (failed.length) {
    console.error('\nMigrations FAILED:');
    for (const f of failed) console.error(`- ${f.file}: ${f.detail}`);
    process.exit(1);
  }
  console.log('Live database is in sync with the repo.');
}

main().catch((err) => {
  console.error('\nMigration run crashed:\n', err.message);
  process.exit(1);
});
