-- 0053_report_aggregation.sql (idempotent)
-- (4)/(5) Move dashboard/report aggregation into SQL GROUP BY, so getAdminReport
-- and getAgencyReport no longer stream ALL bookings/vehicles/students into Node
-- and reduce in JS on every dashboard load + CSV export — which ALSO silently
-- truncated at PostgREST's ~1000-row cap (undercounting past 1000). Each returns
-- one jsonb blob of finished numbers. (8) A per-student status-count RPC for the
-- student home, so it stops loading full booking history to show 4 rows.

-- ── Admin platform report ────────────────────────────────────────────────────
create or replace function public.admin_report()
returns jsonb language sql stable security definer set search_path = public as $$
  with prov as (
    select a.id, a.name from agencies a where a.status = 'APPROVED' and a.is_deleted = false
  ),
  fleet as (
    select v.agency_id,
           count(*) filter (where v.vehicle_type <> 'VAN') as buses,
           count(*) filter (where v.vehicle_type = 'VAN')  as vans
    from vehicles v where v.agency_id is not null group by v.agency_id
  ),
  studs as (
    select r.agency_id, count(distinct b.student_id) as students
    from bookings b join routes r on r.id = b.route_id
    where b.status in ('PENDING','CONFIRMED') and r.agency_id is not null
    group by r.agency_id
  ),
  rows as (
    select p.id, p.name,
           coalesce(f.buses,0) buses, coalesce(f.vans,0) vans, coalesce(s.students,0) students
    from prov p
    left join fleet f on f.agency_id = p.id
    left join studs s on s.agency_id = p.id
    order by p.name
  ),
  fees as (
    select count(*) filter (where b.is_paid)      as paid_count,
           count(*) filter (where not b.is_paid)  as unpaid_count,
           coalesce(sum(r.price_cents) filter (where b.is_paid),0)     as paid_cents,
           coalesce(sum(r.price_cents) filter (where not b.is_paid),0) as unpaid_cents
    from bookings b join routes r on r.id = b.route_id
    where b.status in ('PENDING','CONFIRMED')
  )
  select jsonb_build_object(
    'providers', coalesce((select jsonb_agg(jsonb_build_object(
       'agencyId', id, 'name', name, 'buses', buses, 'vans', vans, 'students', students)) from rows), '[]'::jsonb),
    'totals', (select jsonb_build_object(
       'buses', coalesce(sum(buses),0), 'vans', coalesce(sum(vans),0), 'students', coalesce(sum(students),0)) from rows),
    'payments', (select jsonb_build_object(
       'paidCount', paid_count, 'unpaidCount', unpaid_count, 'paidCents', paid_cents, 'unpaidCents', unpaid_cents) from fees)
  );
$$;
-- Called ONLY server-side via the service-role client (wrapped in unstable_cache),
-- never directly from a browser — so grant to service_role, not authenticated.
revoke execute on function public.admin_report() from authenticated;
grant execute on function public.admin_report() to service_role;

-- ── Agency report (scoped to the owning agency) ──────────────────────────────
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
    select b.status, b.is_paid, b.paid_at, b.student_id,
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
    select route_name name, count(*) bookings, coalesce(sum(price_cents),0) revenue_cents
    from bk where status='CONFIRMED' and is_paid
    group by route_name order by revenue_cents desc
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
-- Server-only (service-role, in unstable_cache). The server passes the caller's
-- OWN agency id (resolved via getMyAgency), so ownership is enforced before the
-- call; direct browser calls are denied by grant.
revoke execute on function public.agency_report(uuid) from authenticated;
grant execute on function public.agency_report(uuid) to service_role;

-- ── Student booking status counts (for the home) ─────────────────────────────
create or replace function public.my_booking_status_counts()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(status, cnt), '{}'::jsonb) from (
    select b.status::text status, count(*) cnt
    from bookings b join students s on s.id = b.student_id
    where s.profile_id = auth.uid()
    group by b.status
  ) t;
$$;
grant execute on function public.my_booking_status_counts() to authenticated;
