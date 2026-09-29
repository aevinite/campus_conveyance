-- 0128_audit4_lockdown.sql (idempotent)
-- Audit round 4 fixes:
--   1. pay_booking (legacy "mark paid" RPC) dropped — anyone could self-confirm.
--   2. Service-only RPCs (outbox claims, cron helpers) no longer callable by
--      anon/authenticated (0093/0094 only revoked from PUBLIC).
--   3. *_tenant_rw FOR ALL policies split: SUPER_ADMIN keeps ALL, a campus admin
--      (JWT institution_id) gets READ only. Campus panels read via service role.
--   4. Driver/conductor Aadhaar, DOB, address hidden from every non-service
--      reader via column privileges; riders see only the last 4 of the ID.
--   5. Agencies can no longer create service areas themselves: add_route checks
--      the agency serves the campus, agency_services is admin-write only,
--      requests must be filed PENDING, and signup campuses become requests.
--   6. Agencies can no longer DELETE/INSERT/UPDATE routes directly (all route
--      writes go through add_route/update_route) — no paid-booking cascade.
--   7. admin_report / agency_report revenue = amount actually paid + renewals.
--   9. parent_children falls back to the campus of the child's latest booking;
--      set_child_campus lets a parent set it when there is none.
--  10. remove_managed_child keeps the student row when it has booking history
--      (so its payments/refunds stay approvable) and only unlinks the parent.

-- ---------------------------------------------------------------------------
-- 1 + 2. RPC grants
-- ---------------------------------------------------------------------------
drop function if exists public.pay_booking(uuid);

revoke execute on function public.claim_email_outbox(integer) from public, anon, authenticated;
revoke execute on function public.claim_push_outbox(integer)  from public, anon, authenticated;
revoke execute on function public.expire_stale_holds()        from public, anon, authenticated;
revoke execute on function public.set_bus_driver_today(uuid, text, text, text, text) from public, anon;
revoke execute on function public.remove_managed_child(uuid) from public, anon;

-- ---------------------------------------------------------------------------
-- 3. Tenant policies: read-only for campus admins
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['audit_logs','bookings','drivers','notifications','parents',
    'payments','route_assignments','route_stops','routes','seat_allocations','students','vehicles']
  loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop policy if exists %I on public.%I', t || '_tenant_rw', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_all', t);
    execute format('drop policy if exists %I on public.%I', t || '_tenant_read', t);
    execute format($p$create policy %I on public.%I for all
      using (public.jwt_role() = 'SUPER_ADMIN') with check (public.jwt_role() = 'SUPER_ADMIN')$p$,
      t || '_admin_all', t);
    execute format($p$create policy %I on public.%I for select
      using (public.jwt_institution() is not null and institution_id = public.jwt_institution())$p$,
      t || '_tenant_read', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Driver / conductor identity documents
-- ---------------------------------------------------------------------------
alter table public.vehicles
  add column if not exists driver_govt_id_last4 text generated always as
    (case when driver_govt_id is null then null
          else right(regexp_replace(driver_govt_id, '\s', '', 'g'), 4) end) stored;
alter table public.vehicles
  add column if not exists conductor_govt_id_last4 text generated always as
    (case when conductor_govt_id is null then null
          else right(regexp_replace(conductor_govt_id, '\s', '', 'g'), 4) end) stored;
alter table public.bus_driver_changes
  add column if not exists driver_govt_id_last4 text generated always as
    (case when driver_govt_id is null then null
          else right(regexp_replace(driver_govt_id, '\s', '', 'g'), 4) end) stored;

-- Column-level SELECT: every column EXCEPT the sensitive ones. NOTE: a column
-- added to these tables later must be granted explicitly (or clients get
-- "permission denied" when selecting it).
do $$
declare cols text;
begin
  revoke select on public.vehicles from anon, authenticated;
  select string_agg(quote_ident(column_name), ', ') into cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'vehicles'
     and column_name not in ('driver_govt_id','driver_address','driver_dob',
                             'conductor_govt_id','conductor_address','conductor_dob');
  execute format('grant select (%s) on public.vehicles to authenticated', cols);

  revoke select on public.bus_driver_changes from anon, authenticated;
  select string_agg(quote_ident(column_name), ', ') into cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'bus_driver_changes'
     and column_name not in ('driver_govt_id');
  execute format('grant select (%s) on public.bus_driver_changes to authenticated', cols);
end $$;

-- ---------------------------------------------------------------------------
-- 5. Service-area approval can't be bypassed
-- ---------------------------------------------------------------------------
drop policy if exists agency_services_write on public.agency_services;
drop policy if exists agency_services_admin_write on public.agency_services;
create policy agency_services_admin_write on public.agency_services for all
  using (public.jwt_role() = 'SUPER_ADMIN') with check (public.jwt_role() = 'SUPER_ADMIN');

drop policy if exists asr_insert on public.agency_service_requests;
create policy asr_insert on public.agency_service_requests for insert to authenticated
  with check (
    status = 'PENDING' and campus_status = 'PENDING'
    and reviewed_at is null and reviewed_by is null and rejected_reason is null
    and agency_id in (select a.id from agencies a
                       where a.owner_profile_id = auth.uid() and a.status = 'APPROVED')
    and institution_id in (select i.id from institutions i where not i.is_deleted)
  );

create or replace function public.add_route(p_agency_id uuid, p_agency_service_id uuid, p_institution_id uuid, p_vehicle_id uuid, p_start_location text, p_price_monthly_cents bigint, p_price_semester_cents bigint, p_price_yearly_cents bigint, p_departure_time time without time zone, p_image_url text, p_stops jsonb DEFAULT '[]'::jsonb)
 returns routes
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_route routes; v_cap int; v_ra uuid; v_vtype vehicle_type; v_primary bigint; v_svc uuid;
begin
  if not exists (select 1 from agencies where id=p_agency_id and owner_profile_id=auth.uid() and status='APPROVED') then
    raise exception 'Agency not approved' using errcode='P0003'; end if;
  select capacity, vehicle_type into v_cap, v_vtype from vehicles where id=p_vehicle_id and agency_id=p_agency_id;
  if v_cap is null then raise exception 'Bus not found' using errcode='P0002'; end if;

  -- The agency must have an APPROVED service area at this campus (created only by
  -- the campus → admin review). A supplied service id must be that same area.
  select s.id into v_svc from agency_services s
   where s.agency_id = p_agency_id and s.institution_id = p_institution_id
     and (p_agency_service_id is null or s.id = p_agency_service_id)
   order by (s.vehicle_type = v_vtype) desc, s.vehicle_type
   limit 1;
  if v_svc is null then
    raise exception 'You don''t serve this campus yet — request it under Service areas first' using errcode='P0003';
  end if;

  if coalesce(p_price_monthly_cents,0) <= 0
     and coalesce(p_price_semester_cents,0) <= 0
     and coalesce(p_price_yearly_cents,0) <= 0 then
    raise exception 'Set a price for at least one plan (monthly, semester or yearly)' using errcode='P0014';
  end if;
  v_primary := coalesce(nullif(p_price_semester_cents,0), nullif(p_price_yearly_cents,0), nullif(p_price_monthly_cents,0));

  insert into routes (institution_id, agency_id, agency_service_id, vehicle_id, vehicle_type,
    name, start_location, price_cents, price_monthly_cents, price_semester_cents, price_yearly_cents,
    departure_time, image_url, is_active)
  values (p_institution_id, p_agency_id, v_svc, p_vehicle_id, v_vtype,
    coalesce(nullif(p_start_location,''),'Route'), p_start_location, v_primary,
    nullif(p_price_monthly_cents,0), nullif(p_price_semester_cents,0), nullif(p_price_yearly_cents,0),
    p_departure_time, p_image_url, true)
  returning * into v_route;

  insert into route_assignments (institution_id, route_id, vehicle_id)
  values (p_institution_id, v_route.id, p_vehicle_id) returning id into v_ra;
  insert into seat_allocations (institution_id, route_assignment_id, total_seats, reserved_seats)
  values (p_institution_id, v_ra, v_cap, 0);

  insert into route_stops (institution_id, route_id, name, sequence, lat, lng, address, description)
  select p_institution_id, v_route.id,
         coalesce(nullif(elem->>'name',''), 'Stop ' || ord::text),
         ord::int,
         (elem->>'lat')::double precision,
         (elem->>'lng')::double precision,
         nullif(elem->>'address',''),
         nullif(elem->>'description','')
  from jsonb_array_elements(coalesce(p_stops, '[]'::jsonb)) with ordinality as t(elem, ord)
  where (elem->>'lat') is not null and (elem->>'lng') is not null;

  return v_route;
end; $function$;
revoke execute on function public.add_route(uuid, uuid, uuid, uuid, text, bigint, bigint, bigint, time, text, jsonb) from public, anon;
grant execute on function public.add_route(uuid, uuid, uuid, uuid, text, bigint, bigint, bigint, time, text, jsonb) to authenticated;

-- Signup campuses are filed as PENDING service requests (campus → admin review),
-- never as live service areas.
create or replace function public.handle_new_user()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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

-- ---------------------------------------------------------------------------
-- 6. Routes: no direct agency writes (RPCs only)
-- ---------------------------------------------------------------------------
drop policy if exists routes_agency_write on public.routes;

-- ---------------------------------------------------------------------------
-- 7. Revenue = what riders actually paid (+ verified pass renewals)
-- ---------------------------------------------------------------------------
create or replace function public.admin_report()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with prov as (
    select a.id, a.name from agencies a where a.status = 'APPROVED' and a.is_deleted = false
  ),
  fleet as (
    select v.agency_id,
           count(*) filter (where v.vehicle_type <> 'VAN') as buses,
           count(*) filter (where v.vehicle_type = 'VAN')  as vans
    from vehicles v where v.agency_id is not null group by v.agency_id
  ),
  studs as (
    select r.agency_id, count(distinct b.student_id) as students
    from bookings b join routes r on r.id = b.route_id
    where b.status in ('PENDING','CONFIRMED') and r.agency_id is not null
    group by r.agency_id
  ),
  rows as (
    select p.id, p.name,
           coalesce(f.buses,0) buses, coalesce(f.vans,0) vans, coalesce(s.students,0) students
    from prov p
    left join fleet f on f.agency_id = p.id
    left join studs s on s.agency_id = p.id
    order by p.name
  ),
  bk as (
    select b.id, b.is_paid,
           coalesce(case b.billing_period
                      when 'MONTHLY'  then r.price_monthly_cents
                      when 'SEMESTER' then r.price_semester_cents
                      when 'YEARLY'   then r.price_yearly_cents end,
                    r.price_cents) as expected_cents,
           (select p.amount_cents from payments p
             where p.booking_id = b.id and p.status = 'PAID' limit 1) as paid_cents,
           (select coalesce(sum(pr.amount_cents),0) from pass_renewals pr
             where pr.booking_id = b.id and pr.status = 'PAID') as renewal_cents
    from bookings b join routes r on r.id = b.route_id
    where b.status in ('PENDING','CONFIRMED')
  ),
  fees as (
    select count(*) filter (where is_paid)     as paid_count,
           count(*) filter (where not is_paid) as unpaid_count,
           coalesce(sum(coalesce(paid_cents, expected_cents) + renewal_cents) filter (where is_paid),0) as paid_cents,
           coalesce(sum(expected_cents) filter (where not is_paid),0) as unpaid_cents
    from bk
  )
  select jsonb_build_object(
    'providers', coalesce((select jsonb_agg(jsonb_build_object(
       'agencyId', id, 'name', name, 'buses', buses, 'vans', vans, 'students', students)) from rows), '[]'::jsonb),
    'totals', (select jsonb_build_object(
       'buses', coalesce(sum(buses),0), 'vans', coalesce(sum(vans),0), 'students', coalesce(sum(students),0)) from rows),
    'payments', (select jsonb_build_object(
       'paidCount', paid_count, 'unpaidCount', unpaid_count, 'paidCents', paid_cents, 'unpaidCents', unpaid_cents) from fees)
  );
$function$;

create or replace function public.agency_report(p_agency_id uuid)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with routes_inst as (
    select coalesce(i.name, '—') as name, r.vehicle_type
    from routes r left join institutions i on i.id = r.institution_id
    where r.agency_id = p_agency_id
  ),
  veh as (
    select count(*) filter (where vehicle_type <> 'VAN') buses,
           count(*) filter (where vehicle_type = 'VAN')  vans
    from vehicles where agency_id = p_agency_id
  ),
  fleet_by_college as (
    select name, count(*) filter (where vehicle_type <> 'VAN') buses,
                 count(*) filter (where vehicle_type = 'VAN')  vans
    from routes_inst group by name order by name
  ),
  routes_by_inst as (
    select name, count(*) routes from routes_inst group by name order by name
  ),
  bk as (
    select b.id, b.status, b.is_paid, b.paid_at, b.student_id, b.cancel_cause,
           coalesce(r.name, r.start_location) route_name,
           coalesce((select p.amount_cents from payments p
                      where p.booking_id = b.id and p.status = 'PAID' limit 1),
                    case b.billing_period
                      when 'MONTHLY'  then r.price_monthly_cents
                      when 'SEMESTER' then r.price_semester_cents
                      when 'YEARLY'   then r.price_yearly_cents end,
                    r.price_cents) as paid_cents
    from bookings b join routes r on r.id = b.route_id where r.agency_id = p_agency_id
  ),
  bcounts as (
    select count(*) filter (where status='PENDING')   pending,
           count(*) filter (where status='CONFIRMED') confirmed,
           count(*) filter (where status='REJECTED')  rejected,
           count(*) filter (where status='CANCELLED') cancelled,
           count(*) total
    from bk
  ),
  -- Earned money: paid bookings still running, or whose pass simply ran out
  -- (not refunded). Each first payment is dated by paid_at, each renewal by
  -- its own verification time.
  earned as (
    select id, route_name, paid_cents amount, paid_at at_ts from bk
     where is_paid and (status = 'CONFIRMED' or (status = 'CANCELLED' and cancel_cause = 'PASS_ENDED'))
    union all
    select bk.id, bk.route_name, pr.amount_cents, pr.verified_at
      from pass_renewals pr join bk on bk.id = pr.booking_id
     where pr.status = 'PAID'
  ),
  rev as (
    select coalesce(sum(amount),0) total_cents,
           coalesce(sum(amount) filter (where (at_ts at time zone 'Asia/Kolkata') >= date_trunc('day',   now() at time zone 'Asia/Kolkata')),0) today_cents,
           coalesce(sum(amount) filter (where (at_ts at time zone 'Asia/Kolkata') >= date_trunc('month', now() at time zone 'Asia/Kolkata')),0) month_cents
    from earned
  ),
  rev_by_route as (
    select route_name name, count(distinct id) bookings, coalesce(sum(amount),0) revenue_cents
    from earned
    group by route_name order by revenue_cents desc
  ),
  active_students as (
    select count(distinct b.student_id) c from bk b
    where b.status='CONFIRMED' and b.student_id is not null
      and not exists (select 1 from agency_hidden_students h
                      where h.agency_id = p_agency_id and h.student_id = b.student_id)
  )
  select jsonb_build_object(
    'fleet', (select jsonb_build_object('buses',buses,'vans',vans) from veh),
    'fleetByCollege', coalesce((select jsonb_agg(jsonb_build_object('name',name,'buses',buses,'vans',vans)) from fleet_by_college),'[]'::jsonb),
    'routesByInstitution', coalesce((select jsonb_agg(jsonb_build_object('name',name,'routes',routes)) from routes_by_inst),'[]'::jsonb),
    'bookings', (select jsonb_build_object('pending',pending,'confirmed',confirmed,'rejected',rejected,'cancelled',cancelled,'total',total) from bcounts),
    'revenue', jsonb_build_object(
       'todayCents', (select today_cents from rev),
       'monthCents', (select month_cents from rev),
       'totalCents', (select total_cents from rev),
       'byRoute', coalesce((select jsonb_agg(jsonb_build_object('name',name,'bookings',bookings,'revenueCents',revenue_cents)) from rev_by_route),'[]'::jsonb)),
    'studentsCount', (select c from active_students),
    'servicesCount', (select count(*) from agency_services where agency_id = p_agency_id),
    'routesTotal', (select count(*) from routes_inst)
  );
$function$;
revoke execute on function public.admin_report() from public, anon, authenticated;
revoke execute on function public.agency_report(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9. Parent booking for a code-linked child
-- ---------------------------------------------------------------------------
create or replace function public.parent_children()
 returns table(student_id uuid, full_name text, email text, phone text, grade text, address text, institution_id uuid, institution_name text, managed boolean, active_booking_id uuid, active_status text, active_route_id uuid, active_route_name text, active_payment_status text, active_cancel_requested_at timestamp with time zone)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select s.id,
         coalesce(pr.full_name, s.full_name),
         coalesce(pr.email, s.email),
         coalesce(pr.phone, s.phone),
         s.grade, s.address,
         -- A login-backed student picks a campus per booking (students.institution_id
         -- stays NULL) — fall back to the campus of their most recent booking.
         coalesce(s.institution_id, lb.institution_id), i.name,
         (s.profile_id is null) as managed,
         ab.id, ab.status::text, ab.route_id, r.name,
         ab.payment_status, ab.cancel_requested_at
  from parent_students ps
  join parents pa on pa.id = ps.parent_id and pa.profile_id = auth.uid()
  join students s on s.id = ps.student_id
  left join lateral (
    select rr.institution_id from bookings b join routes rr on rr.id = b.route_id
    where b.student_id = s.id
    order by b.created_at desc limit 1
  ) lb on s.institution_id is null
  left join institutions i on i.id = coalesce(s.institution_id, lb.institution_id)
  left join lateral (
    select b.id, b.status, b.route_id, b.payment_status, b.cancel_requested_at
    from bookings b
    where b.student_id = s.id and b.status in ('PENDING','CONFIRMED','WAITLISTED')
    order by b.created_at desc limit 1
  ) ab on true
  left join routes r on r.id = ab.route_id
  left join profiles pr on pr.id = s.profile_id
  order by coalesce(pr.full_name, s.full_name) nulls last;
$function$;

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
  if not exists (select 1 from institutions i
                  where i.id = p_institution_id and i.is_active and not i.is_deleted) then
    raise exception 'Pick a campus from the list' using errcode='P0002';
  end if;
  update students set institution_id = p_institution_id, updated_at = now()
   where id = p_student_id;
end; $function$;
revoke execute on function public.set_child_campus(uuid, uuid) from public, anon;
grant execute on function public.set_child_campus(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Removing a managed child never destroys money records
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

  -- Any booking history (and so possibly a pending UPI payment or refund) or a
  -- second linked parent: keep the student row, just unlink THIS parent.
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
grant execute on function public.remove_managed_child(uuid) to authenticated;

notify pgrst, 'reload schema';
