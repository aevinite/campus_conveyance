-- 0055_one_active_booking.sql (idempotent)
-- ONE ACTIVE BOOKING PER STUDENT, globally (user decision 2026-07-18): while a
-- student has any ongoing booking (PENDING request/payment window, CONFIRMED
-- ride, or a WAITLISTED spot), they cannot book another bus — anywhere. They
-- can still browse campuses/agencies/routes freely. Booking re-opens when the
-- current one is cancelled, rejected, or expires unpaid.
-- Replaces the weaker per-route rule from 0025.

-- Existing data: keep each student's "best" active booking (CONFIRMED first,
-- then PENDING, then WAITLISTED; newest wins inside a tier), cancel the rest.
with ranked as (
  select id, row_number() over (
           partition by student_id
           order by case status when 'CONFIRMED' then 0
                                when 'PENDING'   then 1
                                else 2 end,
                    created_at desc) as rn
  from bookings
  where status in ('PENDING','CONFIRMED','WAITLISTED')
)
update bookings b set status = 'CANCELLED'
from ranked r where b.id = r.id and r.rn > 1;

-- Race-proof enforcement: at most one active booking row per student.
-- (Supersedes the per-route index from 0025.)
drop index if exists uq_bookings_active_student_route;
create unique index if not exists uq_bookings_one_active_per_student
  on bookings (student_id)
  where status in ('PENDING','CONFIRMED','WAITLISTED');

-- reserve_seat v9 = 0040 (auto-approve + eligibility/pickup/zero-capacity
-- checks) with the duplicate gate widened from per-route to GLOBAL.
create or replace function public.reserve_seat(
  p_route_id uuid, p_pickup_stop_id uuid, p_drop_stop_id uuid
) returns bookings language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_route routes; v_student students; v_alloc seat_allocations;
  v_count int; v_booking bookings; v_status booking_status;
  v_name text; v_phone text; v_email text; v_has_stops boolean;
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception 'Not authenticated' using errcode='P0001'; end if;
  select * into v_route from routes where id = p_route_id;
  if v_route.id is null then raise exception 'Route not found' using errcode='P0002'; end if;

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
    -- A held (PENDING) seat is auto-approved on the spot: approved_at + a
    -- 20-minute window to pay. A full bus → WAITLISTED (not approved).
    insert into bookings (institution_id, student_id, route_id, pickup_stop_id,
        drop_stop_id, status, seat_allocation_id, student_name, student_email,
        approved_at, expires_at)
    values (v_route.institution_id, v_student.id, p_route_id, p_pickup_stop_id,
        p_drop_stop_id, v_status, v_alloc.id, v_name, v_email,
        case when v_status = 'PENDING' then now() end,
        case when v_status = 'PENDING' then now() + interval '20 minutes' end)
    returning * into v_booking; -- trigger updates reserved_seats
  exception when unique_violation then
    -- Race: two tabs reserving at once — the one-active index wins.
    raise exception 'You already have an active booking — you can book only one bus at a time. Cancel it from My bookings or wait until it ends.'
      using errcode = 'P0007';
  end;
  return v_booking;
end; $$;
grant execute on function public.reserve_seat(uuid, uuid, uuid) to authenticated;
