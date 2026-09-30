-- 0132: audit-5 HIGH #3 — reserve_seat refuses routes with no price (no plan →
-- ₹0 pass that never ends). Idempotent.
CREATE OR REPLACE FUNCTION public.reserve_seat(p_route_id uuid, p_pickup_stop_id uuid, p_drop_stop_id uuid, p_billing_period text DEFAULT NULL::text, p_student_id uuid DEFAULT NULL::uuid)
 RETURNS bookings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid; v_route routes; v_student students; v_alloc seat_allocations;
  v_count int; v_booking bookings;
  v_name text; v_phone text; v_email text; v_address text; v_has_stops boolean;
  v_period billing_period; v_plan_price bigint;
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception 'Not authenticated' using errcode='P0001'; end if;
  select * into v_route from routes where id = p_route_id;
  if v_route.id is null then raise exception 'Route not found' using errcode='P0002'; end if;

  if nullif(p_billing_period,'') is not null then
    v_period := p_billing_period::billing_period;
    v_plan_price := case v_period
      when 'MONTHLY'  then v_route.price_monthly_cents
      when 'SEMESTER' then v_route.price_semester_cents
      when 'YEARLY'   then v_route.price_yearly_cents
    end;
    if v_plan_price is null or v_plan_price <= 0 then
      raise exception 'This ride is not offered on the plan you selected' using errcode = 'P0013';
    end if;
  else
    v_period := case
      when coalesce(v_route.price_semester_cents, 0) > 0 then 'SEMESTER'::billing_period
      when coalesce(v_route.price_yearly_cents, 0)  > 0 then 'YEARLY'::billing_period
      when coalesce(v_route.price_monthly_cents, 0) > 0 then 'MONTHLY'::billing_period
      else null
    end;
  end if;
  -- An unpriced route used to fall through with no plan → a ₹0 pass that never
  -- ends. Direct RPC calls must not book it until the agency sets a price.
  if v_period is null then
    raise exception 'This ride has no price set yet — it can''t be booked right now' using errcode = 'P0013';
  end if;

  if p_student_id is not null then
    if not public.can_act_for_student(p_student_id) then
      raise exception 'You are not allowed to book for this student' using errcode = 'P0003';
    end if;
    select * into v_student from students where id = p_student_id;
  else
    select * into v_student from students where profile_id = v_uid limit 1;
  end if;
  if v_student.id is null then
    raise exception 'No rider record found — add the child''s details first' using errcode = 'P0006';
  end if;

  if v_student.profile_id is not null then
    select full_name, phone, email into v_name, v_phone, v_email
      from profiles where id = v_student.profile_id;
  else
    v_name  := v_student.full_name;
    v_phone := v_student.phone;
    v_email := v_student.email;
  end if;
  v_address := v_student.address;
  if coalesce(trim(v_name), '') = ''
     or coalesce(trim(v_phone), '') = ''
     or coalesce(trim(v_address), '') = '' then
    raise exception 'Please fill in the rider''s details (name, phone and address) before reserving a seat'
      using errcode = 'P0006';
  end if;

  perform public.expire_stale_holds();

  if exists (select 1 from bookings
              where student_id = v_student.id
                and status in ('PENDING','CONFIRMED','WAITLISTED')) then
    raise exception 'This rider already has an active booking — one bus at a time. Cancel it from My bookings or wait until it ends.'
      using errcode = 'P0007';
  end if;

  if v_route.is_active = false then
    raise exception 'This route is no longer available for booking' using errcode='P0010';
  end if;
  -- Direct RPC calls must not book onto an unapproved / removed operator's bus.
  if v_route.agency_id is not null and not exists (
      select 1 from agencies a
       where a.id = v_route.agency_id
         and a.status = 'APPROVED' and coalesce(a.is_deleted, false) = false) then
    raise exception 'This operator is not available for booking right now' using errcode='P0010';
  end if;
  if not exists (
      select 1 from institutions i
       where i.id = v_route.institution_id
         and i.is_active = true and coalesce(i.is_deleted, false) = false) then
    raise exception 'This school / college is not available for booking right now'
      using errcode = 'P0011';
  end if;

  select exists (select 1 from route_stops where route_id = p_route_id) into v_has_stops;
  if v_has_stops then
    if p_pickup_stop_id is null
       or not exists (select 1 from route_stops
                       where id = p_pickup_stop_id and route_id = p_route_id) then
      raise exception 'Please choose a valid pickup stop for this route' using errcode='P0012';
    end if;
  end if;
  -- Drop-off is optional (the campus), but if given it must be a stop on THIS route.
  if p_drop_stop_id is not null
     and not exists (select 1 from route_stops
                      where id = p_drop_stop_id and route_id = p_route_id) then
    raise exception 'Please choose a valid drop stop for this route' using errcode='P0012';
  end if;

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
  -- Full bus → clean rejection (no waitlist row to orphan).
  if v_count >= v_alloc.total_seats then
    raise exception 'This bus is full — there are no seats available right now.'
      using errcode = 'P0014';
  end if;

  begin
    insert into bookings (institution_id, student_id, route_id, pickup_stop_id,
        drop_stop_id, status, seat_allocation_id, student_name, student_email,
        billing_period, approved_at, expires_at)
    values (v_route.institution_id, v_student.id, p_route_id, p_pickup_stop_id,
        p_drop_stop_id, 'PENDING', v_alloc.id, v_name, v_email,
        v_period, now(), now() + interval '10 minutes')
    returning * into v_booking;
  exception when unique_violation then
    raise exception 'This rider already has an active booking — one bus at a time. Cancel it from My bookings or wait until it ends.'
      using errcode = 'P0007';
  end;
  return v_booking;
end; $function$;

insert into public.schema_migrations_applied (version, name)
values ('0132', '0132_reserve_seat_requires_price') on conflict do nothing;

notify pgrst, 'reload schema';
