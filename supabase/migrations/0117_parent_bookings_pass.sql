-- 0117_parent_bookings_pass.sql (idempotent — requires 0103)
--
-- The parent dashboard now shows a per-child "bus pass" widget (days left on the
-- plan). That needs the plan (billing_period) and when it started (paid_at) for
-- each child's booking — which parent_children_bookings() didn't return. This
-- redefines it to add those two columns. Return type changes, so DROP first
-- (a bare create-or-replace can't change the return type → 42P13). Still a
-- read-only, security-definer, parent-scoped read (auth.uid()).

drop function if exists public.parent_children_bookings();

create or replace function public.parent_children_bookings()
returns table (booking_id uuid, student_id uuid, student_name text,
               route_name text, institution_name text, status text,
               is_paid boolean, created_at timestamptz, pickup_name text,
               departure_time time, bus_number text,
               driver_name text, driver_phone text, driver_changed boolean,
               route_id uuid, billing_period text, paid_at timestamptz)
language sql stable security definer set search_path = public as $$
  select b.id, s.id, coalesce(pr.full_name, s.full_name, b.student_name),
         coalesce(r.name, r.start_location), i.name, b.status::text,
         b.is_paid, b.created_at, st.name,
         r.departure_time, v.bus_number,
         coalesce(dc.driver_name, v.driver_name),
         coalesce(dc.driver_phone, v.driver_phone),
         (dc.id is not null),
         r.id, b.billing_period::text, b.paid_at
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
