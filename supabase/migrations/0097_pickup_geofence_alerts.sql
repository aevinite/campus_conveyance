-- 0097_pickup_geofence_alerts.sql (idempotent — requires 0043/0044/0086/0093/0094)
--
-- Arrival alerts. When a driver's live GPS fix lands within ~1.2 km of a rider's
-- pickup stop, fire a ONE-per-rider-per-day "bus arriving soon" alert to the
-- student + linked parents across all three channels (in-app bell + email +
-- web push), reusing the existing outbox drainers.
--
-- Called from the /api/driver-location route right after driver_update_location
-- (so it runs on the live ping, working even when the rider's app is closed).
-- A per-(booking, day) `pickup_alerts` row dedups so it can't re-fire every 9s.
-- Boarded/finished riders are excluded. The whole body is exception-guarded so a
-- geofence hiccup can never break the driver's GPS ping.

-- ---------------------------------------------------------------------------
-- (1) Dedup ledger. RLS-locked (no policy) → only the definer RPC writes it.
-- ---------------------------------------------------------------------------
create table if not exists public.pickup_alerts (
  booking_id   uuid not null references public.bookings(id) on delete cascade,
  service_date date not null default (now() at time zone 'Asia/Kolkata')::date,
  created_at   timestamptz not null default now(),
  primary key (booking_id, service_date)
);
alter table public.pickup_alerts enable row level security;

-- ---------------------------------------------------------------------------
-- (2) Geofence check. Returns the number of riders newly alerted (so the API
--     route only bothers draining the email/push outboxes when > 0).
-- ---------------------------------------------------------------------------
create or replace function public.check_pickup_geofence(p_lat double precision, p_lng double precision)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_driver    uuid;
  v_today     date := (now() at time zone 'Asia/Kolkata')::date;
  v_threshold double precision := 1200;   -- metres
  v_count     int := 0;
  r           record;
  v_rec       record;
  v_title     text;
  v_body      text;
begin
  select d.id into v_driver from drivers d where d.profile_id = auth.uid() limit 1;
  if v_driver is null then return 0; end if;

  for r in
    select b.id as booking_id, b.institution_id, b.student_id, b.student_name,
           rt.name as route_name, st.name as stop_name,
           -- haversine (metres) from the bus fix to this rider's pickup stop.
           (2 * 6371000 * asin(sqrt(
              power(sin(radians(st.lat - p_lat) / 2), 2) +
              cos(radians(p_lat)) * cos(radians(st.lat)) *
              power(sin(radians(st.lng - p_lng) / 2), 2)
           ))) as dist_m
    from bookings b
    join routes rt on rt.id = b.route_id
    join route_stops st on st.id = b.pickup_stop_id
    where b.status = 'CONFIRMED'
      and rt.vehicle_id in (select public.driver_today_vehicle_ids())
      and st.lat is not null and st.lng is not null
      -- not already alerted today …
      and not exists (select 1 from pickup_alerts pa
                       where pa.booking_id = b.id and pa.service_date = v_today)
      -- … and not already picked up / finished today.
      and not exists (select 1 from ride_events re
                       where re.booking_id = b.id
                         and re.stage in ('BOARDED', 'GOT_OFF')
                         and (re.recorded_at at time zone 'Asia/Kolkata')::date = v_today)
  loop
    if r.dist_m is null or r.dist_m > v_threshold then
      continue;
    end if;

    -- Claim the alert first so a concurrent ping can't double-fire it.
    insert into pickup_alerts (booking_id, service_date)
    values (r.booking_id, v_today)
    on conflict do nothing;

    -- Fan out to the student + every linked parent (mirrors booking_notify).
    for v_rec in
      select s.profile_id as pid, pr.email as email, false as is_parent
      from students s
      left join profiles pr on pr.id = s.profile_id
      where s.id = r.student_id and s.profile_id is not null
      union
      select pa.profile_id, pr.email, true
      from parent_students ps
      join parents pa on pa.id = ps.parent_id
      left join profiles pr on pr.id = pa.profile_id
      where ps.student_id = r.student_id and pa.profile_id is not null
    loop
      if v_rec.is_parent then
        v_title := 'Bus arriving soon';
        v_body  := coalesce(nullif(btrim(r.student_name), ''), 'Your child')
                   || '''s bus for ' || coalesce(r.route_name, 'their route')
                   || ' is approaching ' || coalesce(r.stop_name, 'the pickup stop')
                   || '. They should head to the stop.';
      else
        v_title := 'Your bus is arriving soon';
        v_body  := 'Your bus for ' || coalesce(r.route_name, 'your route')
                   || ' is approaching ' || coalesce(r.stop_name, 'your pickup stop')
                   || '. Head to your stop now.';
      end if;

      insert into notifications (institution_id, recipient_id, title, body)
      values (r.institution_id, v_rec.pid, v_title, v_body);

      if v_rec.email is not null then
        insert into email_outbox (recipient_id, to_email, kind, title, body, booking_id)
        values (v_rec.pid, v_rec.email, 'APPROACHING', v_title, v_body, r.booking_id);
      end if;

      insert into push_outbox (recipient_id, kind, title, body, url, booking_id)
      values (v_rec.pid, 'APPROACHING', v_title, v_body, '/student/bookings', r.booking_id);
    end loop;

    v_count := v_count + 1;
  end loop;

  return v_count;
exception when others then
  -- Best-effort: never let a geofence failure break the GPS ping.
  raise warning 'check_pickup_geofence failed: %', sqlerrm;
  return v_count;
end; $$;
revoke all on function public.check_pickup_geofence(double precision, double precision) from public;
grant execute on function public.check_pickup_geofence(double precision, double precision) to authenticated;
