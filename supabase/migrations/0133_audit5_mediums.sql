-- 0133: audit-5 MEDIUM fixes (security, money/refunds, admin+parent flows, notifications/driver). Idempotent.

-- ===== M_A_security =====
-- ===========================================================================
-- M_A security (audit MEDIUM #1–#4) — fleet integrity, driver PII, signup roles
-- Idempotent. Merged by the lead into migration 0133.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- #1a. Vehicles are written ONLY by guarded server actions (service role after
--      an owner check) or security-definer RPCs. Agencies lose direct
--      INSERT/UPDATE/DELETE through PostgREST (they could delete a bus that an
--      active route still points at, or write arbitrary photo URLs).
--      bus_driver_changes is RPC-only too (no write policy existed; revoke the
--      table grants as well so it's not one policy away from open).
-- ---------------------------------------------------------------------------
drop policy if exists vehicles_agency_write on public.vehicles;

do $$
declare cols text;
begin
  revoke insert, update, delete, truncate on public.vehicles from anon, authenticated;
  select string_agg(quote_ident(column_name), ', ') into cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'vehicles';
  -- column-level write grants (if any were ever made) go too
  execute format('revoke insert (%1$s), update (%1$s) on public.vehicles from anon, authenticated', cols);

  revoke insert, update, delete, truncate on public.bus_driver_changes from anon, authenticated;
  select string_agg(quote_ident(column_name), ', ') into cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'bus_driver_changes';
  execute format('revoke insert (%1$s), update (%1$s) on public.bus_driver_changes from anon, authenticated', cols);
end $$;

-- #1b. A bus that an ACTIVE route still uses can't be deleted (the FK is
--      ON DELETE SET NULL, which left a bookable route with no bus).
create or replace function public.vehicles_guard_delete()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if exists (select 1 from routes r where r.vehicle_id = old.id and r.is_active) then
    raise exception 'This bus is assigned to an active route — move that route to another bus or deactivate it before deleting the bus'
      using errcode = 'P0003';
  end if;
  return old;
end; $function$;
revoke execute on function public.vehicles_guard_delete() from public, anon, authenticated;

drop trigger if exists trg_vehicles_guard_delete on public.vehicles;
create trigger trg_vehicles_guard_delete before delete on public.vehicles
  for each row execute function public.vehicles_guard_delete();

-- #1c. Bus / driver photo URLs must be files in OUR vehicle-photos bucket
--      (mirrors ownStoragePhoto() in src/features/agency/actions.ts). NULL ok.
--      NOTE: project URL is hard-coded; keep in sync with NEXT_PUBLIC_SUPABASE_URL.
--      Live data checked: all 3 non-null image_url / photos / driver_photo_url pass.
create or replace function public.is_vehicle_photo_url(p text)
 returns boolean
 language sql
 immutable
 set search_path to 'public'
as $function$
  select p is null
      or p ~ '^https://dkjkffbalrgcfxmsshoz\.supabase\.co/storage/v1/object/public/vehicle-photos/[A-Za-z0-9][A-Za-z0-9._-]{0,200}$'
$function$;

create or replace function public.are_vehicle_photo_urls(p text[])
 returns boolean
 language sql
 immutable
 set search_path to 'public'
as $function$
  select p is null
      or coalesce((select bool_and(u is not null and public.is_vehicle_photo_url(u)) from unnest(p) as u), true)
$function$;

alter table public.vehicles drop constraint if exists vehicles_photo_urls_own_bucket;
alter table public.vehicles add constraint vehicles_photo_urls_own_bucket check (
  public.is_vehicle_photo_url(image_url)
  and public.is_vehicle_photo_url(driver_photo_url)
  and public.are_vehicle_photo_urls(photos)
);

-- ---------------------------------------------------------------------------
-- #2. Cross-agency integrity, enforced for every writer (incl. service role):
--     * vehicles.driver_id must be a driver of the bus's own agency
--     * vehicles.institution_id must be a campus the agency is approved to serve
--       (an agency_services row — admin-write only since 0128)
--     * vehicles.agency_service_id must be that agency's own service area
--     * bus_driver_changes: agency = the bus's agency; substitute driver_id
--       (driver OR conductor role) must be of that agency
--     * routes (agency-owned): campus served, bus + service area of same agency
--     Checks run only when the relevant columns change, so unrelated updates on
--     legacy rows (agency_id NULL seed data) keep working. Live data: 0 violations.
-- ---------------------------------------------------------------------------
create or replace function public.vehicles_guard_tenancy()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if new.agency_id is null then return new; end if;  -- legacy campus-owned / agency removed

  if new.driver_id is not null
     and (tg_op = 'INSERT' or new.driver_id is distinct from old.driver_id
          or new.agency_id is distinct from old.agency_id)
     and not exists (select 1 from drivers d where d.id = new.driver_id and d.agency_id = new.agency_id) then
    raise exception 'That driver is not registered with this bus''s agency' using errcode = 'P0005';
  end if;

  if new.institution_id is not null
     and (tg_op = 'INSERT' or new.institution_id is distinct from old.institution_id
          or new.agency_id is distinct from old.agency_id)
     and not exists (select 1 from agency_services s
                      where s.agency_id = new.agency_id and s.institution_id = new.institution_id) then
    raise exception 'This agency is not approved to serve that campus' using errcode = 'P0003';
  end if;

  if new.agency_service_id is not null
     and (tg_op = 'INSERT' or new.agency_service_id is distinct from old.agency_service_id
          or new.agency_id is distinct from old.agency_id)
     and not exists (select 1 from agency_services s
                      where s.id = new.agency_service_id and s.agency_id = new.agency_id) then
    raise exception 'That service area belongs to another agency' using errcode = 'P0003';
  end if;
  return new;
end; $function$;
revoke execute on function public.vehicles_guard_tenancy() from public, anon, authenticated;

drop trigger if exists trg_vehicles_guard_tenancy on public.vehicles;
create trigger trg_vehicles_guard_tenancy
  before insert or update of driver_id, agency_id, institution_id, agency_service_id on public.vehicles
  for each row execute function public.vehicles_guard_tenancy();

create or replace function public.bus_driver_changes_guard_tenancy()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_agency uuid;
begin
  select v.agency_id into v_agency from vehicles v where v.id = new.vehicle_id;
  if v_agency is null or new.agency_id is distinct from v_agency then
    raise exception 'Not your bus' using errcode = 'P0003';
  end if;
  if new.driver_id is not null
     and not exists (select 1 from drivers d where d.id = new.driver_id and d.agency_id = v_agency) then
    raise exception 'That person is not registered with your agency' using errcode = 'P0005';
  end if;
  return new;
end; $function$;
revoke execute on function public.bus_driver_changes_guard_tenancy() from public, anon, authenticated;

drop trigger if exists trg_bus_driver_changes_guard_tenancy on public.bus_driver_changes;
create trigger trg_bus_driver_changes_guard_tenancy
  before insert or update of vehicle_id, agency_id, driver_id on public.bus_driver_changes
  for each row execute function public.bus_driver_changes_guard_tenancy();

create or replace function public.routes_guard_tenancy()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if new.agency_id is null then return new; end if;  -- legacy campus-owned routes

  if new.institution_id is not null
     and (tg_op = 'INSERT' or new.institution_id is distinct from old.institution_id
          or new.agency_id is distinct from old.agency_id)
     and not exists (select 1 from agency_services s
                      where s.agency_id = new.agency_id and s.institution_id = new.institution_id) then
    raise exception 'This agency is not approved to serve that campus' using errcode = 'P0003';
  end if;

  if new.vehicle_id is not null
     and (tg_op = 'INSERT' or new.vehicle_id is distinct from old.vehicle_id
          or new.agency_id is distinct from old.agency_id)
     and not exists (select 1 from vehicles v where v.id = new.vehicle_id and v.agency_id = new.agency_id) then
    raise exception 'That bus belongs to another agency' using errcode = 'P0003';
  end if;

  if new.agency_service_id is not null
     and (tg_op = 'INSERT' or new.agency_service_id is distinct from old.agency_service_id
          or new.agency_id is distinct from old.agency_id)
     and not exists (select 1 from agency_services s
                      where s.id = new.agency_service_id and s.agency_id = new.agency_id) then
    raise exception 'That service area belongs to another agency' using errcode = 'P0003';
  end if;
  return new;
end; $function$;
revoke execute on function public.routes_guard_tenancy() from public, anon, authenticated;

drop trigger if exists trg_routes_guard_tenancy on public.routes;
create trigger trg_routes_guard_tenancy
  before insert or update of agency_id, institution_id, vehicle_id, agency_service_id on public.routes
  for each row execute function public.routes_guard_tenancy();

-- ---------------------------------------------------------------------------
-- #3. Driver / conductor PII + bus documents hidden from every non-service
--     reader (0128 only hid Aadhaar/DOB/address). Agency + admin + campus
--     panels read these through the service role after an ownership check;
--     drivers read their own record via the driver_profile RPC.
--     vehicles: + driver_email, driver_license_no, driver_alt_phone,
--               driver_blood_group, conductor_alt_phone, conductor_blood_group,
--               rc_url, permit_url, fitness_url, insurance_url, details_pdf_url
--     bus_driver_changes: + driver_license_no, driver_blood_group, driver_alt_phone
--     drivers: aadhaar_no, address, dob, license_no, alt_phone, blood_group
--              (RLS already limits rows to SUPER_ADMIN + campus tenant; this
--              stops a campus admin pulling Aadhaar etc. over the API)
-- ---------------------------------------------------------------------------
do $$
declare cols text;
begin
  revoke select on public.vehicles from anon, authenticated;
  select string_agg(quote_ident(column_name), ', ') into cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'vehicles'
     and column_name not in (
       'driver_govt_id','driver_address','driver_dob',
       'conductor_govt_id','conductor_address','conductor_dob',
       'driver_email','driver_license_no','driver_alt_phone','driver_blood_group',
       'conductor_alt_phone','conductor_blood_group',
       'rc_url','permit_url','fitness_url','insurance_url','details_pdf_url');
  execute format('revoke select (%s) on public.vehicles from anon, authenticated',
    (select string_agg(quote_ident(column_name), ', ') from information_schema.columns
      where table_schema = 'public' and table_name = 'vehicles'));
  execute format('grant select (%s) on public.vehicles to authenticated', cols);

  revoke select on public.bus_driver_changes from anon, authenticated;
  select string_agg(quote_ident(column_name), ', ') into cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'bus_driver_changes'
     and column_name not in ('driver_govt_id','driver_license_no','driver_blood_group','driver_alt_phone');
  execute format('revoke select (%s) on public.bus_driver_changes from anon, authenticated',
    (select string_agg(quote_ident(column_name), ', ') from information_schema.columns
      where table_schema = 'public' and table_name = 'bus_driver_changes'));
  execute format('grant select (%s) on public.bus_driver_changes to authenticated', cols);

  revoke select on public.drivers from anon, authenticated;
  select string_agg(quote_ident(column_name), ', ') into cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'drivers'
     and column_name not in ('aadhaar_no','address','dob','license_no','alt_phone','blood_group');
  execute format('revoke select (%s) on public.drivers from anon, authenticated',
    (select string_agg(quote_ident(column_name), ', ') from information_schema.columns
      where table_schema = 'public' and table_name = 'drivers'));
  execute format('grant select (%s) on public.drivers to authenticated', cols);
end $$;

-- ---------------------------------------------------------------------------
-- #4. Privileged self-signup roles (AGENCY / INSTITUTION_ADMIN / DRIVER) need a
--     server-issued, single-use signup intent. A direct auth.signUp() with
--     {role:'AGENCY'} metadata now becomes a plain STUDENT.
--     Why an intent table and not app_metadata: GoTrue applies admin
--     app_metadata in a separate UPDATE after the auth.users INSERT, so an
--     AFTER INSERT trigger can't rely on it; user_metadata IS present at insert.
--     The server action (after its OTP / form / super-admin checks) inserts
--     (email, role, random token) here with the service role and passes the token
--     as user_metadata.signup_intent; the trigger consumes the matching row.
-- ---------------------------------------------------------------------------
create table if not exists public.signup_role_intents (
  id uuid primary key default gen_random_uuid(),
  email_lower text not null,
  role public.user_role not null check (role in ('AGENCY','INSTITUTION_ADMIN','DRIVER')),
  token text not null unique check (length(token) >= 32),
  expires_at timestamptz not null default now() + interval '15 minutes',
  created_at timestamptz not null default now()
);
create index if not exists signup_role_intents_email_idx on public.signup_role_intents (email_lower);
alter table public.signup_role_intents enable row level security;
-- no policies: service role only
revoke all on public.signup_role_intents from public, anon, authenticated;
grant select, insert, delete on public.signup_role_intents to service_role;

create or replace function public.handle_new_user()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_role public.user_role; v_agency_id uuid;
  v_app_role text := new.raw_app_meta_data->>'role';
  v_user_role text := new.raw_user_meta_data->>'role';
  v_token text := new.raw_user_meta_data->>'signup_intent';
  v_intent uuid;
begin
  -- Privileged roles only with a matching, unexpired server-issued intent.
  if v_user_role in ('AGENCY','INSTITUTION_ADMIN','DRIVER') and coalesce(v_token,'') <> '' then
    delete from public.signup_role_intents i
     where i.token = v_token
       and i.email_lower = lower(new.email)
       and i.role::text = v_user_role
       and i.expires_at > now()
    returning i.id into v_intent;
  end if;
  delete from public.signup_role_intents where expires_at < now() - interval '1 day';

  v_role := case
    -- app_metadata is service-role-only (kept for any caller that sets it at insert)
    when v_app_role in ('STUDENT','PARENT','AGENCY','INSTITUTION_ADMIN','DRIVER')
      then v_app_role::public.user_role
    when v_intent is not null
      then v_user_role::public.user_role
    when v_user_role in ('STUDENT','PARENT')
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

    insert into public.agency_service_requests
      (agency_id, institution_id, vehicle_type, name, description, status, campus_status)
    select v_agency_id,
           inst::uuid,
           vt::vehicle_type,
           coalesce(new.raw_user_meta_data->>'full_name','Service')
             || ' — ' || (case when vt = 'VAN' then 'Van' else 'Bus' end),
           'Requested at sign-up',
           'PENDING', 'PENDING'
    from jsonb_array_elements_text(coalesce(new.raw_user_meta_data->'institution_ids','[]'::jsonb)) as inst,
         jsonb_array_elements_text(coalesce(new.raw_user_meta_data->'vehicle_types','[]'::jsonb)) as vt
    where inst ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and vt in ('BUS','VAN')
      and exists (select 1 from public.institutions i where i.id = inst::uuid and not i.is_deleted)
    on conflict (agency_id, institution_id, vehicle_type) where status = 'PENDING' do nothing;
  end if;
  return new;
end; $function$;

notify pgrst, 'reload schema';

-- ===== M_B_money =====
-- =============================================================================
-- M_B_money.sql — audit MEDIUM issues #5–#10 (money / refunds / renewals /
-- history / permanent deletes). Idempotent; safe to re-run. To be merged into
-- migration 0133 by the lead.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- #9 (schema first — process_refund below does not depend on it, but the
-- snapshot trigger + FK change must exist before any purge).
-- Preserve financial records when a college/route/booking is permanently
-- deleted:
--   * payments.booking_id is already ON DELETE SET NULL, but then the row lost
--     its rider + route. Snapshot rider/route/college names onto the payment.
--   * pass_renewals.booking_id was ON DELETE CASCADE -> renewal money records
--     vanished. Make it nullable + ON DELETE SET NULL, and snapshot names too.
-- -----------------------------------------------------------------------------
alter table public.payments
  add column if not exists rider_name text,
  add column if not exists rider_email text,
  add column if not exists route_name text,
  add column if not exists institution_name text;

alter table public.pass_renewals
  add column if not exists rider_name text,
  add column if not exists route_name text,
  add column if not exists institution_name text;

alter table public.pass_renewals alter column booking_id drop not null;
alter table public.pass_renewals drop constraint if exists pass_renewals_booking_id_fkey;
alter table public.pass_renewals
  add constraint pass_renewals_booking_id_fkey
  foreign key (booking_id) references public.bookings(id) on delete set null;

-- Stamp the snapshot whenever a payment/renewal is (re)attached to a booking.
-- A FK "SET NULL" update has new.booking_id NULL -> snapshot is left untouched.
create or replace function public.money_row_snapshot()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_rider text; v_email text; v_route text; v_inst text;
begin
  if new.booking_id is null then return new; end if;
  select b.student_name, b.student_email, r.name, i.name
    into v_rider, v_email, v_route, v_inst
  from bookings b
  left join routes r on r.id = b.route_id
  left join institutions i on i.id = coalesce(r.institution_id, b.institution_id)
  where b.id = new.booking_id;
  new.rider_name       := coalesce(v_rider, new.rider_name);
  new.route_name       := coalesce(v_route, new.route_name);
  new.institution_name := coalesce(v_inst, new.institution_name);
  if tg_table_name = 'payments' then
    new.rider_email := coalesce(v_email, new.rider_email);
  end if;
  return new;
end; $function$;

drop trigger if exists trg_payments_snapshot on public.payments;
create trigger trg_payments_snapshot
  before insert or update of booking_id on public.payments
  for each row execute function public.money_row_snapshot();

drop trigger if exists trg_pass_renewals_snapshot on public.pass_renewals;
create trigger trg_pass_renewals_snapshot
  before insert or update of booking_id on public.pass_renewals
  for each row execute function public.money_row_snapshot();

-- Refresh the snapshot from the booking row itself right before it is deleted
-- (the booking row is always visible as OLD, even mid-cascade; route/college
-- names fall back to whatever was stamped at insert time).
create or replace function public.bookings_snapshot_money_before_delete()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_route text; v_inst text;
begin
  select r.name into v_route from routes r where r.id = old.route_id;
  select i.name into v_inst from institutions i where i.id = old.institution_id;
  update payments
     set rider_name = coalesce(old.student_name, rider_name),
         rider_email = coalesce(old.student_email, rider_email),
         route_name = coalesce(v_route, route_name),
         institution_name = coalesce(v_inst, institution_name)
   where booking_id = old.id;
  update pass_renewals
     set rider_name = coalesce(old.student_name, rider_name),
         route_name = coalesce(v_route, route_name),
         institution_name = coalesce(v_inst, institution_name)
   where booking_id = old.id;
  return old;
end; $function$;

drop trigger if exists trg_bookings_snapshot_money on public.bookings;
create trigger trg_bookings_snapshot_money
  before delete on public.bookings
  for each row execute function public.bookings_snapshot_money_before_delete();

revoke all on function public.money_row_snapshot() from public, anon, authenticated;
revoke all on function public.bookings_snapshot_money_before_delete() from public, anon, authenticated;

-- Backfill existing rows (only fills blanks; idempotent).
update public.payments p
   set rider_name = coalesce(p.rider_name, b.student_name),
       rider_email = coalesce(p.rider_email, b.student_email),
       route_name = coalesce(p.route_name, r.name),
       institution_name = coalesce(p.institution_name, i.name)
  from public.bookings b
  left join public.routes r on r.id = b.route_id
  left join public.institutions i on i.id = coalesce(r.institution_id, b.institution_id)
 where b.id = p.booking_id
   and (p.rider_name is null or p.route_name is null or p.institution_name is null);

update public.pass_renewals pr
   set rider_name = coalesce(pr.rider_name, b.student_name),
       route_name = coalesce(pr.route_name, r.name),
       institution_name = coalesce(pr.institution_name, i.name)
  from public.bookings b
  left join public.routes r on r.id = b.route_id
  left join public.institutions i on i.id = coalesce(r.institution_id, b.institution_id)
 where b.id = pr.booking_id
   and (pr.rider_name is null or pr.route_name is null or pr.institution_name is null);


-- -----------------------------------------------------------------------------
-- #5 / #6 / #7  process_refund
--  #5  APPROVE is refused unless the booking is closed (CANCELLED/REJECTED) or
--      somebody actually asked to cancel it (cancel_requested_at). An active
--      pass with a stray REQUESTED flag can only be declined.
--  #6  DECLINE on an AGENCY-removed booking keeps it closed (REJECTED) instead
--      of reviving it — the agency already hid the rider from its lists.
--  #7  DECLINE that leaves a booking active applies any verified (PAID) pass
--      renewal that was approved while the cancellation was pending and so
--      never extended the pass (period_start IS NULL). Money kept => pass
--      extended. (Chosen over blocking renewal approval: the admin cannot
--      un-receive money, and blocking would strand a CREATED renewal.)
-- -----------------------------------------------------------------------------
create or replace function public.process_refund(p_booking_id uuid, p_amount_cents bigint, p_approve boolean, p_note text default null::text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid(); v_role text; v_booking bookings; v_route text;
  v_amt bigint; v_kind text; v_title text; v_body text; v_note text; v_rec record;
  v_pay payments; v_refundable bigint; v_ren pass_renewals; v_start timestamptz;
  v_renewed boolean := false; v_agency_closed boolean := false;
begin
  select role::text into v_role from profiles where id = v_uid and not coalesce(is_deleted, false);
  if v_role is distinct from 'SUPER_ADMIN' then
    raise exception 'Only an admin can process refunds' using errcode='P0003'; end if;

  select * into v_booking from bookings where id = p_booking_id for update;
  if v_booking.id is null then raise exception 'Booking not found' using errcode='P0002'; end if;
  select * into v_pay from payments
   where booking_id = p_booking_id and refund_status = 'REQUESTED' limit 1;
  if v_pay.id is null then
    raise exception 'No pending refund for this booking' using errcode='P0005'; end if;

  v_note := nullif(btrim(coalesce(p_note, '')), '');
  select coalesce(r.name, 'your route') into v_route from routes r where r.id = v_booking.route_id;

  if p_approve then
    -- #5: never refund (and cancel) a pass nobody asked to cancel.
    if v_booking.status not in ('CANCELLED', 'REJECTED') and v_booking.cancel_requested_at is null then
      raise exception 'This booking is still active and no cancellation was requested — decline this refund request instead'
        using errcode = 'P0006';
    end if;
    if v_pay.status not in ('PAID', 'REFUNDED') then
      raise exception 'This payment has not been verified yet — verify the UTR under "To verify" before refunding'
        using errcode = 'P0006';
    end if;
    v_refundable := (case when v_pay.status = 'PAID' then v_pay.amount_cents else 0 end)
      + (select coalesce(sum(pr.amount_cents), 0) from pass_renewals pr
          where pr.booking_id = p_booking_id and pr.status = 'PAID');
    if v_refundable <= 0 then
      raise exception 'Nothing left to refund on this booking' using errcode = 'P0006'; end if;
    v_amt := least(greatest(coalesce(p_amount_cents, 0), 0), v_refundable);
    update payments set status = 'REFUNDED', refund_status = 'PROCESSED',
        refund_amount_cents = (case when v_pay.status = 'REFUNDED' then coalesce(v_pay.refund_amount_cents, 0) else 0 end) + v_amt,
        refunded_at = now(), refunded_by = v_uid, refund_note = v_note, updated_at = now()
     where id = v_pay.id;
    update pass_renewals set status = 'REFUNDED'
     where booking_id = p_booking_id and status = 'PAID';
    -- NOW finalize the cancellation -> frees the seat + promotes the waitlist (trigger).
    update bookings set status = 'CANCELLED', cancel_cause = coalesce(cancel_cause, 'STUDENT')
     where id = p_booking_id and status not in ('CANCELLED', 'REJECTED');
    v_kind := 'REFUNDED'; v_title := 'Refund processed — booking cancelled';
    v_body := 'A refund of ₹' || (v_amt / 100)::text || ' for ' || v_route ||
              ' has been sent, and your booking is now cancelled.';
  else
    update payments set refund_status = 'DECLINED',
        refunded_at = now(), refunded_by = v_uid, refund_note = v_note, updated_at = now()
     where id = v_pay.id;

    if v_booking.status in ('PENDING', 'CONFIRMED')
       and v_booking.cancel_cause = 'AGENCY' and v_booking.cancel_requested_at is not null then
      -- #6: the agency removed this rider (and hid them from its lists). Declining
      -- the refund must NOT revive the seat — finalize the removal instead.
      update bookings set status = 'REJECTED'
       where id = p_booking_id returning * into v_booking;
      v_agency_closed := true;
    elsif v_booking.status in ('PENDING', 'CONFIRMED') then
      -- Rider-initiated cancellation declined -> booking stays active.
      update bookings set cancel_requested_at = null, cancel_cause = null, refund_details = null
       where id = p_booking_id returning * into v_booking;
      -- #7: apply verified renewals that were approved while the cancellation
      -- was pending (they were held for refund and never extended the pass).
      if v_booking.status = 'CONFIRMED' then
        for v_ren in
          select * from pass_renewals
           where booking_id = p_booking_id and status = 'PAID' and period_start is null
           order by submitted_at, created_at
           for update
        loop
          v_start := greatest(public.booking_pass_end(v_booking), now());
          update bookings set billing_period = v_ren.billing_period, pass_start_at = v_start
           where id = p_booking_id returning * into v_booking;
          update pass_renewals
             set period_start = v_start,
                 verify_note = coalesce(nullif(verify_note, '') || ' · ', '') || 'Applied after the refund was declined'
           where id = v_ren.id;
          v_renewed := true;
        end loop;
      end if;
    end if;

    v_kind := 'CANCELLED'; v_title := 'Refund request declined';
    v_body := 'Your refund request for ' || v_route || ' was declined' ||
              case when v_agency_closed
                     then '. The operator removed this booking, so it stays closed.'
                   when v_booking.status in ('PENDING', 'CONFIRMED')
                     then ', so your booking is still active.'
                   else '.' end ||
              case when v_renewed
                     then ' Your renewal has been applied — the pass is valid until ' ||
                          to_char(public.booking_pass_end(v_booking) at time zone 'Asia/Kolkata', 'DD Mon YYYY') || '.'
                   else '' end ||
              coalesce(' Note: ' || v_note, '');
  end if;

  -- Notify the rider + linked parents (bell + email + push), best-effort.
  begin
    for v_rec in
      select s.profile_id as pid, pr.email as email
      from students s left join profiles pr on pr.id = s.profile_id
      where s.id = v_booking.student_id and s.profile_id is not null
      union
      select pa.profile_id, pr.email
      from parent_students ps
      join parents pa on pa.id = ps.parent_id
      left join profiles pr on pr.id = pa.profile_id
      where ps.student_id = v_booking.student_id and pa.profile_id is not null
    loop
      insert into notifications (institution_id, recipient_id, title, body)
      values (v_booking.institution_id, v_rec.pid, v_title, v_body);
      if v_rec.email is not null then
        insert into email_outbox (recipient_id, to_email, kind, title, body, booking_id)
        values (v_rec.pid, v_rec.email, v_kind, v_title, v_body, p_booking_id);
      end if;
      insert into push_outbox (recipient_id, kind, title, body, url, booking_id)
      values (v_rec.pid, v_kind, v_title, v_body, '/student/history', p_booking_id);
    end loop;
  exception when others then
    raise warning 'process_refund notify failed for booking %: %', p_booking_id, sqlerrm;
  end;
end; $function$;


-- -----------------------------------------------------------------------------
-- #8  my_booking_history: a PAID booking that was REJECTED (agency rejected /
-- removed it) is history too, not just CANCELLED ones.
-- -----------------------------------------------------------------------------
create or replace function public.my_booking_history()
 returns table(booking_id uuid, student_name text, route_name text, college_name text, bus_number text, agency_name text, pickup_name text, status text, refund_status text, amount_cents bigint, billing_period text, booked_at timestamp with time zone, paid_at timestamp with time zone, changed_at timestamp with time zone)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with mine as (
    -- The caller's own bookings (student) or their linked children's (parent).
    select b.*
    from bookings b
    where b.student_id in (select s.id from students s where s.profile_id = auth.uid())
       or b.student_id in (
         select ps.student_id from parent_students ps
         join parents pa on pa.id = ps.parent_id
         where pa.profile_id = auth.uid()
       )
  ),
  pay as (
    -- One payment summary per booking: was it EVER really paid, its latest
    -- refund state, and the amount.
    select p.booking_id,
           bool_or(p.status in ('PAID','REFUNDED') or p.refund_status <> 'NONE') as was_paid,
           max(p.amount_cents) as amount_cents,
           (array_agg(p.refund_status order by p.updated_at desc nulls last))[1] as refund_status
    from payments p
    group by p.booking_id
  )
  select
    m.id,
    m.student_name,
    r.name,
    i.name,
    v.bus_number,
    ag.name,
    ps.name,
    m.status::text,
    coalesce(pay.refund_status, 'NONE'),
    coalesce(pay.amount_cents, 0)::bigint,
    m.billing_period::text,
    m.created_at,
    m.paid_at,
    m.updated_at
  from mine m
  join routes r on r.id = m.route_id
  left join pay on pay.booking_id = m.id
  left join institutions i on i.id = r.institution_id
  left join vehicles v on v.id = r.vehicle_id
  left join agencies ag on ag.id = r.agency_id
  left join route_stops ps on ps.id = m.pickup_stop_id
  where m.status = 'CONFIRMED'
     or (m.status in ('CANCELLED', 'REJECTED') and (coalesce(pay.was_paid, false) or m.is_paid))
  order by coalesce(m.paid_at, m.updated_at, m.created_at) desc;
$function$;


-- -----------------------------------------------------------------------------
-- verify_pass_renewal
--  (extra item) A REJECTED renewal payment was bell-only. Now also enqueues
--  email + push to the rider and linked parents (third-person copy + /parent
--  link for parents), like booking_notify. Bell row kept. The server action
--  (verifyPassRenewalAction) already flushes both outboxes via after().
--  #9 follow-up: pass_renewals.booking_id is now nullable (ON DELETE SET NULL);
--  a renewal whose booking was purged can no longer be approved/applied.
-- -----------------------------------------------------------------------------
create or replace function public.verify_pass_renewal(p_renewal_id uuid, p_approve boolean, p_note text default null::text)
 returns pass_renewals
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid(); v_role text; v_r pass_renewals; v_b bookings; v_start timestamptz;
  v_route text; v_title text; v_body text; v_note text := nullif(btrim(coalesce(p_note,'')),'');
  v_who text; v_ptitle text; v_pbody text; v_rejected boolean := false;
  v_student_pid uuid; v_is_parent boolean; v_rec record;
begin
  select role::text into v_role from profiles where id = v_uid and not coalesce(is_deleted, false);
  if v_role is distinct from 'SUPER_ADMIN' then
    raise exception 'Only an admin can verify payments' using errcode='P0003'; end if;
  select * into v_r from pass_renewals where id = p_renewal_id for update;
  if v_r.id is null then raise exception 'Renewal not found' using errcode='P0002'; end if;
  if v_r.status <> 'CREATED' then return v_r; end if;
  select * into v_b from bookings where id = v_r.booking_id for update;
  if v_b.id is null then
    raise exception 'The booking for this renewal no longer exists' using errcode='P0002'; end if;
  select coalesce(r.name, 'your route') into v_route from routes r where r.id = v_b.route_id;
  v_route := coalesce(v_route, 'your route');

  if p_approve and (v_b.status <> 'CONFIRMED' or v_b.cancel_requested_at is not null) then
    update pass_renewals set status = 'PAID', verified_at = now(), verified_by = v_uid,
           verify_note = coalesce(v_note, 'Booking no longer active — refunding')
     where id = v_r.id returning * into v_r;
    update payments set refund_status = 'REQUESTED', updated_at = now()
     where booking_id = v_b.id and status in ('PAID', 'REFUNDED') and refund_status <> 'REQUESTED';
    v_title := 'Renewal payment received — refund on the way';
    v_body := 'We received your renewal payment for ' || v_route ||
              ', but this booking is no longer active, so we''re refunding it to you.';
  elsif p_approve then
    v_start := greatest(public.booking_pass_end(v_b), now());
    update bookings set billing_period = v_r.billing_period, pass_start_at = v_start
     where id = v_b.id returning * into v_b;
    update pass_renewals set status = 'PAID', verified_at = now(), verified_by = v_uid,
           verify_note = v_note, period_start = v_start
     where id = v_r.id returning * into v_r;
    v_title := 'Bus pass renewed';
    v_body := 'Your pass for ' || v_route || ' is renewed until ' ||
              to_char(public.booking_pass_end(v_b) at time zone 'Asia/Kolkata', 'DD Mon YYYY') || '.';
  else
    update pass_renewals set status = 'FAILED', verified_at = now(), verified_by = v_uid, verify_note = v_note
     where id = v_r.id returning * into v_r;
    v_rejected := true;
    v_who := coalesce(nullif(btrim(v_b.student_name), ''), 'your child');
    v_title := 'Renewal payment could not be verified';
    v_body := 'We could not verify your renewal payment for ' || v_route ||
              '. Please pay again and re-enter the reference.' || coalesce(' Note: ' || v_note, '');
    v_ptitle := 'Renewal payment for ' || v_who || ' could not be verified';
    v_pbody := 'We could not verify the renewal payment for ' || v_who || '''s pass on ' || v_route ||
               '. Please pay again and re-enter the reference.' || coalesce(' Note: ' || v_note, '');
  end if;

  if not v_rejected then
    insert into notifications (institution_id, recipient_id, title, body)
    select v_b.institution_id, pid, v_title, v_body
    from (
      select s.profile_id as pid from students s
        where s.id = v_b.student_id and s.profile_id is not null
      union
      select pa.profile_id from parent_students ps
        join parents pa on pa.id = ps.parent_id
        where ps.student_id = v_b.student_id and pa.profile_id is not null
    ) t;
    return v_r;
  end if;

  -- Rejected: bell + email + push, parent-specific copy/links. Best-effort.
  begin
    select s.profile_id into v_student_pid from students s where s.id = v_b.student_id;
    for v_rec in
      select s.profile_id as pid, pr.email as email
      from students s left join profiles pr on pr.id = s.profile_id
      where s.id = v_b.student_id and s.profile_id is not null
      union
      select pa.profile_id, pr.email
      from parent_students ps
      join parents pa on pa.id = ps.parent_id
      left join profiles pr on pr.id = pa.profile_id
      where ps.student_id = v_b.student_id and pa.profile_id is not null
    loop
      v_is_parent := v_rec.pid is distinct from v_student_pid;
      insert into notifications (institution_id, recipient_id, title, body)
      values (v_b.institution_id, v_rec.pid,
              case when v_is_parent then v_ptitle else v_title end,
              case when v_is_parent then v_pbody else v_body end);
      if v_rec.email is not null then
        insert into email_outbox (recipient_id, to_email, kind, title, body, booking_id)
        values (v_rec.pid, v_rec.email, 'RENEWAL_REJECTED',
                case when v_is_parent then v_ptitle else v_title end,
                case when v_is_parent then v_pbody else v_body end, v_b.id);
      end if;
      insert into push_outbox (recipient_id, kind, title, body, url, booking_id)
      values (v_rec.pid, 'RENEWAL_REJECTED',
              case when v_is_parent then v_ptitle else v_title end,
              case when v_is_parent then v_pbody else v_body end,
              case when v_is_parent then '/parent' else '/student/bookings' end, v_b.id);
    end loop;
  exception when others then
    raise warning 'verify_pass_renewal notify failed for renewal %: %', p_renewal_id, sqlerrm;
  end;
  return v_r;
end; $function$;


-- -----------------------------------------------------------------------------
-- DATA FIXES
-- -----------------------------------------------------------------------------

-- #5 data: e54d09cc… is an ACTIVE CONFIRMED paid pass with no cancellation
-- request, yet its payment was flagged refund REQUESTED. Clear the stray flag
-- (no refund was ever processed: refunded_at/by/amount/note are all NULL).
update public.payments
   set refund_status = 'NONE', updated_at = now()
 where booking_id = 'e54d09cc-a7c7-48d4-be8a-1a148bd1fa25'
   and refund_status = 'REQUESTED'
   and exists (select 1 from public.bookings b
                where b.id = 'e54d09cc-a7c7-48d4-be8a-1a148bd1fa25'
                  and b.status = 'CONFIRMED' and b.cancel_requested_at is null);

-- #8 data: closed (CANCELLED/REJECTED) bookings whose payment is PAID but was
-- never queued for a refund (refund_status NONE) — money taken, nothing given,
-- invisible to the admin refunds queue. All 7 found live are the same shape
-- (legacy July pre-UTR "UPI" payments, PAID, booking closed, no refund):
--   1da273f0-95b4-4871-b8a1-dca4c7d78a99  REJECTED  ₹25,000  (named in audit)
--   a879f5e1-6f64-40e4-9783-effa81f3caae  CANCELLED ₹25,000  (named in audit)
--   aa01ef32-1824-4cd7-b7f4-f6be09fb2083  CANCELLED ₹10,000
--   5d78ece9-2a71-41bb-92b4-ea24a5e26a18  CANCELLED ₹10,000
--   127615b0-f0e7-4836-970a-fb1752d2ab58  CANCELLED ₹2,000
--   c6c14af3-ab5f-47dd-9fae-b209934157af  CANCELLED ₹9,000
--   997bd6a3-00e1-4045-9d9a-a593006fdaa4  CANCELLED ₹10,000
-- Queue them for the admin to approve/decline. The bookings are NOT touched
-- (an update would bump updated_at = the date history shows); the queue's
-- "requested at" falls back to the booking's last change, and process_refund
-- (#5) accepts them because the booking is already closed.
update public.payments p
   set refund_status = 'REQUESTED', updated_at = now()
 where p.booking_id in ('1da273f0-95b4-4871-b8a1-dca4c7d78a99', 'a879f5e1-6f64-40e4-9783-effa81f3caae',
                        'aa01ef32-1824-4cd7-b7f4-f6be09fb2083', '5d78ece9-2a71-41bb-92b4-ea24a5e26a18',
                        '127615b0-f0e7-4836-970a-fb1752d2ab58', 'c6c14af3-ab5f-47dd-9fae-b209934157af',
                        '997bd6a3-00e1-4045-9d9a-a593006fdaa4')
   and p.status = 'PAID'
   and p.refund_status = 'NONE'
   and exists (select 1 from public.bookings b
                where b.id = p.booking_id and b.status in ('CANCELLED', 'REJECTED'));

notify pgrst, 'reload schema';

-- ===== M_C_flows =====
-- ===========================================================================
-- M_C_flows — audit MEDIUM fixes #12–#15 (campus applications, service-request
-- approval gating, managed-child removal vs pending refunds, child campus).
-- Idempotent; merge into migration 0133.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- #12 Admin-created unverified college was treated as a campus APPLICATION
--     (one "Reject" click soft-deleted it) and restoring it brought it back
--     hidden. Mark real self-registered applications explicitly, and remember
--     each college's visibility at delete time so restore returns it there.
-- ---------------------------------------------------------------------------
alter table public.institutions
  add column if not exists self_registered boolean not null default false;
alter table public.institutions
  add column if not exists restore_active boolean;

comment on column public.institutions.self_registered is
  'True when the campus registered itself via /institution/register (a campus application). Only these appear under "Pending campus applications" and can be rejected.';
comment on column public.institutions.restore_active is
  'is_active captured at soft-delete time (trigger) so a restore returns the college to its prior visibility.';

-- Backfill: an UNVERIFIED campus whose INSTITUTION_ADMIN was created within
-- 15 minutes of the campus row (the self-signup flow creates both together) and
-- that was never added by an admin (no COLLEGE_ADDED audit entry).
update public.institutions i
   set self_registered = true
 where i.self_registered = false
   and i.is_verified = false
   and exists (
     select 1 from public.profiles p
      where p.institution_id = i.id
        and p.role = 'INSTITUTION_ADMIN'
        and p.created_at between i.created_at - interval '15 minutes'
                             and i.created_at + interval '15 minutes')
   and not exists (
     select 1 from public.audit_logs l
      where l.action = 'COLLEGE_ADDED' and l.entity_id::text = i.id::text);

-- Backfill restore_active for already-deleted rows: a (rejected) application
-- stays hidden; any other college was visible unless it was unverified+hidden.
update public.institutions
   set restore_active = case when self_registered and not is_verified then false else true end
 where is_deleted and restore_active is null;

create or replace function public.institutions_capture_restore_active()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.is_deleted and not coalesce(old.is_deleted, false) then
    -- Every soft-delete path (admin delete, application reject) flips is_active
    -- off in the same UPDATE — remember what it was BEFORE.
    new.restore_active := old.is_active;
  end if;
  return new;
end; $$;

drop trigger if exists trg_institutions_restore_active on public.institutions;
create trigger trg_institutions_restore_active
  before update of is_deleted on public.institutions
  for each row execute function public.institutions_capture_restore_active();

-- ---------------------------------------------------------------------------
-- #13 Service requests from rejected / deleted agencies stayed actionable —
--     approving one gave a rejected agency a live service area. Refuse BOTH
--     approval stages (campus accept + admin final) unless the agency is
--     APPROVED and not deleted. Applies to every writer incl. service role.
-- ---------------------------------------------------------------------------
create or replace function public.asr_require_live_agency()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if (new.status = 'APPROVED' and old.status is distinct from 'APPROVED')
     or (new.campus_status = 'APPROVED' and old.campus_status is distinct from 'APPROVED') then
    if not exists (select 1 from agencies a
                    where a.id = new.agency_id
                      and a.status = 'APPROVED'
                      and not coalesce(a.is_deleted, false)) then
      raise exception 'This agency is not approved (rejected, pending or removed) — its service request can only be rejected'
        using errcode = 'P0003';
    end if;
  end if;
  return new;
end; $$;

drop trigger if exists trg_asr_require_live_agency on public.agency_service_requests;
create trigger trg_asr_require_live_agency
  before update of status, campus_status on public.agency_service_requests
  for each row execute function public.asr_require_live_agency();

-- ---------------------------------------------------------------------------
-- #14 Removing a managed child hid any pending refund from the parent (the
--     child's bookings vanish from their dashboard once unlinked). Block the
--     removal while money is still in flight for that child: a refund awaiting
--     the admin (REQUESTED), a UPI payment awaiting verification, or a pass
--     renewal awaiting verification.
-- #15 (see set_child_campus below)
-- ---------------------------------------------------------------------------
create or replace function public.remove_managed_child(p_student_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_student students;
begin
  if not public.can_act_for_student(p_student_id) then
    raise exception 'Not your child' using errcode='P0003';
  end if;
  select * into v_student from students where id = p_student_id;
  if v_student.id is null then return; end if;
  if v_student.profile_id is not null then
    raise exception 'This child has their own account — remove the link instead' using errcode='P0003';
  end if;
  if exists (select 1 from bookings
              where student_id = p_student_id
                and status in ('PENDING','CONFIRMED','WAITLISTED')) then
    raise exception 'Cancel this child''s active booking before removing them' using errcode='P0007';
  end if;
  -- #14: never let a removal hide money still owed to / pending for the parent.
  if exists (select 1 from payments p join bookings b on b.id = p.booking_id
              where b.student_id = p_student_id
                and (p.refund_status = 'REQUESTED'
                     or (p.status = 'CREATED' and p.upi_utr is not null))) then
    raise exception 'This child has a refund or payment still being processed — you can remove them once it''s settled'
      using errcode='P0007';
  end if;
  if exists (select 1 from pass_renewals r join bookings b on b.id = r.booking_id
              where b.student_id = p_student_id and r.status = 'CREATED') then
    raise exception 'This child has a pass renewal payment still being verified — you can remove them once it''s settled'
      using errcode='P0007';
  end if;

  -- Any booking history or a second linked parent: keep the student row, just
  -- unlink THIS parent.
  if exists (select 1 from bookings where student_id = p_student_id)
     or exists (select 1 from parent_students ps join parents pa on pa.id = ps.parent_id
                 where ps.student_id = p_student_id and pa.profile_id <> auth.uid()) then
    delete from parent_students ps using parents pa
     where pa.id = ps.parent_id and ps.student_id = p_student_id and pa.profile_id = auth.uid();
    delete from parent_link_codes where student_id = p_student_id;
    return;
  end if;

  delete from students where id = p_student_id and profile_id is null;
end; $function$;

revoke execute on function public.remove_managed_child(uuid) from public, anon;
grant execute on function public.remove_managed_child(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- #15 A parent could set the campus on a child who has their OWN login,
--     exposing that child's details to the chosen campus's admin. Only a
--     MANAGED (login-less, profile_id NULL) child's campus is parent-editable.
-- ---------------------------------------------------------------------------
create or replace function public.set_child_campus(p_student_id uuid, p_institution_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not exists (select 1 from parent_students ps join parents pa on pa.id = ps.parent_id
                  where ps.student_id = p_student_id and pa.profile_id = auth.uid()) then
    raise exception 'Not your child' using errcode='P0003';
  end if;
  if exists (select 1 from students s where s.id = p_student_id and s.profile_id is not null) then
    raise exception 'This child has their own account and chooses their campus themselves' using errcode='P0003';
  end if;
  if not exists (select 1 from institutions i
                  where i.id = p_institution_id and i.is_active and not i.is_deleted) then
    raise exception 'Pick a campus from the list' using errcode='P0002';
  end if;
  update students set institution_id = p_institution_id, updated_at = now()
   where id = p_student_id and profile_id is null;
end; $function$;

revoke execute on function public.set_child_campus(uuid, uuid) from public, anon;
grant execute on function public.set_child_campus(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';

-- ===== M_D_notify =====
-- =============================================================================
-- M_D_notify — audit MEDIUM #11, #16 (#17 is UI-only, no SQL)
-- Idempotent. Built from the LIVE definitions (pg_get_functiondef, 2026-10-01).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- #11  "Payment could not be verified — pay again" was bell-only (inserted by
-- verify_upi_payment), so a rider outside the app missed the fresh 10-minute
-- pay window. verify_upi_payment is NOT changed here: booking_notify now reacts
-- to the payment_status change it makes and enqueues EMAIL + PUSH (student and
-- linked parents, parent wording + /parent link). No bell from booking_notify
-- for these two kinds — verify_upi_payment already inserts the bell row, so
-- adding one here would double it.
--   * PENDING row, payment_status -> 'REJECTED' (status unchanged): kind
--     PAYMENT_REJECTED ("pay again within 10 minutes", "(last attempt)" on the
--     2nd rejection, admin note from payments.verify_note).
--   * PENDING -> CANCELLED with cancel_cause 'PAYMENT_REJECTED' (3rd rejection,
--     only ever set by verify_upi_payment): kind PAYMENT_REJECTED_FINAL with
--     the "seat released" copy, replacing the generic "Booking cancelled" bell
--     + email + push it used to get (that bell duplicated verify's own bell).
-- ---------------------------------------------------------------------------
create or replace function public.booking_notify()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_route       text;
  v_who         text;
  v_title       text;
  v_body        text;
  v_kind        text;
  v_url         text;
  v_student_pid uuid;
  v_ptitle      text;   -- parent-facing (third person) variants
  v_pbody       text;
  v_is_parent   boolean;
  v_skip_student boolean := false;
  v_no_bell     boolean := false;  -- #11: bell already written by verify_upi_payment
  v_note        text;
  v_rec         record;
begin
  begin
    if tg_op = 'INSERT' then
      if new.status = 'PENDING' then
        v_kind := 'RESERVED';
      elsif new.status = 'WAITLISTED' then
        v_kind := 'WAITLISTED';
      else
        return new;
      end if;
    elsif tg_op = 'UPDATE' then
      if new.status is not distinct from old.status then
        -- #11: UPI reference rejected but the hold reopened for another try.
        if new.status = 'PENDING'
           and new.payment_status = 'REJECTED'
           and old.payment_status is distinct from 'REJECTED' then
          v_kind := 'PAYMENT_REJECTED';
          v_no_bell := true;
        else
          return new;
        end if;
      elsif new.status = 'CONFIRMED' then
        v_kind := 'CONFIRMED';
      elsif new.status = 'REJECTED' then
        v_kind := 'REJECTED';
      elsif new.status = 'PENDING' and old.status = 'WAITLISTED' then
        v_kind := 'PROMOTED';
      elsif new.status = 'CANCELLED' then
        if new.cancel_cause = 'PAYMENT_TIMEOUT' then
          v_kind := 'EXPIRED';
        elsif new.cancel_cause = 'PAYMENT_REJECTED' then
          v_kind := 'PAYMENT_REJECTED_FINAL';   -- #11
          v_no_bell := true;
        elsif new.cancel_cause = 'STUDENT' then
          v_kind := 'CANCELLED_SELF';
        elsif new.cancel_cause = 'PARENT' then
          v_kind := 'CANCELLED_PARENT';
        elsif new.cancel_cause = 'PASS_ENDED' then
          v_kind := 'PASS_ENDED';
        else
          v_kind := 'CANCELLED';
        end if;
      else
        return new;
      end if;
    else
      return new;
    end if;

    select r.name into v_route from routes r where r.id = new.route_id;
    v_route := coalesce(v_route, 'your route');
    v_who := coalesce(nullif(btrim(new.student_name), ''), 'Your child');
    select s.profile_id into v_student_pid from students s where s.id = new.student_id;

    if v_kind in ('PAYMENT_REJECTED', 'PAYMENT_REJECTED_FINAL') then
      -- verify_upi_payment marks the payment FAILED (with the admin's note)
      -- just before it updates the booking, in the same transaction.
      select nullif(btrim(p.verify_note), '') into v_note
      from payments p
      where p.booking_id = new.id and p.status = 'FAILED'
      order by p.verified_at desc nulls last, p.updated_at desc nulls last
      limit 1;
    end if;

    if v_kind = 'RESERVED' then
      v_title := 'Seat reserved — finish payment';
      v_body  := 'Your seat on ' || v_route || ' is held. Complete payment within 10 minutes to confirm it.';
      v_ptitle := 'Seat reserved for ' || v_who || ' — finish payment';
      v_pbody  := v_who || '''s seat on ' || v_route || ' is held. Complete payment within 10 minutes to confirm it.';
    elsif v_kind = 'WAITLISTED' then
      v_title := 'You''re on the waitlist';
      v_body  := v_route || ' is full right now — you''re on the waitlist and we''ll let you know the moment a seat opens up.';
      v_ptitle := v_who || ' is on the waitlist';
      v_pbody  := v_route || ' is full right now — ' || v_who || ' is on the waitlist and we''ll let you know the moment a seat opens up.';
    elsif v_kind = 'CONFIRMED' then
      v_title := 'Booking confirmed';
      v_body  := 'Your seat on ' || v_route || ' is confirmed. Have a safe ride!';
      v_ptitle := 'Booking confirmed for ' || v_who;
      v_pbody  := v_who || '''s seat on ' || v_route || ' is confirmed.';
    elsif v_kind = 'REJECTED' then
      v_title := 'Booking rejected';
      v_body  := 'Your booking for ' || v_route || ' was rejected by the agency. Any payment hold has been released — you can book another route anytime.';
      v_pbody  := v_who || '''s booking for ' || v_route || ' was rejected by the agency. Any payment hold has been released — you can book another route anytime.';
    elsif v_kind = 'PROMOTED' then
      v_title := 'A seat opened up!';
      v_body  := 'Good news — a seat opened on ' || v_route || '. Complete payment within 10 minutes to confirm it before it''s offered to the next person.';
      v_ptitle := 'A seat opened up for ' || v_who || '!';
      v_pbody  := 'Good news — a seat opened on ' || v_route || ' for ' || v_who || '. Complete payment within 10 minutes to confirm it before it''s offered to the next person.';
    elsif v_kind = 'EXPIRED' then
      v_title := 'Reservation expired';
      v_body  := 'Your seat hold on ' || v_route || ' expired because payment wasn''t completed in time. The seat has been released — you can book again anytime.';
      v_pbody  := v_who || '''s seat hold on ' || v_route || ' expired because payment wasn''t completed in time. The seat has been released — you can book again anytime.';
    elsif v_kind = 'PAYMENT_REJECTED' then
      v_title := 'Payment could not be verified — pay again';
      v_body  := 'We could not verify your UPI payment for ' || v_route ||
                 '. Your seat is held for 10 more minutes — pay again and re-enter the reference to confirm it' ||
                 case when new.utr_attempts = 2 then ' (last attempt).' else '.' end ||
                 coalesce(' Note: ' || v_note, '');
      v_ptitle := 'Payment for ' || v_who || ' could not be verified — pay again';
      v_pbody  := 'We could not verify the UPI payment for ' || v_who || '''s seat on ' || v_route ||
                 '. The seat is held for 10 more minutes — pay again and re-enter the reference to confirm it' ||
                 case when new.utr_attempts = 2 then ' (last attempt).' else '.' end ||
                 coalesce(' Note: ' || v_note, '');
    elsif v_kind = 'PAYMENT_REJECTED_FINAL' then
      v_title := 'Payment could not be verified — seat released';
      v_body  := 'We could not verify your UPI payment for ' || v_route ||
                 ' after 3 attempts, so the seat hold was released. If money left your account, ' ||
                 'contact support with your UPI reference.' || coalesce(' Note: ' || v_note, '');
      v_ptitle := 'Payment for ' || v_who || ' could not be verified — seat released';
      v_pbody  := 'We could not verify the UPI payment for ' || v_who || '''s seat on ' || v_route ||
                 ' after 3 attempts, so the seat hold was released. If money left your account, ' ||
                 'contact support with your UPI reference.' || coalesce(' Note: ' || v_note, '');
    elsif v_kind = 'CANCELLED_SELF' then
      v_kind  := 'CANCELLED';
      v_skip_student := true;
      v_title := 'Booking cancelled';
      v_body  := v_who || ' cancelled their booking for ' || v_route || '.';
    elsif v_kind = 'CANCELLED_PARENT' then
      -- A parent cancelled: tell everyone, including the student.
      v_kind  := 'CANCELLED';
      v_title := 'Booking cancelled';
      v_body  := 'A parent cancelled ' || v_who || '''s booking for ' || v_route || '.';
    elsif v_kind = 'PASS_ENDED' then
      v_kind  := 'CANCELLED';
      v_title := 'Bus pass ended';
      v_body  := 'The bus pass for ' || v_route || ' has ended and the seat was released. Book again anytime to keep riding.';
      v_pbody  := v_who || '''s bus pass for ' || v_route || ' has ended and the seat was released. Book again anytime to keep riding.';
    else
      v_title := 'Booking cancelled';
      v_body  := 'Your booking for ' || v_route || ' was cancelled and the seat released.';
      v_pbody  := v_who || '''s booking for ' || v_route || ' was cancelled and the seat released.';
    end if;
    -- Kinds already written in the third person reuse the same copy for parents.
    v_ptitle := coalesce(v_ptitle, v_title);
    v_pbody  := coalesce(v_pbody, v_body);

    for v_rec in
      select s.profile_id as pid, pr.email as email
      from students s
      left join profiles pr on pr.id = s.profile_id
      where s.id = new.student_id and s.profile_id is not null
      union
      select pa.profile_id, pr.email
      from parent_students ps
      join parents pa on pa.id = ps.parent_id
      left join profiles pr on pr.id = pa.profile_id
      where ps.student_id = new.student_id and pa.profile_id is not null
    loop
      if v_skip_student and v_rec.pid = v_student_pid then
        continue;
      end if;

      -- Anyone who isn't the rider's own login is a linked parent: third-person
      -- copy and a /parent link (parents can't open /student pages).
      v_is_parent := v_rec.pid is distinct from v_student_pid;
      v_url := case when v_is_parent then '/parent' else '/student/bookings' end;

      if not v_no_bell then
        insert into notifications (institution_id, recipient_id, title, body)
        values (new.institution_id, v_rec.pid,
                case when v_is_parent then v_ptitle else v_title end,
                case when v_is_parent then v_pbody else v_body end);
      end if;

      if v_rec.email is not null then
        insert into email_outbox (recipient_id, to_email, kind, title, body, booking_id)
        values (v_rec.pid, v_rec.email, v_kind,
                case when v_is_parent then v_ptitle else v_title end,
                case when v_is_parent then v_pbody else v_body end, new.id);
      end if;

      insert into push_outbox (recipient_id, kind, title, body, url, booking_id)
      values (v_rec.pid, v_kind,
              case when v_is_parent then v_ptitle else v_title end,
              case when v_is_parent then v_pbody else v_body end, v_url, new.id);
    end loop;

  exception when others then
    raise warning 'booking_notify failed for booking %: %', new.id, sqlerrm;
  end;

  return new;
end; $function$;

-- ---------------------------------------------------------------------------
-- #16  Skip-stop / next-stop notices were bell-only and also reached PENDING
-- (unpaid) riders. notify_stop_riders now:
--   * targets only ACTIVE riders (booking_is_active_ride: CONFIRMED, no cancel
--     request, pass not ended) booked at that pickup stop;
--   * writes the bell + a PUSH row for every recipient, and an EMAIL row when
--     p_email (used for skip, since it changes where to board);
--   * gives linked parents third-person copy naming the child and a /parent
--     link (students get /student).
-- Signature grows (p_kind, p_email), so the old 5-arg version is dropped; it is
-- internal-only (callers are the two driver RPCs below) and keeps its
-- service-role-only EXECUTE.
-- ---------------------------------------------------------------------------
drop function if exists public.notify_stop_riders(uuid, uuid, uuid, text, text);

create or replace function public.notify_stop_riders(
  p_route_id uuid, p_stop_id uuid, p_institution_id uuid,
  p_title text, p_body text, p_kind text, p_email boolean default false)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_rec record;
  v_title text;
  v_body text;
begin
  for v_rec in
    with riders as (
      select b.id as booking_id, s.profile_id as student_pid,
             coalesce(nullif(btrim(b.student_name), ''), nullif(btrim(s.full_name), ''), 'Your child') as who,
             s.id as student_id
      from bookings b
      join students s on s.id = b.student_id
      where b.route_id = p_route_id and b.pickup_stop_id = p_stop_id
        and public.booking_is_active_ride(b)
    ), recipients as (
      select r.booking_id, r.who, r.student_pid as pid, false as is_parent
      from riders r where r.student_pid is not null
      union
      select r.booking_id, r.who, pa.profile_id, true
      from riders r
      join parent_students ps on ps.student_id = r.student_id
      join parents pa on pa.id = ps.parent_id
      where pa.profile_id is not null
        and pa.profile_id is distinct from r.student_pid
    )
    select distinct on (rc.pid, rc.booking_id)
           rc.pid, rc.booking_id, rc.who, rc.is_parent, pr.email
    from recipients rc
    left join profiles pr on pr.id = rc.pid
    order by rc.pid, rc.booking_id, rc.is_parent
  loop
    if v_rec.is_parent then
      v_title := p_title || ' — ' || v_rec.who;
      v_body  := 'For ' || v_rec.who || ': ' || p_body;
    else
      v_title := p_title;
      v_body  := p_body;
    end if;

    insert into notifications (institution_id, recipient_id, title, body)
    values (p_institution_id, v_rec.pid, v_title, v_body);

    insert into push_outbox (recipient_id, kind, title, body, url, booking_id)
    values (v_rec.pid, coalesce(p_kind, 'STOP_UPDATE'), v_title, v_body,
            case when v_rec.is_parent then '/parent' else '/student' end,
            v_rec.booking_id);

    if p_email and v_rec.email is not null then
      insert into email_outbox (recipient_id, to_email, kind, title, body, booking_id)
      values (v_rec.pid, v_rec.email, coalesce(p_kind, 'STOP_UPDATE'),
              v_title, v_body, v_rec.booking_id);
    end if;
  end loop;
end; $function$;

revoke all on function
  public.notify_stop_riders(uuid, uuid, uuid, text, text, text, boolean)
  from public, anon, authenticated;
grant execute on function
  public.notify_stop_riders(uuid, uuid, uuid, text, text, text, boolean)
  to service_role;

-- #16  driver_skip_stop: unchanged logic, now calls the 7-arg notifier with
-- kind STOP_SKIPPED + email (pickup point changed).
create or replace function public.driver_skip_stop(p_route_id uuid, p_stop_id uuid)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_institution uuid := public.driver_assert_route(p_route_id);
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_stop_name text;
  v_seq int;
  v_next_name text;
  v_barrier_seq int;
  v_body text;
  v_rec record;
  v_was_skipped boolean;
begin
  select rs.name, rs.sequence into v_stop_name, v_seq
  from route_stops rs where rs.id = p_stop_id and rs.route_id = p_route_id;
  if v_stop_name is null then
    raise exception 'That stop is not on this route' using errcode = 'P0004';
  end if;

  -- #27: already skipped today? Then this is a re-tap — don't re-alert riders.
  select exists (
    select 1 from route_stop_progress p
    where p.route_id = p_route_id and p.stop_id = p_stop_id
      and p.service_date = v_today and p.status = 'SKIPPED'
  ) into v_was_skipped;

  if not v_was_skipped then
    insert into route_stop_progress
      (institution_id, route_id, stop_id, service_date, status, recorded_by, recorded_at)
    values (v_institution, p_route_id, p_stop_id, v_today, 'SKIPPED', v_uid, now())
    on conflict (route_id, stop_id, service_date)
    do update set status = 'SKIPPED', recorded_by = v_uid, recorded_at = now();
  end if;

  -- Next stop by sequence that is NOT skipped today (rolls forward past other
  -- skipped stops). The just-skipped stop is excluded by sequence > v_seq.
  select rs.name into v_next_name
  from route_stops rs
  where rs.route_id = p_route_id and rs.sequence > v_seq
    and not exists (
      select 1 from route_stop_progress p
      where p.route_id = p_route_id and p.stop_id = rs.id
        and p.service_date = v_today and p.status = 'SKIPPED')
  order by rs.sequence
  limit 1;

  if v_was_skipped then return v_next_name; end if; -- no change → no re-notify

  if v_next_name is not null then
    v_body := 'The bus will not stop at ' || v_stop_name
      || ' today. Please go to the next stop, ' || v_next_name || ', to board.';
  else
    v_body := 'The bus will not stop at ' || v_stop_name
      || ' today. Please contact your service provider for an alternative.';
  end if;

  -- The last NON-skipped stop before this one is the barrier: every stop after it
  -- up to and including this one is skipped today, so riders at any of them are
  -- (now) redirected to v_next_name and must be told.
  select coalesce(max(rs.sequence), -1) into v_barrier_seq
  from route_stops rs
  where rs.route_id = p_route_id and rs.sequence < v_seq
    and not exists (
      select 1 from route_stop_progress p
      where p.route_id = p_route_id and p.stop_id = rs.id
        and p.service_date = v_today and p.status = 'SKIPPED');

  for v_rec in
    select rs.id as stop_id
    from route_stops rs
    where rs.route_id = p_route_id
      and rs.sequence > v_barrier_seq and rs.sequence <= v_seq
  loop
    perform public.notify_stop_riders(
      p_route_id, v_rec.stop_id, v_institution, 'Pickup point changed', v_body,
      'STOP_SKIPPED', true);
  end loop;

  return v_next_name;
end; $function$;

-- #16  driver_set_next_stop: unchanged logic, push-only (kind BUS_NEXT_STOP).
create or replace function public.driver_set_next_stop(p_route_id uuid, p_stop_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_institution uuid := public.driver_assert_route(p_route_id);
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_stop_name text;
  v_bus text;
  v_was_next boolean;
begin
  select rs.name into v_stop_name
  from route_stops rs where rs.id = p_stop_id and rs.route_id = p_route_id;
  if v_stop_name is null then
    raise exception 'That stop is not on this route' using errcode = 'P0004';
  end if;

  -- Was this exact stop already marked NEXT today? A re-tap should not re-alert.
  select exists (
    select 1 from route_stop_progress p
    where p.route_id = p_route_id and p.stop_id = p_stop_id
      and p.service_date = v_today and p.status = 'NEXT'
  ) into v_was_next;

  -- At most one NEXT per route/day.
  delete from route_stop_progress
  where route_id = p_route_id and service_date = v_today
    and status = 'NEXT' and stop_id <> p_stop_id;

  insert into route_stop_progress
    (institution_id, route_id, stop_id, service_date, status, recorded_by, recorded_at)
  values (v_institution, p_route_id, p_stop_id, v_today, 'NEXT', v_uid, now())
  on conflict (route_id, stop_id, service_date)
  do update set status = 'NEXT', recorded_by = v_uid, recorded_at = now();

  if v_was_next then return; end if; -- no change → don't re-alert riders

  select v.bus_number into v_bus
  from routes r join vehicles v on v.id = r.vehicle_id where r.id = p_route_id;

  perform public.notify_stop_riders(
    p_route_id, p_stop_id, v_institution,
    'Bus on the way',
    coalesce('Bus ' || v_bus, 'Your bus') || ' is heading to ' || v_stop_name
      || ' next. Please be ready.',
    'BUS_NEXT_STOP', false);
end; $function$;

insert into public.schema_migrations_applied (version, name) values ('0133', '0133_audit5_mediums') on conflict do nothing;
notify pgrst, 'reload schema';
