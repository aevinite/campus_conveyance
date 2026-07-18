-- 0038_zero_capacity_not_bookable.sql (idempotent — requires 0032)
-- A route whose seat allocation has total_seats = 0 was a waitlist trap: the
-- student could "Join waitlist" (0 < 0 is false → WAITLISTED), but promotion can
-- never fire (active_count 0 >= total 0 is always true), so they waited forever.
-- reserve_seat now refuses a zero-capacity allocation outright. (reserve_seat v7
-- = 0032's v6 + this guard.)
create or replace function public.reserve_seat(
  p_route_id uuid, p_pickup_stop_id uuid, p_drop_stop_id uuid
) returns bookings language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_route routes; v_student students; v_alloc seat_allocations;
  v_count int; v_booking bookings; v_status booking_status;
  v_name text; v_phone text; v_email text;
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception 'Not authenticated' using errcode='P0001'; end if;
  select * into v_route from routes where id = p_route_id;
  if v_route.id is null then raise exception 'Route not found' using errcode='P0002'; end if;

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

  if exists (select 1 from bookings
              where student_id = v_student.id and route_id = p_route_id
                and status in ('PENDING','CONFIRMED','WAITLISTED')) then
    raise exception 'You already have an active booking on this route — see My bookings'
      using errcode = 'P0007';
  end if;

  select sa.* into v_alloc from seat_allocations sa
    join route_assignments ra on ra.id = sa.route_assignment_id
   where ra.route_id = p_route_id order by sa.created_at limit 1
   for update of sa;
  if v_alloc.id is null then
    raise exception 'No seats configured for this route' using errcode='P0004';
  end if;

  -- Zero-capacity → not bookable. A waitlist entry here could never be promoted.
  if v_alloc.total_seats <= 0 then
    raise exception 'This route is not currently accepting bookings' using errcode='P0004';
  end if;

  select count(*) into v_count from bookings
   where seat_allocation_id = v_alloc.id and status in ('PENDING','CONFIRMED');
  v_status := case when v_count < v_alloc.total_seats then 'PENDING' else 'WAITLISTED' end;
  begin
    insert into bookings (institution_id, student_id, route_id, pickup_stop_id,
        drop_stop_id, status, seat_allocation_id, student_name, student_email)
    values (v_route.institution_id, v_student.id, p_route_id, p_pickup_stop_id,
        p_drop_stop_id, v_status, v_alloc.id, v_name, v_email)
    returning * into v_booking; -- trigger updates reserved_seats
  exception when unique_violation then
    raise exception 'You already have an active booking on this route — see My bookings'
      using errcode = 'P0007';
  end;
  return v_booking;
end; $$;
grant execute on function public.reserve_seat(uuid, uuid, uuid) to authenticated;
