-- 0045_parent_live_route.sql (idempotent)
-- Add route_id to parent_children_bookings so the parent dashboard can show a
-- live bus map per child trip (polls bus_live_location, added in 0044). Same
-- body as 0041's version — just one extra column.

drop function if exists public.parent_children_bookings();
create or replace function public.parent_children_bookings()
returns table (booking_id uuid, student_id uuid, student_name text,
               route_name text, institution_name text, status text,
               is_paid boolean, created_at timestamptz, pickup_name text,
               departure_time time, bus_number text,
               driver_name text, driver_phone text, driver_changed boolean,
               route_id uuid)
language sql stable security definer set search_path = public as $$
  select b.id, s.id, coalesce(pr.full_name, b.student_name),
         coalesce(r.name, r.start_location), i.name, b.status::text,
         b.is_paid, b.created_at, st.name,
         r.departure_time, v.bus_number,
         coalesce(dc.driver_name, v.driver_name),
         coalesce(dc.driver_phone, v.driver_phone),
         (dc.id is not null),
         r.id
  from parent_students ps
  join parents pa on pa.id = ps.parent_id and pa.profile_id = auth.uid()
  join students s on s.id = ps.student_id
  join bookings b on b.student_id = s.id
  join routes r on r.id = b.route_id
  left join institutions i on i.id = r.institution_id
  left join vehicles v on v.id = r.vehicle_id
  left join bus_driver_changes dc
    on dc.vehicle_id = v.id and dc.effective_date = (now() at time zone 'Asia/Kolkata')::date
  left join route_stops st on st.id = b.pickup_stop_id
  left join profiles pr on pr.id = s.profile_id
  order by b.created_at desc;
$$;
grant execute on function public.parent_children_bookings() to authenticated;
