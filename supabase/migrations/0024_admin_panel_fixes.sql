-- 0024_admin_panel_fixes.sql (idempotent)
-- Admin-panel hardening:
--   * soft-delete for institutions (parity with agencies/profiles)  [issue 2]
--   * global app_settings table for a cloud-safe maintenance flag    [issue 4]
--   * the already-existing audit_logs table is now written to        [issue 6]

-- Issue 2 — colleges/schools get a reversible soft-delete instead of a
-- cascading hard-delete. Existing rows default to "not deleted".
alter table institutions add column if not exists is_deleted boolean not null default false;
alter table institutions add column if not exists deleted_at timestamptz;

-- Issue 4 — a single-row-per-key settings store that survives on serverless /
-- multi-instance hosts (Vercel etc.), replacing the local .maintenance.json file
-- which only worked on a single always-on server. Written via the service-role
-- client only; RLS stays on with no policy, so the anon/user clients can't touch
-- it (service role bypasses RLS).
create table if not exists app_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table app_settings enable row level security;

-- Issue 6 — audit_logs already exists (0001) and 0002 gave SUPER_ADMIN full
-- read/write via audit_logs_tenant_rw. Platform-level entries carry a null
-- institution_id, which that policy permits for SUPER_ADMIN. No change needed
-- here; the app now inserts a row on every admin approve/reject/delete/restore.
