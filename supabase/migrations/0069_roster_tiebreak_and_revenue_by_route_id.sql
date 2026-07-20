-- 0069_roster_tiebreak_and_revenue_by_route_id.sql (idempotent)

-- (1) driver_bookings paginates by `order by b.created_at desc` with no
-- tiebreaker → two bookings sharing a created_at can duplicate/skip across page
-- boundaries. Add `, b.id desc` for a stable total order. (Body is 0063's.)
create or replace function public.driver_bookings(
  p_limit int default null, p_offset int default 0
)
returns table (
  booking_id uuid, status text, created_at timestamptz,
  student_name text, student_phone text,
  bus_number text, route_name text, pickup_name text, college_name text,
  current_stage text
) language sql stable security definer set search_path = public as $$
  select b.id, b.status::text, b.created_at, pr.full_name, pr.phone,
         v.bus_number, r.name, ps.name, i.name,
         (select re.stage::text from ride_events re
            where re.booking_id = b.id
              and (re.recorded_at at time zone 'Asia/Kolkata')::date
                  = (now() at time zone 'Asia/Kolkata')::date
            order by re.recorded_at desc limit 1)
  from bookings b
  join routes r on r.id = b.route_id
  join vehicles v on v.id = r.vehicle_id
  left join institutions i on i.id = r.institution_id
  left join route_stops ps on ps.id = b.pickup_stop_id
  left join students s on s.id = b.student_id
  left join profiles pr on pr.id = s.profile_id
  where b.status in ('PENDING', 'CONFIRMED')
    and v.id in (select public.driver_today_vehicle_ids())
  order by b.created_at desc, b.id desc
  limit p_limit offset coalesce(p_offset, 0);
$$;
grant execute on function public.driver_bookings(int, int) to authenticated;

-- (2) agency_report "Revenue by route" grouped by route NAME, so two routes with
-- the same name merged into one row (revenue misattributed). Group by route id
-- instead; carry the name for display. Only `bk` (adds route_id) and
-- `rev_by_route` (group by route_id) changed vs 0053.
create or replace function public.agency_report(p_agency_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  with routes_inst as (
    select coalesce(i.name, '—') as name, r.vehicle_type
    from routes r left join institutions i on i.id = r.institution_id
    where r.agency_id = p_agency_id
  ),
  veh as (
    select count(*) filter (where vehicle_type <> 'VAN') buses,
           count(*) filter (where vehicle_type = 'VAN')  vans
    from vehicles where agency_id = p_agency_id
  ),
  fleet_by_college as (
    select name, count(*) filter (where vehicle_type <> 'VAN') buses,
                 count(*) filter (where vehicle_type = 'VAN')  vans
    from routes_inst group by name order by name
  ),
  routes_by_inst as (
    select name, count(*) routes from routes_inst group by name order by name
  ),
  bk as (
    select b.status, b.is_paid, b.paid_at, b.student_id, r.id route_id,
           coalesce(r.name, r.start_location) route_name, r.price_cents
    from bookings b join routes r on r.id = b.route_id where r.agency_id = p_agency_id
  ),
  bcounts as (
    select count(*) filter (where status='PENDING')   pending,
           count(*) filter (where status='CONFIRMED') confirmed,
           count(*) filter (where status='REJECTED')  rejected,
           count(*) filter (where status='CANCELLED') cancelled,
           count(*) total
    from bk
  ),
  rev as (
    select coalesce(sum(price_cents),0) total_cents,
           coalesce(sum(price_cents) filter (where (paid_at at time zone 'Asia/Kolkata') >= date_trunc('day',   now() at time zone 'Asia/Kolkata')),0) today_cents,
           coalesce(sum(price_cents) filter (where (paid_at at time zone 'Asia/Kolkata') >= date_trunc('month', now() at time zone 'Asia/Kolkata')),0) month_cents
    from bk where status='CONFIRMED' and is_paid
  ),
  rev_by_route as (
    select route_id, min(route_name) name, count(*) bookings, coalesce(sum(price_cents),0) revenue_cents
    from bk where status='CONFIRMED' and is_paid
    group by route_id order by revenue_cents desc
  ),
  active_students as (
    select count(distinct b.student_id) c from bk b
    where b.status='CONFIRMED' and b.student_id is not null
      and not exists (select 1 from agency_hidden_students h
                      where h.agency_id = p_agency_id and h.student_id = b.student_id)
  )
  select jsonb_build_object(
    'fleet', (select jsonb_build_object('buses',buses,'vans',vans) from veh),
    'fleetByCollege', coalesce((select jsonb_agg(jsonb_build_object('name',name,'buses',buses,'vans',vans)) from fleet_by_college),'[]'::jsonb),
    'routesByInstitution', coalesce((select jsonb_agg(jsonb_build_object('name',name,'routes',routes)) from routes_by_inst),'[]'::jsonb),
    'bookings', (select jsonb_build_object('pending',pending,'confirmed',confirmed,'rejected',rejected,'cancelled',cancelled,'total',total) from bcounts),
    'revenue', jsonb_build_object(
       'todayCents', (select today_cents from rev),
       'monthCents', (select month_cents from rev),
       'totalCents', (select total_cents from rev),
       'byRoute', coalesce((select jsonb_agg(jsonb_build_object('name',name,'bookings',bookings,'revenueCents',revenue_cents)) from rev_by_route),'[]'::jsonb)),
    'studentsCount', (select c from active_students),
    'servicesCount', (select count(*) from agency_services where agency_id = p_agency_id),
    'routesTotal', (select count(*) from routes_inst)
  );
$$;
revoke execute on function public.agency_report(uuid) from authenticated;
grant execute on function public.agency_report(uuid) to service_role;
