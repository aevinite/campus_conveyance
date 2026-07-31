-- 0103_managed_children.sql (idempotent — requires 0090, 0093, 0101)
--
-- PARENT-MANAGED CHILDREN + PER-CHILD BOOKING (decision 2026-07-31).
--
-- Until now only a STUDENT booked, for themselves: reserve_seat / pay_booking /
-- cancel_booking all resolved the rider from auth.uid() (the caller's own
-- students row) — there was no way to say "which child". A PARENT was read-only.
--
-- A family with two commuting kids therefore had no clean path (they'd need two
-- student logins). This migration lets ONE parent account manage multiple
-- children and book a bus/van PER CHILD:
--   * A "managed" child is a students row the parent creates directly, with NO
--     login (profile_id IS NULL). Its name/phone/email live on the students row
--     (a login-backed student reads those from its profile).
--   * reserve_seat gains an optional p_student_id + an authorization check so a
--     linked parent (or the student themselves) can book for that child.
--   * pay_booking / cancel_booking authorize by "own student OR linked parent".
--
-- The one-active-booking rule is UNCHANGED — it is keyed on students.id, so it
-- naturally stays per child: a 2-child parent can hold 2 active bookings, one
-- for each kid, and no child can double-book.

-- ---------------------------------------------------------------------------
-- (1) Child identity on the students row (managed kids have no profile to read
--     name/phone/email from). Login-backed students keep reading these from
--     their profile; these columns are only populated for managed children.
-- ---------------------------------------------------------------------------
alter table students add column if not exists full_name text;
alter table students add column if not exists phone     text;
alter table students add column if not exists email     text;

-- ---------------------------------------------------------------------------
-- (2) Authorization helper: may the caller act for this student? True when the
--     caller IS that student (own login) OR is a parent linked to them. Reused
--     by reserve_seat / pay_booking / cancel_booking and the read RPCs below.
-- ---------------------------------------------------------------------------
create or replace function public.can_act_for_student(p_student_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from students s
     where s.id = p_student_id and s.profile_id = auth.uid()
  ) or exists (
    select 1 from parent_students ps
    join parents pa on pa.id = ps.parent_id
    where ps.student_id = p_student_id and pa.profile_id = auth.uid()
  );
$$;
grant execute on function public.can_act_for_student(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- (3) create_managed_student: a parent adds a child (no login). Auto-creates the
--     caller's parents row (mirrors redeem_parent_link_code) and links the child.
-- ---------------------------------------------------------------------------
create or replace function public.create_managed_student(
  p_full_name text, p_institution_id uuid,
  p_grade text default null, p_roll_no text default null,
  p_address text default null, p_phone text default null, p_email text default null
) returns students language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_role text; v_parent parents; v_student students;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode='P0001'; end if;
  select p.role::text into v_role from profiles p where p.id = v_uid;
  if v_role not in ('PARENT','SUPER_ADMIN') then
    raise exception 'Only parent accounts can add a child' using errcode='P0003';
  end if;
  if coalesce(btrim(p_full_name),'') = '' then
    raise exception 'Please enter the child''s name' using errcode='P0006';
  end if;
  if p_institution_id is null or not exists (
      select 1 from institutions i where i.id = p_institution_id
        and i.is_active = true and coalesce(i.is_deleted,false) = false) then
    raise exception 'Please choose a valid campus' using errcode='P0011';
  end if;

  select * into v_parent from parents where profile_id = v_uid limit 1;
  if v_parent.id is null then
    insert into parents (profile_id) values (v_uid)
      on conflict (profile_id) where profile_id is not null do nothing;
    select * into v_parent from parents where profile_id = v_uid limit 1;
  end if;

  insert into students (institution_id, profile_id, full_name, phone, email, grade, roll_no, address)
  values (p_institution_id, null, btrim(p_full_name),
          nullif(btrim(coalesce(p_phone,'')),''),  nullif(btrim(coalesce(p_email,'')),''),
          nullif(btrim(coalesce(p_grade,'')),''),  nullif(btrim(coalesce(p_roll_no,'')),''),
          nullif(btrim(coalesce(p_address,'')),''))
  returning * into v_student;

  insert into parent_students (parent_id, student_id)
  values (v_parent.id, v_student.id) on conflict do nothing;

  return v_student;
end; $$;
grant execute on function public.create_managed_student(text,uuid,text,text,text,text,text) to authenticated;

-- ---------------------------------------------------------------------------
-- (4) update_managed_student: edit a managed child's details. Only a linked
--     parent may edit, and only a managed (login-less) child.
-- ---------------------------------------------------------------------------
create or replace function public.update_managed_student(
  p_student_id uuid, p_full_name text,
  p_grade text default null, p_roll_no text default null,
  p_address text default null, p_phone text default null, p_email text default null
) returns students language plpgsql security definer set search_path = public as $$
declare v_student students;
begin
  if not public.can_act_for_student(p_student_id) then
    raise exception 'Not your child' using errcode='P0003';
  end if;
  select * into v_student from students where id = p_student_id;
  if v_student.id is null then raise exception 'Child not found' using errcode='P0002'; end if;
  if v_student.profile_id is not null then
    raise exception 'This child has their own account and manages their own details' using errcode='P0003';
  end if;
  if coalesce(btrim(p_full_name),'') = '' then
    raise exception 'Please enter the child''s name' using errcode='P0006';
  end if;
  update students set
      full_name = btrim(p_full_name),
      grade     = nullif(btrim(coalesce(p_grade,'')),''),
      roll_no   = nullif(btrim(coalesce(p_roll_no,'')),''),
      address   = nullif(btrim(coalesce(p_address,'')),''),
      phone     = nullif(btrim(coalesce(p_phone,'')),''),
      email     = nullif(btrim(coalesce(p_email,'')),''),
      updated_at = now()
   where id = p_student_id
   returning * into v_student;
  return v_student;
end; $$;
grant execute on function public.update_managed_student(uuid,text,text,text,text,text,text) to authenticated;

-- ---------------------------------------------------------------------------
-- (5) remove_managed_child: unlink + delete a managed child that has no active
--     booking. (unlink_child from 0027 still handles login-backed children — it
--     only removes the parent_students row.)
-- ---------------------------------------------------------------------------
create or replace function public.remove_managed_child(p_student_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_student students;
begin
  if not public.can_act_for_student(p_student_id) then
    raise exception 'Not your child' using errcode='P0003';
  end if;
  select * into v_student from students where id = p_student_id;
  if v_student.id is null then return; end if;
  if v_student.profile_id is not null then
    raise exception 'This child has their own account — remove the link instead' using errcode='P0003';
  end if;
  if exists (select 1 from bookings
              where student_id = p_student_id
                and status in ('PENDING','CONFIRMED','WAITLISTED')) then
    raise exception 'Cancel this child''s active booking before removing them' using errcode='P0007';
  end if;
  -- Managed child, no active booking: drop it (cascades its cancelled bookings +
  -- parent_students links via the FKs from 0001).
  delete from students where id = p_student_id and profile_id is null;
end; $$;
grant execute on function public.remove_managed_child(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- (6) reserve_seat — now takes an optional p_student_id (the child to book for).
--     Body is 0090's, with only the rider-resolution + details-gate branch new.
--     The 4-arg signature is dropped so PostgREST resolves the 5-arg cleanly.
-- ---------------------------------------------------------------------------
drop function if exists public.reserve_seat(uuid, uuid, uuid, text);

create or replace function public.reserve_seat(
  p_route_id uuid, p_pickup_stop_id uuid, p_drop_stop_id uuid,
  p_billing_period text default null, p_student_id uuid default null
) returns bookings language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_route routes; v_student students; v_alloc seat_allocations;
  v_count int; v_booking bookings; v_status booking_status;
  v_name text; v_phone text; v_email text; v_address text; v_has_stops boolean;
  v_period billing_period; v_plan_price bigint;
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception 'Not authenticated' using errcode='P0001'; end if;
  select * into v_route from routes where id = p_route_id;
  if v_route.id is null then raise exception 'Route not found' using errcode='P0002'; end if;

  -- Resolve the chosen plan (unchanged from 0090).
  if nullif(p_billing_period,'') is not null then
    v_period := p_billing_period::billing_period;
    v_plan_price := case v_period
      when 'MONTHLY'  then v_route.price_monthly_cents
      when 'SEMESTER' then v_route.price_semester_cents
      when 'YEARLY'   then v_route.price_yearly_cents
    end;
    if v_plan_price is null or v_plan_price <= 0 then
      raise exception 'This ride is not offered on the plan you selected' using errcode = 'P0013';
    end if;
  else
    v_period := case
      when v_route.price_semester_cents is not null then 'SEMESTER'::billing_period
      when v_route.price_yearly_cents  is not null then 'YEARLY'::billing_period
      when v_route.price_monthly_cents is not null then 'MONTHLY'::billing_period
      else null
    end;
  end if;

  -- Resolve the rider. Default: the caller's own student row (self-booking,
  -- unchanged). When p_student_id is given, the caller must be that student or a
  -- linked parent — the parent-books-for-a-child path.
  if p_student_id is not null then
    if not public.can_act_for_student(p_student_id) then
      raise exception 'You are not allowed to book for this student' using errcode = 'P0003';
    end if;
    select * into v_student from students where id = p_student_id;
  else
    select * into v_student from students where profile_id = v_uid limit 1;
  end if;
  if v_student.id is null then
    raise exception 'No rider record found — add the child''s details first' using errcode = 'P0006';
  end if;

  -- Details gate. A login-backed rider reads name/phone from their profile; a
  -- parent-managed child (no profile) reads them off the students row.
  if v_student.profile_id is not null then
    select full_name, phone, email into v_name, v_phone, v_email
      from profiles where id = v_student.profile_id;
  else
    v_name  := v_student.full_name;
    v_phone := v_student.phone;
    v_email := v_student.email;
  end if;
  v_address := v_student.address;
  if coalesce(trim(v_name), '') = ''
     or coalesce(trim(v_phone), '') = ''
     or coalesce(trim(v_address), '') = '' then
    raise exception 'Please fill in the rider''s details (name, phone and address) before reserving a seat'
      using errcode = 'P0006';
  end if;

  perform public.expire_stale_holds();

  -- ONE active booking per student, on any route (unchanged; keyed on student).
  if exists (select 1 from bookings
              where student_id = v_student.id
                and status in ('PENDING','CONFIRMED','WAITLISTED')) then
    raise exception 'This rider already has an active booking — one bus at a time. Cancel it from My bookings or wait until it ends.'
      using errcode = 'P0007';
  end if;

  -- Eligibility: the route must be active and its campus live.
  if v_route.is_active = false then
    raise exception 'This route is no longer available for booking' using errcode='P0010';
  end if;
  if not exists (
      select 1 from institutions i
       where i.id = v_route.institution_id
         and i.is_active = true and coalesce(i.is_deleted, false) = false) then
    raise exception 'This school / college is not available for booking right now'
      using errcode = 'P0011';
  end if;

  -- Pickup: the chosen stop must belong to this route (when it has any).
  select exists (select 1 from route_stops where route_id = p_route_id) into v_has_stops;
  if v_has_stops then
    if p_pickup_stop_id is null
       or not exists (select 1 from route_stops
                       where id = p_pickup_stop_id and route_id = p_route_id) then
      raise exception 'Please choose a valid pickup stop for this route' using errcode='P0012';
    end if;
  end if;

  -- Seat availability (lock the allocation to serialize with promotion).
  select sa.* into v_alloc from seat_allocations sa
    join route_assignments ra on ra.id = sa.route_assignment_id
   where ra.route_id = p_route_id order by sa.created_at limit 1
   for update of sa;
  if v_alloc.id is null then
    raise exception 'No seats configured for this route' using errcode='P0004';
  end if;
  if v_alloc.total_seats <= 0 then
    raise exception 'This route is not currently accepting bookings' using errcode='P0004';
  end if;
  select count(*) into v_count from bookings
   where seat_allocation_id = v_alloc.id and status in ('PENDING','CONFIRMED');
  v_status := case when v_count < v_alloc.total_seats then 'PENDING' else 'WAITLISTED' end;

  begin
    insert into bookings (institution_id, student_id, route_id, pickup_stop_id,
        drop_stop_id, status, seat_allocation_id, student_name, student_email,
        billing_period, approved_at, expires_at)
    values (v_route.institution_id, v_student.id, p_route_id, p_pickup_stop_id,
        p_drop_stop_id, v_status, v_alloc.id, v_name, v_email,
        v_period,
        case when v_status = 'PENDING' then now() end,
        case when v_status = 'PENDING' then now() + interval '20 minutes' end)
    returning * into v_booking;
  exception when unique_violation then
    raise exception 'This rider already has an active booking — one bus at a time. Cancel it from My bookings or wait until it ends.'
      using errcode = 'P0007';
  end;
  return v_booking;
end; $$;
grant execute on function public.reserve_seat(uuid, uuid, uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- (7) pay_booking — authorize by "own student OR linked parent" (was: own only).
--     Body otherwise unchanged from 0090.
-- ---------------------------------------------------------------------------
create or replace function public.pay_booking(p_booking_id uuid)
returns bookings language plpgsql security definer set search_path = public as $$
declare v_booking bookings; v_price bigint;
  v_monthly bigint; v_semester bigint; v_yearly bigint; v_flat bigint;
begin
  select * into v_booking from bookings where id = p_booking_id for update;
  if v_booking.id is null then raise exception 'Booking not found' using errcode='P0002'; end if;
  if not public.can_act_for_student(v_booking.student_id) then
    raise exception 'Not your booking' using errcode='P0003'; end if;
  if v_booking.is_paid then return v_booking; end if; -- already paid: no double charge
  if v_booking.status <> 'PENDING' then
    raise exception 'Only a held seat can be paid for' using errcode='P0005'; end if;
  if v_booking.approved_at is null then
    raise exception 'Waiting for agency approval — you can pay as soon as the agency approves your request.'
      using errcode = 'P0009';
  end if;
  if v_booking.expires_at is not null and v_booking.expires_at < now() then
    raise exception 'Your payment window expired — please reserve the seat again'
      using errcode = 'P0008';
  end if;

  select price_monthly_cents, price_semester_cents, price_yearly_cents, price_cents
    into v_monthly, v_semester, v_yearly, v_flat
    from routes where id = v_booking.route_id;
  v_price := case v_booking.billing_period
    when 'MONTHLY'  then v_monthly
    when 'SEMESTER' then v_semester
    when 'YEARLY'   then v_yearly
    else null
  end;
  if v_price is null then v_price := v_flat; end if;

  update bookings set is_paid = true, paid_at = now(), expires_at = null, status = 'CONFIRMED'
   where id = p_booking_id and not is_paid returning * into v_booking;
  if v_booking.id is null then
    select * into v_booking from bookings where id = p_booking_id;
    return v_booking;
  end if;

  insert into payments (institution_id, booking_id, amount_cents, currency, status)
  values (v_booking.institution_id, v_booking.id, coalesce(v_price, 0), 'INR', 'PAID')
  on conflict (booking_id) where booking_id is not null do nothing;

  return v_booking;
end; $$;
grant execute on function public.pay_booking(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- (8) cancel_booking — authorize by "own student OR linked parent". Body from
--     0101 otherwise (reason + refund details, cancel_cause='STUDENT').
-- ---------------------------------------------------------------------------
create or replace function public.cancel_booking(
  p_booking_id uuid, p_reason text default null, p_refund jsonb default null
) returns bookings language plpgsql security definer set search_path = public as $$
declare v_booking bookings;
begin
  select * into v_booking from bookings where id = p_booking_id;
  if v_booking.id is null then raise exception 'Booking not found' using errcode='P0002'; end if;
  if not public.can_act_for_student(v_booking.student_id) then
    raise exception 'Not your booking' using errcode='P0003'; end if;
  if v_booking.status in ('CANCELLED','REJECTED') then return v_booking; end if;
  update bookings
     set status='CANCELLED',
         cancel_cause='STUDENT',
         cancel_reason  = nullif(btrim(coalesce(p_reason, '')), ''),
         refund_details = p_refund
   where id = p_booking_id
   returning * into v_booking;
  return v_booking; -- trigger updates reserved_seats + promotes the waitlist
end; $$;
grant execute on function public.cancel_booking(uuid, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- (9) parent_children — now also returns the campus, a `managed` flag, and the
--     child's single active booking (status + route) so the dashboard can show a
--     status chip and gate the per-child "Book a bus" CTA. Managed children read
--     name/email/phone off the students row (they have no profile).
-- ---------------------------------------------------------------------------
drop function if exists public.parent_children();
create or replace function public.parent_children()
returns table (student_id uuid, full_name text, email text, phone text,
               grade text, address text, institution_id uuid, institution_name text,
               managed boolean, active_booking_id uuid, active_status text,
               active_route_id uuid, active_route_name text)
language sql stable security definer set search_path = public as $$
  select s.id,
         coalesce(pr.full_name, s.full_name),
         coalesce(pr.email, s.email),
         coalesce(pr.phone, s.phone),
         s.grade, s.address, s.institution_id, i.name,
         (s.profile_id is null) as managed,
         ab.id, ab.status::text, ab.route_id, r.name
  from parent_students ps
  join parents pa on pa.id = ps.parent_id and pa.profile_id = auth.uid()
  join students s on s.id = ps.student_id
  left join institutions i on i.id = s.institution_id
  left join lateral (
    select b.id, b.status, b.route_id
    from bookings b
    where b.student_id = s.id and b.status in ('PENDING','CONFIRMED','WAITLISTED')
    order by b.created_at desc limit 1
  ) ab on true
  left join routes r on r.id = ab.route_id
  left join profiles pr on pr.id = s.profile_id
  order by coalesce(pr.full_name, s.full_name) nulls last;
$$;
grant execute on function public.parent_children() to authenticated;

-- ---------------------------------------------------------------------------
-- (10) parent_children_bookings — show a managed child's name (from the students
--      row) when there is no profile. Same columns/body as 0045 otherwise.
-- ---------------------------------------------------------------------------
drop function if exists public.parent_children_bookings();
create or replace function public.parent_children_bookings()
returns table (booking_id uuid, student_id uuid, student_name text,
               route_name text, institution_name text, status text,
               is_paid boolean, created_at timestamptz, pickup_name text,
               departure_time time, bus_number text,
               driver_name text, driver_phone text, driver_changed boolean,
               route_id uuid)
language sql stable security definer set search_path = public as $$
  select b.id, s.id, coalesce(pr.full_name, s.full_name, b.student_name),
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

-- ---------------------------------------------------------------------------
-- (11) parent_child_active_booking — the child's single active booking, for the
--      parent booking page (resume/pay a held seat, or block a second booking).
--      Authorized to a linked parent / the student themselves.
-- ---------------------------------------------------------------------------
create or replace function public.parent_child_active_booking(p_student_id uuid)
returns table (booking_id uuid, status text, is_paid boolean,
               approved_at timestamptz, expires_at timestamptz,
               pickup_stop_id uuid, billing_period text,
               route_id uuid, route_name text)
language sql stable security definer set search_path = public as $$
  select b.id, b.status::text, b.is_paid, b.approved_at, b.expires_at,
         b.pickup_stop_id, b.billing_period::text, b.route_id, r.name
  from bookings b
  left join routes r on r.id = b.route_id
  where public.can_act_for_student(p_student_id)
    and b.student_id = p_student_id
    and b.status in ('PENDING','CONFIRMED','WAITLISTED')
  order by b.created_at desc
  limit 1;
$$;
grant execute on function public.parent_child_active_booking(uuid) to authenticated;
