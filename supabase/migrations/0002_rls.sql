-- 0002_rls.sql — access-token hook + tenant-isolation RLS

-- Inject institution_id + role into JWT claims at issue/refresh time.
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb language plpgsql stable as $$
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

-- Claim helpers
create or replace function auth.jwt_institution() returns uuid
language sql stable as $$
  select nullif(auth.jwt()->'app_metadata'->>'institution_id','')::uuid; $$;

create or replace function auth.jwt_role() returns text
language sql stable as $$
  select auth.jwt()->'app_metadata'->>'role'; $$;

-- Enable RLS on every table
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname='public'
           and tablename <> 'parent_students'
  loop execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;

-- profiles: a user sees their own row; super admin sees all; same-tenant read
create policy profiles_self on profiles for select
  using (id = auth.uid() or auth.jwt_role()='SUPER_ADMIN'
         or institution_id = auth.jwt_institution());
create policy profiles_update_self on profiles for update
  using (id = auth.uid());

-- institutions: super admin all; others only their own
create policy inst_select on institutions for select
  using (auth.jwt_role()='SUPER_ADMIN' or id = auth.jwt_institution());
create policy inst_super_write on institutions for all
  using (auth.jwt_role()='SUPER_ADMIN')
  with check (auth.jwt_role()='SUPER_ADMIN');

-- Generic tenant isolation for all tables carrying institution_id.
-- Read: same tenant or super admin. Write: same tenant (admin/driver scope
-- refined in later slices) or super admin.
do $$
declare t text;
begin
  for t in select unnest(array['institution_admins','students','parents',
    'drivers','vehicles','routes','route_stops','route_assignments',
    'seat_allocations','bookings','payments','attendance','gps_tracking',
    'notifications','complaints','subscriptions','settings','audit_logs'])
  loop
    execute format($f$
      create policy %1$s_tenant_rw on public.%1$I for all
      using (auth.jwt_role()='SUPER_ADMIN'
             or institution_id = auth.jwt_institution())
      with check (auth.jwt_role()='SUPER_ADMIN'
             or institution_id = auth.jwt_institution());
    $f$, t);
  end loop;
end $$;
