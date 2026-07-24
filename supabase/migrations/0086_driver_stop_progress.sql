-- 0086_driver_stop_progress.sql (idempotent — requires 0001/0043/0056)
-- Driver "Route progress" panel: the driver picks which pickup slot he is
-- heading to next, and can mark a stop as SKIPPED ("I'm not stopping here").
-- Skipping a stop notifies every rider waiting there to walk to the NEXT stop
-- in the route order (rolling forward past any other skipped stops).
--
-- Stop-level progress did not exist before: ride_events (0043) is booking-scoped
-- (per rider), not stop-scoped. This adds a per-route, per-day stop status that
-- the driver panel drives. Recipient resolution (student profile + linked
-- parents) mirrors driver_mark_stage (0056).

-- Per-route, per-day status of a pickup stop.
--   NEXT    = the stop the driver is currently heading to (at most one per
--             route/day; setting a new one clears the old).
--   SKIPPED = the driver is not stopping here today; riders were redirected.
-- A stop with no row has no special status (the normal case).
create table if not exists route_stop_progress (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references institutions(id) on delete cascade,
  route_id uuid not null references routes(id) on delete cascade,
  stop_id uuid not null references route_stops(id) on delete cascade,
  service_date date not null default (now() at time zone 'Asia/Kolkata')::date,
  status text not null check (status in ('NEXT', 'SKIPPED')),
  recorded_by uuid references profiles(id) on delete set null,
  recorded_at timestamptz not null default now(),
  unique (route_id, stop_id, service_date)
);
create index if not exists idx_route_stop_progress_route
  on route_stop_progress(route_id, service_date);
-- Riders waiting at a stop are looked up by (route_id, pickup_stop_id) on skip.
create index if not exists idx_bookings_route_pickup_stop
  on bookings(route_id, pickup_stop_id);

-- RLS-locked: only the SECURITY DEFINER RPCs below touch it (same posture as
-- ride_events). No client policies.
alter table route_stop_progress enable row level security;

-- Authorize + resolve a route the signed-in driver drives TODAY (permanent or
-- substitute). Returns the route's institution, or raises if it isn't theirs.
create or replace function public.driver_assert_route(p_route_id uuid)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_institution uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = 'P0001';
  end if;
  select r.institution_id into v_institution
  from routes r
  join vehicles v on v.id = r.vehicle_id
  where r.id = p_route_id
    and v.id in (select public.driver_today_vehicle_ids())
  limit 1;
  if v_institution is null then
    raise exception 'This route is not on one of your buses' using errcode = 'P0003';
  end if;
  return v_institution;
end; $$;
grant execute on function public.driver_assert_route(uuid) to authenticated;

-- Notify every rider waiting at a stop (student profile + linked parents), one
-- notification each. Mirrors the fan-out loop in driver_mark_stage.
create or replace function public.notify_stop_riders(
  p_route_id uuid, p_stop_id uuid, p_institution_id uuid, p_title text, p_body text
) returns void language plpgsql security definer set search_path = public as $$
declare v_recipient uuid;
begin
  for v_recipient in
    select s.profile_id
    from bookings b
    join students s on s.id = b.student_id
    where b.route_id = p_route_id and b.pickup_stop_id = p_stop_id
      and b.status in ('PENDING', 'CONFIRMED') and s.profile_id is not null
    union
    select pa.profile_id
    from bookings b
    join students s on s.id = b.student_id
    join parent_students ps on ps.student_id = s.id
    join parents pa on pa.id = ps.parent_id
    where b.route_id = p_route_id and b.pickup_stop_id = p_stop_id
      and b.status in ('PENDING', 'CONFIRMED') and pa.profile_id is not null
  loop
    insert into notifications (institution_id, recipient_id, title, body)
    values (p_institution_id, v_recipient, p_title, p_body);
  end loop;
end; $$;
-- Reached only via the definer RPCs below, never a direct client call.
revoke execute on function
  public.notify_stop_riders(uuid, uuid, uuid, text, text) from public, anon, authenticated;

-- The ordered pickup stops for every bus the driver drives today, each with its
-- current status and how many riders are waiting there. Groups by route in the UI.
create or replace function public.driver_route_progress()
returns table (
  route_id uuid, route_name text, bus_number text,
  stop_id uuid, stop_name text, sequence int,
  status text, rider_count bigint
) language sql stable security definer set search_path = public as $$
  select r.id, r.name, v.bus_number,
         rs.id, rs.name, rs.sequence,
         (select p.status from route_stop_progress p
            where p.route_id = r.id and p.stop_id = rs.id
              and p.service_date = (now() at time zone 'Asia/Kolkata')::date
            limit 1),
         (select count(*) from bookings b
            where b.route_id = r.id and b.pickup_stop_id = rs.id
              and b.status in ('PENDING', 'CONFIRMED'))
  from routes r
  join vehicles v on v.id = r.vehicle_id
  join route_stops rs on rs.route_id = r.id
  where v.id in (select public.driver_today_vehicle_ids())
  order by v.bus_number nulls last, r.name, rs.sequence;
$$;
grant execute on function public.driver_route_progress() to authenticated;

-- Mark the pickup slot the driver is heading to next. Clears any previous NEXT
-- on the route today, un-skips this stop if it was skipped, and tells riders
-- there that the bus is on its way.
create or replace function public.driver_set_next_stop(p_route_id uuid, p_stop_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_institution uuid := public.driver_assert_route(p_route_id);
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_stop_name text;
  v_bus text;
begin
  select rs.name into v_stop_name
  from route_stops rs where rs.id = p_stop_id and rs.route_id = p_route_id;
  if v_stop_name is null then
    raise exception 'That stop is not on this route' using errcode = 'P0004';
  end if;

  -- At most one NEXT per route/day.
  delete from route_stop_progress
  where route_id = p_route_id and service_date = v_today
    and status = 'NEXT' and stop_id <> p_stop_id;

  insert into route_stop_progress
    (institution_id, route_id, stop_id, service_date, status, recorded_by, recorded_at)
  values (v_institution, p_route_id, p_stop_id, v_today, 'NEXT', v_uid, now())
  on conflict (route_id, stop_id, service_date)
  do update set status = 'NEXT', recorded_by = v_uid, recorded_at = now();

  select v.bus_number into v_bus
  from routes r join vehicles v on v.id = r.vehicle_id where r.id = p_route_id;

  perform public.notify_stop_riders(
    p_route_id, p_stop_id, v_institution,
    'Bus on the way',
    coalesce('Bus ' || v_bus, 'Your bus') || ' is heading to ' || v_stop_name
      || ' next. Please be ready.');
end; $$;
grant execute on function public.driver_set_next_stop(uuid, uuid) to authenticated;

-- Mark a pickup slot SKIPPED ("I'm not stopping here"). Redirects every rider
-- waiting there to the next non-skipped stop in the route order. Returns the
-- name of that next stop (null if the skipped stop was the last one).
create or replace function public.driver_skip_stop(p_route_id uuid, p_stop_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_institution uuid := public.driver_assert_route(p_route_id);
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_stop_name text;
  v_seq int;
  v_next_name text;
  v_body text;
begin
  select rs.name, rs.sequence into v_stop_name, v_seq
  from route_stops rs where rs.id = p_stop_id and rs.route_id = p_route_id;
  if v_stop_name is null then
    raise exception 'That stop is not on this route' using errcode = 'P0004';
  end if;

  insert into route_stop_progress
    (institution_id, route_id, stop_id, service_date, status, recorded_by, recorded_at)
  values (v_institution, p_route_id, p_stop_id, v_today, 'SKIPPED', v_uid, now())
  on conflict (route_id, stop_id, service_date)
  do update set status = 'SKIPPED', recorded_by = v_uid, recorded_at = now();

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

  if v_next_name is not null then
    v_body := 'The bus will not stop at ' || v_stop_name
      || ' today. Please go to the next stop, ' || v_next_name || ', to board.';
  else
    v_body := 'The bus will not stop at ' || v_stop_name
      || ' today. Please contact your service provider for an alternative.';
  end if;

  perform public.notify_stop_riders(
    p_route_id, p_stop_id, v_institution, 'Pickup point changed', v_body);

  return v_next_name;
end; $$;
grant execute on function public.driver_skip_stop(uuid, uuid) to authenticated;

-- Clear a stop's status (undo a NEXT or SKIPPED). Silent — no rider
-- notification, since it only corrects the driver's own view.
create or replace function public.driver_reset_stop(p_route_id uuid, p_stop_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  perform public.driver_assert_route(p_route_id);
  delete from route_stop_progress
  where route_id = p_route_id and stop_id = p_stop_id and service_date = v_today;
end; $$;
grant execute on function public.driver_reset_stop(uuid, uuid) to authenticated;
