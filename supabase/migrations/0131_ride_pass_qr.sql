-- 0131: Ride-pass QR code.
--
-- Every booking gets an unguessable pass token. The rider (or their parent)
-- shows a QR of https://<site>/pass/<token>; anyone who scans it with a phone
-- camera sees a verification card (name, campus, bus, route, pickup, pass
-- status). Full contact details (phones, email, roll no, address, guardian /
-- parent contacts) are returned ONLY when the scanner is signed in as staff for
-- that booking: the bus's driver (incl. today's substitute), the route's agency
-- owner, the campus admin of the route's campus, or a SUPER_ADMIN.
-- Idempotent.

alter table public.bookings
  add column if not exists pass_token text
  default replace(gen_random_uuid()::text, '-', '');
update public.bookings
   set pass_token = replace(gen_random_uuid()::text, '-', '')
 where pass_token is null;
alter table public.bookings alter column pass_token set not null;
create unique index if not exists bookings_pass_token_key on public.bookings(pass_token);

-- The caller's own pass token (student themself, or a parent of that child).
create or replace function public.my_ride_pass_token(p_booking_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select b.pass_token from bookings b
   where b.id = p_booking_id
     and b.student_id is not null
     and public.can_act_for_student(b.student_id);
$$;
revoke all on function public.my_ride_pass_token(uuid) from public, anon;
grant execute on function public.my_ride_pass_token(uuid) to authenticated;

-- Scan lookup. Callable anonymously (public verification card); staff fields
-- only for the booking's own staff.
create or replace function public.ride_pass(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v record;
  v_staff boolean := false;
  v_role text;
  v_parents jsonb;
begin
  if p_token is null or length(p_token) <> 32 or p_token !~ '^[0-9a-f]{32}$' then
    return null;
  end if;

  select b.id, b.status::text as status, b.billing_period::text as billing_period,
         b.pass_start_at, b.paid_at, b.created_at, b.cancel_requested_at,
         b.student_id, b.institution_id as b_inst,
         coalesce(pr.full_name, s.full_name, b.student_name) as student_name,
         coalesce(pr.phone, s.phone) as student_phone,
         coalesce(pr.email, s.email, b.student_email) as student_email,
         s.roll_no, s.grade, s.address, s.guardian_name, s.guardian_phone,
         r.id as route_id, r.name as route_name, r.agency_id, r.institution_id as r_inst,
         i.name as college_name, a.name as agency_name, a.owner_profile_id,
         v2.id as vehicle_id, v2.bus_number, v2.driver_name,
         ps.name as pickup_name
    into v
    from bookings b
    left join students s   on s.id = b.student_id
    left join profiles pr  on pr.id = s.profile_id
    left join routes r     on r.id = b.route_id
    left join institutions i on i.id = coalesce(r.institution_id, b.institution_id)
    left join agencies a   on a.id = r.agency_id
    left join vehicles v2  on v2.id = r.vehicle_id
    left join route_stops ps on ps.id = b.pickup_stop_id
   where b.pass_token = p_token;

  if v.id is null then return null; end if;

  if v_uid is not null then
    v_role := public.jwt_role();
    v_staff :=
      v_role = 'SUPER_ADMIN'
      or (v.owner_profile_id is not null and v.owner_profile_id = v_uid
          and v_role = 'AGENCY')
      or (v_role = 'INSTITUTION_ADMIN' and public.jwt_institution() is not null
          and public.jwt_institution() = coalesce(v.r_inst, v.b_inst))
      or (v_role = 'DRIVER' and v.vehicle_id is not null
          and v.vehicle_id in (select public.driver_today_vehicle_ids()));
  end if;

  if v_staff and v.student_id is not null then
    select coalesce(jsonb_agg(jsonb_build_object('name', pp.full_name, 'phone', pp.phone)), '[]'::jsonb)
      into v_parents
      from parent_students pst
      join parents pa on pa.id = pst.parent_id
      join profiles pp on pp.id = pa.profile_id
     where pst.student_id = v.student_id;
  end if;

  return jsonb_build_object(
    'student_name', v.student_name,
    'college_name', v.college_name,
    'route_name', v.route_name,
    'bus_number', v.bus_number,
    'pickup_name', v.pickup_name,
    'agency_name', v.agency_name,
    'status', v.status,
    'refund_pending', v.cancel_requested_at is not null,
    'billing_period', v.billing_period,
    'pass_start', coalesce(v.pass_start_at, v.paid_at, v.created_at),
    'staff', v_staff,
    'details', case when v_staff then jsonb_build_object(
      'phone', v.student_phone,
      'email', v.student_email,
      'roll_no', v.roll_no,
      'grade', v.grade,
      'address', v.address,
      'guardian_name', v.guardian_name,
      'guardian_phone', v.guardian_phone,
      'driver_name', v.driver_name,
      'parents', coalesce(v_parents, '[]'::jsonb)
    ) else null end
  );
end; $$;
revoke all on function public.ride_pass(text) from public;
grant execute on function public.ride_pass(text) to anon, authenticated;

notify pgrst, 'reload schema';
