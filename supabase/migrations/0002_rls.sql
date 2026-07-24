-- 0002_rls.sql — access-token hook + tenant-isolation RLS (idempotent)

-- Inject institution_id + role into JWT claims at issue/refresh time.
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb language plpgsql stable set search_path = public as $$
declare claims jsonb; p record;
begin
  select institution_id, role into p
  from public.profiles where id = (event->>'user_id')::uuid;
  claims := coalesce(event->'claims','{}'::jsonb);
  if p.institution_id is not null then
    claims := jsonb_set(claims,'{app_metadata,institution_id}',
                        to_jsonb(p.institution_id::text));
  end if;
  if p.role is not null then
    claims := jsonb_set(claims,'{app_metadata,role}', to_jsonb(p.role::text));
  end if;
  return jsonb_set(event,'{claims}',claims);
end; $$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook to supabase_auth_admin;
grant select on public.profiles to supabase_auth_admin;

-- Claim helpers (in public schema; the auth schema is not writable here).
create or replace function public.jwt_institution() returns uuid
language sql stable as $$
  select nullif(auth.jwt()->'app_metadata'->>'institution_id','')::uuid; $$;

create or replace function public.jwt_role() returns text
language sql stable as $$
  select auth.jwt()->'app_metadata'->>'role'; $$;

-- Enable RLS on every table. parent_students has no institution_id yet, so it
-- gets RLS with no permissive policy = server-only access (secure default)
-- until the parent slice defines join-based rules.
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname='public'
  loop execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;

-- profiles: a user sees their own row; super admin sees all; same-tenant read
drop policy if exists profiles_self on profiles;
create policy profiles_self on profiles for select
  using (id = auth.uid() or public.jwt_role()='SUPER_ADMIN'
         or institution_id = public.jwt_institution());
drop policy if exists profiles_update_self on profiles;
create policy profiles_update_self on profiles for update
  using (id = auth.uid());

-- The access-token hook runs as supabase_auth_admin (subject to RLS) and must
-- read the user's profile to inject role + institution_id claims at login.
grant select on profiles to supabase_auth_admin;
drop policy if exists profiles_auth_admin_read on profiles;
create policy profiles_auth_admin_read on profiles
  as permissive for select to supabase_auth_admin using (true);

-- institutions: super admin all; others only their own
drop policy if exists inst_select on institutions;
create policy inst_select on institutions for select
  using (public.jwt_role()='SUPER_ADMIN' or id = public.jwt_institution());
drop policy if exists inst_super_write on institutions;
create policy inst_super_write on institutions for all
  using (public.jwt_role()='SUPER_ADMIN')
  with check (public.jwt_role()='SUPER_ADMIN');

-- Generic tenant isolation for all tables carrying institution_id.
-- Read: same tenant or super admin. Write: same tenant (admin/driver scope
-- refined in later slices) or super admin.
do $$
declare t text;
begin
  -- NOTE: institution_admins, attendance, gps_tracking, complaints, subscriptions
  -- and settings were dropped live (see 0085) — removed from this array so this
  -- idempotent loop can be re-run for RLS drift without a 42P01 on a missing table.
  for t in select unnest(array['students','parents',
    'drivers','vehicles','routes','route_stops','route_assignments',
    'seat_allocations','bookings','payments',
    'notifications','audit_logs'])
  loop
    execute format('drop policy if exists %1$s_tenant_rw on public.%1$I;', t);
    execute format($f$
      create policy %1$s_tenant_rw on public.%1$I for all
      using (public.jwt_role()='SUPER_ADMIN'
             or institution_id = public.jwt_institution())
      with check (public.jwt_role()='SUPER_ADMIN'
             or institution_id = public.jwt_institution());
    $f$, t);
  end loop;
end $$;
