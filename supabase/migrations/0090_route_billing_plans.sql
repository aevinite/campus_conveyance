-- 0090_route_billing_plans.sql (idempotent)
-- PER-PERIOD PRICING (user decision 2026-07-24): campus transport is semester-
-- based (a semester = 6 months). An agency prices each route by one or more
-- plans — per month, per semester, and/or per year — leaving a plan blank when
-- it doesn't offer it. The STUDENT picks a plan at checkout and pays that amount.
--
-- Storage: three nullable price columns on `routes` (a plan is "offered" when its
-- column is set and > 0). The legacy flat `routes.price_cents` is kept as a
-- representative "primary" price so every existing read still shows a number; the
-- RPCs below keep it = coalesce(semester, yearly, monthly). The booking records
-- which plan the student chose (`bookings.billing_period`) and pay_booking charges
-- the matching plan price.

alter table routes add column if not exists price_monthly_cents  bigint;
alter table routes add column if not exists price_semester_cents bigint;
alter table routes add column if not exists price_yearly_cents   bigint;

-- Existing routes: their single flat fare becomes the SEMESTER price (campus is
-- semester-based), so they keep working and offer a Semester plan by default.
update routes
   set price_semester_cents = price_cents
 where price_semester_cents is null
   and price_cents is not null
   and price_cents > 0;

-- The plan a booking was made under.
do $$ begin
  create type billing_period as enum ('MONTHLY','SEMESTER','YEARLY');
exception when duplicate_object then null; end $$;

alter table bookings add column if not exists billing_period billing_period;
update bookings set billing_period = 'SEMESTER' where billing_period is null;

-- ---------------------------------------------------------------------------
-- add_route: now takes the three per-plan prices instead of one flat price.
-- Drop the old flat-price signature so PostgREST resolves the new one cleanly.
-- ---------------------------------------------------------------------------
drop function if exists public.add_route(uuid, uuid, uuid, uuid, text, bigint, time, text, jsonb);

create or replace function public.add_route(
  p_agency_id uuid, p_agency_service_id uuid, p_institution_id uuid,
  p_vehicle_id uuid, p_start_location text,
  p_price_monthly_cents bigint, p_price_semester_cents bigint, p_price_yearly_cents bigint,
  p_departure_time time, p_image_url text, p_stops jsonb default '[]'::jsonb
) returns routes language plpgsql security definer set search_path = public as $$
declare v_route routes; v_cap int; v_ra uuid; v_vtype vehicle_type; v_primary bigint;
begin
  if not exists (select 1 from agencies where id=p_agency_id and owner_profile_id=auth.uid() and status='APPROVED') then
    raise exception 'Agency not approved' using errcode='P0003'; end if;
  select capacity, vehicle_type into v_cap, v_vtype from vehicles where id=p_vehicle_id and agency_id=p_agency_id;
  if v_cap is null then raise exception 'Bus not found' using errcode='P0002'; end if;

  if coalesce(p_price_monthly_cents,0) <= 0
     and coalesce(p_price_semester_cents,0) <= 0
     and coalesce(p_price_yearly_cents,0) <= 0 then
    raise exception 'Set a price for at least one plan (monthly, semester or yearly)' using errcode='P0014';
  end if;
  -- Representative price for legacy readers: prefer semester, then yearly, then monthly.
  v_primary := coalesce(nullif(p_price_semester_cents,0), nullif(p_price_yearly_cents,0), nullif(p_price_monthly_cents,0));

  insert into routes (institution_id, agency_id, agency_service_id, vehicle_id, vehicle_type,
    name, start_location, price_cents, price_monthly_cents, price_semester_cents, price_yearly_cents,
    departure_time, image_url, is_active)
  values (p_institution_id, p_agency_id, p_agency_service_id, p_vehicle_id, v_vtype,
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
end; $$;

-- ---------------------------------------------------------------------------
-- update_route: edit the three per-plan prices + time (always); replace stops
-- only when the route has no bookings. Returns true if stops were replaced.
-- ---------------------------------------------------------------------------
drop function if exists public.update_route(uuid, bigint, time, jsonb);

create or replace function public.update_route(
  p_route_id uuid,
  p_price_monthly_cents bigint, p_price_semester_cents bigint, p_price_yearly_cents bigint,
  p_departure_time time, p_stops jsonb default '[]'::jsonb
) returns boolean language plpgsql security definer set search_path = public as $$
declare v_inst uuid; v_has_bookings boolean; v_first text; v_primary bigint;
begin
  select r.institution_id into v_inst from routes r join agencies a on a.id=r.agency_id
    where r.id=p_route_id and a.owner_profile_id=auth.uid() and a.status='APPROVED';
  if v_inst is null then raise exception 'Not your route' using errcode='P0003'; end if;

  if coalesce(p_price_monthly_cents,0) <= 0
     and coalesce(p_price_semester_cents,0) <= 0
     and coalesce(p_price_yearly_cents,0) <= 0 then
    raise exception 'Set a price for at least one plan (monthly, semester or yearly)' using errcode='P0014';
  end if;
  v_primary := coalesce(nullif(p_price_semester_cents,0), nullif(p_price_yearly_cents,0), nullif(p_price_monthly_cents,0));

  update routes set
      price_cents          = v_primary,
      price_monthly_cents  = nullif(p_price_monthly_cents,0),
      price_semester_cents = nullif(p_price_semester_cents,0),
      price_yearly_cents   = nullif(p_price_yearly_cents,0),
      departure_time       = p_departure_time
   where id=p_route_id;

  select exists(select 1 from bookings where route_id=p_route_id) into v_has_bookings;
  if v_has_bookings then
    return false; -- keep stops (bookings reference them)
  end if;

  delete from route_stops where route_id=p_route_id;
  insert into route_stops (institution_id, route_id, name, sequence, lat, lng, address, description)
  select v_inst, p_route_id,
         coalesce(nullif(elem->>'name',''), 'Stop ' || ord::text),
         ord::int,
         (elem->>'lat')::double precision,
         (elem->>'lng')::double precision,
         nullif(elem->>'address',''),
         nullif(elem->>'description','')
  from jsonb_array_elements(coalesce(p_stops, '[]'::jsonb)) with ordinality as t(elem, ord)
  where (elem->>'lat') is not null and (elem->>'lng') is not null;

  select name into v_first from route_stops where route_id=p_route_id order by sequence limit 1;
  if v_first is not null then
    update routes set name=v_first, start_location=v_first where id=p_route_id;
  end if;
  return true;
end; $$;

-- ---------------------------------------------------------------------------
-- reserve_seat: now records the student's chosen plan (p_billing_period). The
-- route must actually offer that plan. Drop the 3-arg signature and replace with
-- the 4-arg one (v9 body from 0055 + billing-period handling).
-- ---------------------------------------------------------------------------
drop function if exists public.reserve_seat(uuid, uuid, uuid);

create or replace function public.reserve_seat(
  p_route_id uuid, p_pickup_stop_id uuid, p_drop_stop_id uuid, p_billing_period text default null
) returns bookings language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_route routes; v_student students; v_alloc seat_allocations;
  v_count int; v_booking bookings; v_status booking_status;
  v_name text; v_phone text; v_email text; v_has_stops boolean;
  v_period billing_period; v_plan_price bigint;
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception 'Not authenticated' using errcode='P0001'; end if;
  select * into v_route from routes where id = p_route_id;
  if v_route.id is null then raise exception 'Route not found' using errcode='P0002'; end if;

  -- Resolve the chosen plan. When the student explicitly picks a plan it must be
  -- one the route actually offers. When none is passed (legacy clients / seeded
  -- price-less routes) fall back to the route's primary plan, staying bookable
  -- exactly as before (a price-less route stays free — no new hard block).
  if nullif(p_billing_period,'') is not null then
    v_period := p_billing_period::billing_period;
    v_plan_price := case v_period
      when 'MONTHLY'  then v_route.price_monthly_cents
      when 'SEMESTER' then v_route.price_semester_cents
      when 'YEARLY'   then v_route.price_yearly_cents
    end;
    if v_plan_price is null or v_plan_price <= 0 then
      raise exception 'This ride is not offered on the plan you selected' using errcode='P0013';
    end if;
  else
    v_period := case
      when v_route.price_semester_cents is not null then 'SEMESTER'::billing_period
      when v_route.price_yearly_cents  is not null then 'YEARLY'::billing_period
      when v_route.price_monthly_cents is not null then 'MONTHLY'::billing_period
      else null
    end;
  end if;

  -- Details gate (name/phone/address must be filled first).
  select full_name, phone, email into v_name, v_phone, v_email
    from profiles where id = v_uid;
  select * into v_student from students where profile_id = v_uid limit 1;
  if v_student.id is null
     or coalesce(trim(v_name), '') = ''
     or coalesce(trim(v_phone), '') = ''
     or coalesce(trim(v_student.address), '') = '' then
    raise exception 'Please fill in your details (name, phone and address) before reserving a seat'
      using errcode = 'P0006';
  end if;

  perform public.expire_stale_holds();

  -- ONE active booking per student, on any route.
  if exists (select 1 from bookings
              where student_id = v_student.id
                and status in ('PENDING','CONFIRMED','WAITLISTED')) then
    raise exception 'You already have an active booking — you can book only one bus at a time. Cancel it from My bookings or wait until it ends.'
      using errcode = 'P0007';
  end if;

  -- Eligibility: the route must be active and its campus live.
  if v_route.is_active = false then
    raise exception 'This route is no longer available for booking' using errcode='P0010';
  end if;
  if not exists (
      select 1 from institutions i
       where i.id = v_route.institution_id
         and i.is_active = true and coalesce(i.is_deleted, false) = false) then
    raise exception 'This school / college is not available for booking right now'
      using errcode = 'P0011';
  end if;

  -- Pickup: the chosen stop must belong to this route (when it has any).
  select exists (select 1 from route_stops where route_id = p_route_id) into v_has_stops;
  if v_has_stops then
    if p_pickup_stop_id is null
       or not exists (select 1 from route_stops
                       where id = p_pickup_stop_id and route_id = p_route_id) then
      raise exception 'Please choose a valid pickup stop for this route' using errcode='P0012';
    end if;
  end if;

  -- Seat availability (lock the allocation to serialize with promotion).
  select sa.* into v_alloc from seat_allocations sa
    join route_assignments ra on ra.id = sa.route_assignment_id
   where ra.route_id = p_route_id order by sa.created_at limit 1
   for update of sa;
  if v_alloc.id is null then
    raise exception 'No seats configured for this route' using errcode='P0004';
  end if;
  if v_alloc.total_seats <= 0 then
    raise exception 'This route is not currently accepting bookings' using errcode='P0004';
  end if;
  select count(*) into v_count from bookings
   where seat_allocation_id = v_alloc.id and status in ('PENDING','CONFIRMED');
  v_status := case when v_count < v_alloc.total_seats then 'PENDING' else 'WAITLISTED' end;

  begin
    insert into bookings (institution_id, student_id, route_id, pickup_stop_id,
        drop_stop_id, status, seat_allocation_id, student_name, student_email,
        billing_period, approved_at, expires_at)
    values (v_route.institution_id, v_student.id, p_route_id, p_pickup_stop_id,
        p_drop_stop_id, v_status, v_alloc.id, v_name, v_email,
        v_period,
        case when v_status = 'PENDING' then now() end,
        case when v_status = 'PENDING' then now() + interval '20 minutes' end)
    returning * into v_booking; -- trigger updates reserved_seats
  exception when unique_violation then
    raise exception 'You already have an active booking — you can book only one bus at a time. Cancel it from My bookings or wait until it ends.'
      using errcode = 'P0007';
  end;
  return v_booking;
end; $$;
grant execute on function public.reserve_seat(uuid, uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- pay_booking: charge the price of the plan the booking was made under (falling
-- back to the flat price_cents for legacy bookings). Body from 0033 + plan pick.
-- ---------------------------------------------------------------------------
create or replace function public.pay_booking(p_booking_id uuid)
returns bookings language plpgsql security definer set search_path = public as $$
declare v_student students; v_booking bookings; v_price bigint;
  v_monthly bigint; v_semester bigint; v_yearly bigint; v_flat bigint;
begin
  select * into v_student from students where profile_id = auth.uid() limit 1;
  if v_student.id is null then raise exception 'No student record for this account' using errcode='P0001'; end if;

  select * into v_booking from bookings where id = p_booking_id for update;
  if v_booking.id is null then raise exception 'Booking not found' using errcode='P0002'; end if;
  if v_booking.student_id <> v_student.id then raise exception 'Not your booking' using errcode='P0003'; end if;
  if v_booking.is_paid then return v_booking; end if; -- already paid: no double charge
  if v_booking.status <> 'PENDING' then
    raise exception 'Only a held seat can be paid for' using errcode='P0005'; end if;
  if v_booking.approved_at is null then
    raise exception 'Waiting for agency approval — you can pay as soon as the agency approves your request.'
      using errcode = 'P0009';
  end if;
  if v_booking.expires_at is not null and v_booking.expires_at < now() then
    raise exception 'Your payment window expired — please reserve the seat again'
      using errcode = 'P0008';
  end if;

  select price_monthly_cents, price_semester_cents, price_yearly_cents, price_cents
    into v_monthly, v_semester, v_yearly, v_flat
    from routes where id = v_booking.route_id;
  v_price := case v_booking.billing_period
    when 'MONTHLY'  then v_monthly
    when 'SEMESTER' then v_semester
    when 'YEARLY'   then v_yearly
    else null
  end;
  if v_price is null then v_price := v_flat; end if;

  update bookings set is_paid = true, paid_at = now(), expires_at = null, status = 'CONFIRMED'
   where id = p_booking_id and not is_paid returning * into v_booking;
  if v_booking.id is null then
    select * into v_booking from bookings where id = p_booking_id;
    return v_booking;
  end if;

  insert into payments (institution_id, booking_id, amount_cents, currency, status)
  values (v_booking.institution_id, v_booking.id, coalesce(v_price, 0), 'INR', 'PAID')
  on conflict (booking_id) where booking_id is not null do nothing;

  return v_booking;
end; $$;
grant execute on function public.pay_booking(uuid) to authenticated;
