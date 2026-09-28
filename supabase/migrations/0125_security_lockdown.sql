-- 0125_security_lockdown.sql (idempotent — requires 0002/0004/0034/0078/0092)
-- Audit round 3 security HIGHs:
--   #1 profiles_update_self let a user edit ANY column of their own row — incl.
--      role (the access-token hook copies profiles.role into the JWT → self-promote
--      to SUPER_ADMIN), institution_id (hop campuses) and is_deleted (undo a ban).
--      handle_new_user also trusted raw_user_meta_data.role, which any caller of
--      the public /auth/v1/signup endpoint controls.
--   #2 agencies_write (owner: ALL) let a PENDING/REJECTED agency set its own
--      status=APPROVED or clear is_deleted.
--   #4 redeem_parent_link_code had no attempt limit → 6-digit codes brute-forceable.
--
-- Guards are BEFORE UPDATE triggers keyed on current_user: direct PostgREST writes
-- run as `authenticated`, while SECURITY DEFINER RPCs run as the function owner and
-- the service-role client runs as `service_role`, so every legitimate server-side
-- path is unaffected. A SUPER_ADMIN JWT is still allowed (admin panel edits run on
-- the user client) — that claim is now trustworthy because role can't be self-set.

-- ---------------------------------------------------------------------------
-- #1 profiles: users may only change their own display fields.
-- ---------------------------------------------------------------------------
drop policy if exists profiles_update_self on profiles;
create policy profiles_update_self on profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

create or replace function public.profiles_guard_privileged_cols() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon')
     and coalesce(public.jwt_role(), '') <> 'SUPER_ADMIN'
     and (new.id is distinct from old.id
          or new.role is distinct from old.role
          or new.institution_id is distinct from old.institution_id
          or new.is_deleted is distinct from old.is_deleted
          or new.deleted_at is distinct from old.deleted_at
          or new.email is distinct from old.email) then
    raise exception 'You cannot change these account fields' using errcode = '42501';
  end if;
  return new;
end; $$;

drop trigger if exists trg_profiles_guard on profiles;
create trigger trg_profiles_guard before update on profiles
  for each row execute function public.profiles_guard_privileged_cols();

-- Signup: never take SUPER_ADMIN (or DRIVER) from client-controlled user metadata.
-- Self-serve roles come from raw_user_meta_data (all public signup forms); DRIVER /
-- INSTITUTION_ADMIN created by an agency/admin come from raw_app_meta_data, which
-- only the service role can set. Anything else falls back to STUDENT. Body
-- otherwise verbatim from 0092.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_role public.user_role; v_agency_id uuid;
  v_app_role text := new.raw_app_meta_data->>'role';
  v_user_role text := new.raw_user_meta_data->>'role';
begin
  v_role := case
    when v_app_role in ('STUDENT','PARENT','AGENCY','INSTITUTION_ADMIN','DRIVER')
      then v_app_role::public.user_role
    when v_user_role in ('STUDENT','PARENT','AGENCY','INSTITUTION_ADMIN')
      then v_user_role::public.user_role
    else 'STUDENT'::public.user_role
  end;
  insert into public.profiles (id, full_name, email, role)
  values (new.id, new.raw_user_meta_data->>'full_name', new.email, v_role);

  if v_role = 'AGENCY' then
    insert into public.agencies (owner_profile_id, name, email, phone, contact_person,
      legal_name, registration_no, gst_number, pan_number, registered_address,
      permit_doc_url, fitness_doc_url, status)
    values (new.id,
      coalesce(new.raw_user_meta_data->>'full_name','Agency'),
      new.email,
      new.raw_user_meta_data->>'phone',
      new.raw_user_meta_data->>'contact_person',
      new.raw_user_meta_data->>'legal_name',
      new.raw_user_meta_data->>'registration_no',
      new.raw_user_meta_data->>'gst_number',
      new.raw_user_meta_data->>'pan_number',
      new.raw_user_meta_data->>'registered_address',
      nullif(new.raw_user_meta_data->>'permit_doc_url',''),
      nullif(new.raw_user_meta_data->>'fitness_doc_url',''),
      'PENDING')
    returning id into v_agency_id;

    insert into public.agency_services (agency_id, institution_id, name, vehicle_type)
    select v_agency_id,
           inst::uuid,
           coalesce(new.raw_user_meta_data->>'full_name','Service')
             || ' — ' || (case when vt = 'VAN' then 'Van' else 'Bus' end),
           vt::vehicle_type
    from jsonb_array_elements_text(coalesce(new.raw_user_meta_data->'institution_ids','[]'::jsonb)) as inst,
         jsonb_array_elements_text(coalesce(new.raw_user_meta_data->'vehicle_types','[]'::jsonb)) as vt
    where inst ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and vt in ('BUS','VAN')
    on conflict (agency_id, institution_id, vehicle_type) do nothing;
  end if;
  return new;
end; $$;

-- ---------------------------------------------------------------------------
-- #2 agencies: SUPER_ADMIN writes anything; the owner may only UPDATE its own
-- business details (no insert/delete, no status/deletion/approval columns).
-- ---------------------------------------------------------------------------
drop policy if exists agencies_write on agencies;
drop policy if exists agencies_admin_write on agencies;
create policy agencies_admin_write on agencies for all
  using (public.jwt_role() = 'SUPER_ADMIN')
  with check (public.jwt_role() = 'SUPER_ADMIN');
drop policy if exists agencies_owner_update on agencies;
create policy agencies_owner_update on agencies for update
  using (owner_profile_id = auth.uid())
  with check (owner_profile_id = auth.uid());

create or replace function public.agencies_guard_privileged_cols() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon')
     and coalesce(public.jwt_role(), '') <> 'SUPER_ADMIN'
     and (new.id is distinct from old.id
          or new.owner_profile_id is distinct from old.owner_profile_id
          or new.status is distinct from old.status
          or new.is_deleted is distinct from old.is_deleted
          or new.deleted_at is distinct from old.deleted_at
          or new.approved_at is distinct from old.approved_at
          or new.approved_by is distinct from old.approved_by
          or new.rejected_reason is distinct from old.rejected_reason
          or new.email is distinct from old.email
          or new.rating_avg is distinct from old.rating_avg
          or new.rating_count is distinct from old.rating_count
          or new.created_at is distinct from old.created_at) then
    raise exception 'You cannot change these agency fields' using errcode = '42501';
  end if;
  return new;
end; $$;

drop trigger if exists trg_agencies_guard on agencies;
create trigger trg_agencies_guard before update on agencies
  for each row execute function public.agencies_guard_privileged_cols();

-- ---------------------------------------------------------------------------
-- #4 redeem_parent_link_code: max 5 wrong codes per account per 15 minutes.
-- A wrong code now RETURNS NO ROWS instead of raising, so the failure row we log
-- in rate_limit_events commits (a raise would roll it back). The server action
-- maps "no row" to the "invalid or expired" message. Body otherwise from 0078.
-- ---------------------------------------------------------------------------
create or replace function public.redeem_parent_link_code(p_code text)
returns table (student_id uuid, full_name text, email text, already_linked boolean)
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_role text; v_parent parents;
  v_row parent_link_codes; v_inserted int; v_fails int;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode='P0001'; end if;
  select p.role::text into v_role from profiles p where p.id = v_uid;
  if v_role not in ('PARENT','SUPER_ADMIN') then
    raise exception 'Only parent accounts can use a link code' using errcode='P0003';
  end if;

  -- Serialize this account's attempts so parallel guesses can't race the count.
  perform pg_advisory_xact_lock(hashtextextended('link:fail:' || v_uid::text, 0));
  select count(*) into v_fails from rate_limit_events
   where scope = 'link:fail' and subject = v_uid::text
     and created_at >= now() - interval '15 minutes';
  if v_fails >= 5 then
    raise exception 'Too many wrong codes. Please wait 15 minutes and try again.'
      using errcode = 'P0005';
  end if;

  select plc.* into v_row from parent_link_codes plc
   where plc.code = trim(p_code) and plc.used_at is null and plc.expires_at > now()
   order by plc.created_at desc limit 1
   for update;
  if v_row.id is null then
    insert into rate_limit_events (scope, subject) values ('link:fail', v_uid::text);
    return;  -- no rows = invalid or expired code
  end if;

  select * into v_parent from parents where profile_id = v_uid limit 1;
  if v_parent.id is null then
    insert into parents (profile_id) values (v_uid)
      on conflict (profile_id) where profile_id is not null do nothing;
    select * into v_parent from parents where profile_id = v_uid limit 1;
  end if;

  insert into parent_students (parent_id, student_id)
  values (v_parent.id, v_row.student_id)
  on conflict do nothing;
  get diagnostics v_inserted = row_count;  -- 1 = newly linked, 0 = already linked

  update parent_link_codes plc set used_at = now(), used_by = v_parent.id
   where plc.id = v_row.id;

  return query
  select s.id, pr.full_name, pr.email, (v_inserted = 0) as already_linked
  from students s
  left join profiles pr on pr.id = s.profile_id
  where s.id = v_row.student_id;
end; $$;
grant execute on function public.redeem_parent_link_code(text) to authenticated;

notify pgrst, 'reload schema';
