-- 0003_booking.sql — race-safe seat reservation (idempotent)

alter table bookings
  add column if not exists seat_allocation_id uuid references seat_allocations(id);

-- Reserve a seat for the calling user's student record on a route.
-- SECURITY DEFINER: enforces ownership (auth.uid()) + tenant match internally.
-- The atomic UPDATE...WHERE reserved_seats < total_seats is race-proof under
-- READ COMMITTED: a concurrent caller re-evaluates the predicate against the
-- latest committed row, so the counter can never exceed total_seats.
create or replace function public.reserve_seat(
  p_route_id uuid,
  p_pickup_stop_id uuid,
  p_drop_stop_id uuid
) returns bookings
language plpgsql security definer set search_path = public as $$
declare
  v_student students;
  v_route routes;
  v_alloc seat_allocations;
  v_got uuid;
  v_booking bookings;
begin
  select * into v_student from students where profile_id = auth.uid() limit 1;
  if v_student.id is null then
    raise exception 'No student record for this account' using errcode = 'P0001';
  end if;

  select * into v_route from routes where id = p_route_id;
  if v_route.id is null then
    raise exception 'Route not found' using errcode = 'P0002';
  end if;
  if v_route.institution_id <> v_student.institution_id then
    raise exception 'Route is not in your institution' using errcode = 'P0003';
  end if;

  select sa.* into v_alloc
    from seat_allocations sa
    join route_assignments ra on ra.id = sa.route_assignment_id
   where ra.route_id = p_route_id
   order by sa.created_at
   limit 1;
  if v_alloc.id is null then
    raise exception 'No seats configured for this route' using errcode = 'P0004';
  end if;

  update seat_allocations
     set reserved_seats = reserved_seats + 1
   where id = v_alloc.id and reserved_seats < total_seats
  returning id into v_got;

  if v_got is not null then
    insert into bookings (institution_id, student_id, route_id, pickup_stop_id,
      drop_stop_id, status, seat_allocation_id)
    values (v_student.institution_id, v_student.id, p_route_id, p_pickup_stop_id,
      p_drop_stop_id, 'CONFIRMED', v_alloc.id)
    returning * into v_booking;
  else
    insert into bookings (institution_id, student_id, route_id, pickup_stop_id,
      drop_stop_id, status)
    values (v_student.institution_id, v_student.id, p_route_id, p_pickup_stop_id,
      p_drop_stop_id, 'WAITLISTED')
    returning * into v_booking;
  end if;

  return v_booking;
end; $$;

-- Cancel a booking owned by the caller; free its seat if it held one.
create or replace function public.cancel_booking(p_booking_id uuid)
returns bookings
language plpgsql security definer set search_path = public as $$
declare
  v_student students;
  v_booking bookings;
begin
  select * into v_student from students where profile_id = auth.uid() limit 1;
  if v_student.id is null then
    raise exception 'No student record for this account' using errcode = 'P0001';
  end if;

  select * into v_booking from bookings where id = p_booking_id;
  if v_booking.id is null then
    raise exception 'Booking not found' using errcode = 'P0002';
  end if;
  if v_booking.student_id <> v_student.id then
    raise exception 'Not your booking' using errcode = 'P0003';
  end if;
  if v_booking.status = 'CANCELLED' then
    return v_booking;
  end if;

  if v_booking.status = 'CONFIRMED' and v_booking.seat_allocation_id is not null then
    update seat_allocations
       set reserved_seats = greatest(reserved_seats - 1, 0)
     where id = v_booking.seat_allocation_id;
  end if;

  update bookings set status = 'CANCELLED' where id = p_booking_id
  returning * into v_booking;
  return v_booking;
end; $$;

grant execute on function public.reserve_seat(uuid, uuid, uuid) to authenticated;
grant execute on function public.cancel_booking(uuid) to authenticated;
