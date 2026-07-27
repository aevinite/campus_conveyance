-- 0100_ride_history_boardings.sql (idempotent — requires 0043/0098)
--
-- Trip history should be a list of the rides the student ACTUALLY took, newest
-- first — one entry per boarding (when the driver marked them "boarded"), with
-- that day's boarded / reached / got-off times. It must NOT show cancelled or
-- rejected bookings, nor confirmed bookings that were never ridden.
--
-- This redefines my_ride_history() (0098 returned one row per booking, incl.
-- cancelled ones, ordered by booking date). The return columns change, so the
-- function is DROPPED first — a bare `create or replace` can't change the return
-- type (42P13) and would be skipped by scripts/migrate.mjs, leaving the old one.
-- Still read-only + security-definer; caller re-derived from auth.uid().

drop function if exists public.my_ride_history();

create or replace function public.my_ride_history()
returns table (
  ride_id      uuid,
  booking_id   uuid,
  student_name text,
  route_name   text,
  college_name text,
  bus_number   text,
  agency_name  text,
  pickup_name  text,
  boarded_at   timestamptz,
  reached_at   timestamptz,
  got_off_at   timestamptz
) language sql stable security definer set search_path = public as $$
  with mine as (
    -- The caller's own bookings (as a student) or their linked children's (as a
    -- parent) — excluding cancelled / rejected so those never surface as trips.
    select b.id, b.student_name, b.route_id, b.pickup_stop_id
    from bookings b
    where b.status not in ('CANCELLED', 'REJECTED')
      and (
        b.student_id in (select s.id from students s where s.profile_id = auth.uid())
        or b.student_id in (
          select ps2.student_id from parent_students ps2
          join parents pa on pa.id = ps2.parent_id
          where pa.profile_id = auth.uid()
        )
      )
  ),
  boardings as (
    -- One row per actual boarding. This is what makes an entry a "trip".
    select re.id as ride_id, re.booking_id, re.recorded_at as boarded_at,
           (re.recorded_at at time zone 'Asia/Kolkata')::date as ride_date
    from ride_events re
    join mine m on m.id = re.booking_id
    where re.stage = 'BOARDED'
  )
  select
    bo.ride_id, bo.booking_id, m.student_name,
    r.name, i.name, v.bus_number, ag.name, ps.name,
    bo.boarded_at,
    -- that same IST-day's reached / got-off times (if the driver recorded them).
    (select min(re2.recorded_at) from ride_events re2
       where re2.booking_id = bo.booking_id and re2.stage = 'REACHED'
         and re2.recorded_at >= bo.boarded_at
         and (re2.recorded_at at time zone 'Asia/Kolkata')::date = bo.ride_date),
    (select min(re3.recorded_at) from ride_events re3
       where re3.booking_id = bo.booking_id and re3.stage = 'GOT_OFF'
         and re3.recorded_at >= bo.boarded_at
         and (re3.recorded_at at time zone 'Asia/Kolkata')::date = bo.ride_date)
  from boardings bo
  join mine m on m.id = bo.booking_id
  join routes r on r.id = m.route_id
  left join institutions i on i.id = r.institution_id
  left join vehicles v on v.id = r.vehicle_id
  left join agencies ag on ag.id = r.agency_id
  left join route_stops ps on ps.id = m.pickup_stop_id
  order by bo.boarded_at desc;
$$;
grant execute on function public.my_ride_history() to authenticated;
