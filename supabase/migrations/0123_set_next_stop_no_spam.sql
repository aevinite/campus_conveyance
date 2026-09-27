-- 0123_set_next_stop_no_spam.sql (idempotent — requires 0086)
--
-- driver_set_next_stop re-notified the stop's riders EVERY time the driver tapped
-- "Heading here next", so re-tapping (or the button double-firing) spammed riders
-- with duplicate "Bus on the way" alerts. Only notify when this stop wasn't
-- already the NEXT stop today — a genuine change of intent.
create or replace function public.driver_set_next_stop(p_route_id uuid, p_stop_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_institution uuid := public.driver_assert_route(p_route_id);
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_stop_name text;
  v_bus text;
  v_was_next boolean;
begin
  select rs.name into v_stop_name
  from route_stops rs where rs.id = p_stop_id and rs.route_id = p_route_id;
  if v_stop_name is null then
    raise exception 'That stop is not on this route' using errcode = 'P0004';
  end if;

  -- Was this exact stop already marked NEXT today? A re-tap should not re-alert.
  select exists (
    select 1 from route_stop_progress p
    where p.route_id = p_route_id and p.stop_id = p_stop_id
      and p.service_date = v_today and p.status = 'NEXT'
  ) into v_was_next;

  -- At most one NEXT per route/day.
  delete from route_stop_progress
  where route_id = p_route_id and service_date = v_today
    and status = 'NEXT' and stop_id <> p_stop_id;

  insert into route_stop_progress
    (institution_id, route_id, stop_id, service_date, status, recorded_by, recorded_at)
  values (v_institution, p_route_id, p_stop_id, v_today, 'NEXT', v_uid, now())
  on conflict (route_id, stop_id, service_date)
  do update set status = 'NEXT', recorded_by = v_uid, recorded_at = now();

  if v_was_next then return; end if; -- no change → don't re-alert riders

  select v.bus_number into v_bus
  from routes r join vehicles v on v.id = r.vehicle_id where r.id = p_route_id;

  perform public.notify_stop_riders(
    p_route_id, p_stop_id, v_institution,
    'Bus on the way',
    coalesce('Bus ' || v_bus, 'Your bus') || ' is heading to ' || v_stop_name
      || ' next. Please be ready.');
end; $$;
grant execute on function public.driver_set_next_stop(uuid, uuid) to authenticated;
