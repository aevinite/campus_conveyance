-- 0130: audit-4 LOW fixes (rider, agency/admin, tracking, housekeeping). Idempotent.

-- ===== A_rider =====
-- ============================================================================
-- A_rider.sql — audit-4 LOW fixes (rider / parent booking flow).
-- Idempotent: every block is CREATE OR REPLACE (or DROP IF EXISTS + CREATE with
-- grants re-issued). Built from the LIVE definitions (pg_get_functiondef).
-- ============================================================================

-- #6  Manual (agency) approval opened a 20-minute pay window; every other path
--     (reserve_seat, verify reject, notifications, UI) uses 10 minutes.
CREATE OR REPLACE FUNCTION public.confirm_booking(p_booking_id uuid)
 RETURNS bookings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v bookings;
begin
  if not public.agency_owns_booking(p_booking_id) then
    raise exception 'Not your booking' using errcode='P0003'; end if;
  select * into v from bookings where id = p_booking_id;
  if v.id is null then
    raise exception 'This booking no longer exists — refresh the list.' using errcode='P0002'; end if;
  if v.status <> 'PENDING' then
    raise exception 'This booking is no longer pending (the student may have just cancelled it) — refresh the list.' using errcode='P0005'; end if;
  if v.is_paid then
    -- Old pay-first flow: money already received, approval = confirmation.
    update bookings set status='CONFIRMED', approved_at = coalesce(approved_at, now())
      where id = p_booking_id and status = 'PENDING' returning * into v;
  elsif v.approved_at is not null then
    raise exception 'Already approved — waiting for the student to pay.' using errcode='P0006';
  else
    update bookings set approved_at = now(), expires_at = now() + interval '10 minutes'
      where id = p_booking_id and status = 'PENDING' and approved_at is null
    returning * into v;
  end if;
  if v.id is null then
    raise exception 'This booking just changed — refresh the list and try again.' using errcode='P0005'; end if;
  return v;
end; $function$;

-- #6  Same 20 -> 10 minutes for a waitlist promotion (internal helper; keep it locked down).
CREATE OR REPLACE FUNCTION public.promote_waitlist_for(p_alloc uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_total int; v_active int; v_next uuid;
begin
  if p_alloc is null then return; end if;
  loop
    select total_seats into v_total from seat_allocations where id = p_alloc for update;
    if v_total is null then return; end if;
    select count(*) into v_active from bookings
     where seat_allocation_id = p_alloc and status in ('PENDING','CONFIRMED');
    exit when v_active >= v_total;               -- no free seat
    select id into v_next from bookings
     where seat_allocation_id = p_alloc and status = 'WAITLISTED'
     order by created_at
     limit 1 for update skip locked;             -- fair (oldest first), concurrency-safe
    exit when v_next is null;                     -- nobody waiting
    -- → PENDING and auto-approved: the student gets a 10-minute payment window.
    update bookings
       set status = 'PENDING', approved_at = now(), expires_at = now() + interval '10 minutes'
     where id = v_next;
  end loop;
end; $function$;
revoke execute on function public.promote_waitlist_for(uuid) from public;
revoke execute on function public.promote_waitlist_for(uuid) from anon, authenticated;

-- #19 Late UTR submissions had no attempt limit (reject -> resubmit forever inside
--     the 24h window). Now capped + counted like on-time submissions.
CREATE OR REPLACE FUNCTION public.submit_upi_payment(p_booking_id uuid, p_utr text)
 RETURNS bookings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_booking bookings; v_price bigint; v_ref text; v_late boolean := false;
  v_monthly bigint; v_semester bigint; v_yearly bigint; v_flat bigint;
begin
  select * into v_booking from bookings where id = p_booking_id for update;
  if v_booking.id is null then raise exception 'Booking not found' using errcode='P0002'; end if;
  if not public.can_act_for_student(v_booking.student_id) then
    raise exception 'Not your booking' using errcode='P0003'; end if;
  if v_booking.is_paid then return v_booking; end if;
  if coalesce(p_utr,'') !~ '^[0-9]{12}$' then
    raise exception 'Enter the 12-digit UPI reference (UTR) exactly as shown in your UPI app' using errcode='P0015'; end if;

  if ((v_booking.status = 'CANCELLED' and v_booking.cancel_cause = 'PAYMENT_TIMEOUT')
      -- window just closed but the every-minute sweep hasn't cancelled it yet
      or (v_booking.status = 'PENDING' and v_booking.expires_at < now()))
     and v_booking.expires_at > now() - interval '24 hours'
     and v_booking.payment_status in ('UNPAID', 'REJECTED') then
    -- Paid right as the window closed: record it so the admin can verify + refund.
    -- Late UTRs count toward the same 3-attempt cap as on-time ones.
    if v_booking.utr_attempts >= 3 then
      raise exception 'Too many payment attempts on this booking — please contact support' using errcode='P0016'; end if;
    v_late := true;
  else
    if v_booking.status <> 'PENDING' then
      raise exception 'Only a held seat can be paid for' using errcode='P0005'; end if;
    if v_booking.approved_at is null then
      raise exception 'Waiting for approval — you can pay once the request is approved.' using errcode='P0009'; end if;
    if v_booking.expires_at is not null and v_booking.expires_at < now()
       and v_booking.payment_status in ('UNPAID', 'REJECTED') then
      raise exception 'Your payment window expired — please reserve the seat again' using errcode='P0008'; end if;
    if v_booking.payment_status <> 'SUBMITTED' and v_booking.utr_attempts >= 3 then
      raise exception 'Too many payment attempts on this booking — please contact support' using errcode='P0016'; end if;
  end if;

  -- Amount = the plan the booking was made under (same rule as pay_booking).
  select price_monthly_cents, price_semester_cents, price_yearly_cents, price_cents
    into v_monthly, v_semester, v_yearly, v_flat from routes where id = v_booking.route_id;
  v_price := case v_booking.billing_period
    when 'MONTHLY'  then v_monthly when 'SEMESTER' then v_semester
    when 'YEARLY'   then v_yearly  else null end;
  if v_price is null then v_price := v_flat; end if;

  v_ref := 'CC' || upper(left(replace(v_booking.id::text, '-', ''), 12));

  insert into payments (institution_id, booking_id, amount_cents, currency, status,
                        method, upi_utr, reference, submitted_at)
  values (v_booking.institution_id, v_booking.id, coalesce(v_price,0), 'INR', 'CREATED',
          'UPI', p_utr, v_ref, now())
  on conflict (booking_id) where booking_id is not null do update
    set amount_cents = excluded.amount_cents, status = 'CREATED', method = 'UPI',
        upi_utr = excluded.upi_utr, reference = excluded.reference,
        submitted_at = now(), verified_at = null, verified_by = null, verify_note = null,
        updated_at = now();

  if v_late then
    -- Stays / becomes an expired hold (seat released); the money is refunded once verified.
    update bookings set payment_status = 'SUBMITTED', status = 'CANCELLED',
           cancel_cause = 'PAYMENT_TIMEOUT', utr_attempts = utr_attempts + 1
     where id = p_booking_id returning * into v_booking;
  elsif v_booking.payment_status = 'SUBMITTED' then
    -- Correcting the UTR while it's being verified: never extend the deadline.
    return v_booking;
  else
    -- Hold the seat for review (48h) — counted, so a rejected-then-resubmitted
    -- UTR can't keep the seat held indefinitely.
    update bookings
       set payment_status = 'SUBMITTED', expires_at = now() + interval '48 hours',
           utr_attempts = utr_attempts + 1
     where id = p_booking_id returning * into v_booking;
  end if;

  insert into notifications (institution_id, recipient_id, title, body)
  select v_booking.institution_id, p.id, 'UPI payment to verify',
         coalesce(v_booking.student_name, 'A rider') || ' submitted a UPI payment (ref ' || v_ref || ')' ||
         case when v_late then ' after their seat hold expired — verify it, then refund it under Refunds.'
              else ' — verify it in Payments.' end
  from profiles p where p.role = 'SUPER_ADMIN' and coalesce(p.is_deleted, false) = false;

  return v_booking;
end; $function$;

-- #25 reserve_seat skipped the agency-approved check and never validated the
--     drop stop against the route.
CREATE OR REPLACE FUNCTION public.reserve_seat(p_route_id uuid, p_pickup_stop_id uuid, p_drop_stop_id uuid, p_billing_period text DEFAULT NULL::text, p_student_id uuid DEFAULT NULL::uuid)
 RETURNS bookings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid; v_route routes; v_student students; v_alloc seat_allocations;
  v_count int; v_booking bookings;
  v_name text; v_phone text; v_email text; v_address text; v_has_stops boolean;
  v_period billing_period; v_plan_price bigint;
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception 'Not authenticated' using errcode='P0001'; end if;
  select * into v_route from routes where id = p_route_id;
  if v_route.id is null then raise exception 'Route not found' using errcode='P0002'; end if;

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

  if exists (select 1 from bookings
              where student_id = v_student.id
                and status in ('PENDING','CONFIRMED','WAITLISTED')) then
    raise exception 'This rider already has an active booking — one bus at a time. Cancel it from My bookings or wait until it ends.'
      using errcode = 'P0007';
  end if;

  if v_route.is_active = false then
    raise exception 'This route is no longer available for booking' using errcode='P0010';
  end if;
  -- Direct RPC calls must not book onto an unapproved / removed operator's bus.
  if v_route.agency_id is not null and not exists (
      select 1 from agencies a
       where a.id = v_route.agency_id
         and a.status = 'APPROVED' and coalesce(a.is_deleted, false) = false) then
    raise exception 'This operator is not available for booking right now' using errcode='P0010';
  end if;
  if not exists (
      select 1 from institutions i
       where i.id = v_route.institution_id
         and i.is_active = true and coalesce(i.is_deleted, false) = false) then
    raise exception 'This school / college is not available for booking right now'
      using errcode = 'P0011';
  end if;

  select exists (select 1 from route_stops where route_id = p_route_id) into v_has_stops;
  if v_has_stops then
    if p_pickup_stop_id is null
       or not exists (select 1 from route_stops
                       where id = p_pickup_stop_id and route_id = p_route_id) then
      raise exception 'Please choose a valid pickup stop for this route' using errcode='P0012';
    end if;
  end if;
  -- Drop-off is optional (the campus), but if given it must be a stop on THIS route.
  if p_drop_stop_id is not null
     and not exists (select 1 from route_stops
                      where id = p_drop_stop_id and route_id = p_route_id) then
    raise exception 'Please choose a valid drop stop for this route' using errcode='P0012';
  end if;

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
  -- Full bus → clean rejection (no waitlist row to orphan).
  if v_count >= v_alloc.total_seats then
    raise exception 'This bus is full — there are no seats available right now.'
      using errcode = 'P0014';
  end if;

  begin
    insert into bookings (institution_id, student_id, route_id, pickup_stop_id,
        drop_stop_id, status, seat_allocation_id, student_name, student_email,
        billing_period, approved_at, expires_at)
    values (v_route.institution_id, v_student.id, p_route_id, p_pickup_stop_id,
        p_drop_stop_id, 'PENDING', v_alloc.id, v_name, v_email,
        v_period, now(), now() + interval '10 minutes')
    returning * into v_booking;
  exception when unique_violation then
    raise exception 'This rider already has an active booking — one bus at a time. Cancel it from My bookings or wait until it ends.'
      using errcode = 'P0007';
  end;
  return v_booking;
end; $function$;

-- #25 Details made of only spaces passed the form and then looped the student.
CREATE OR REPLACE FUNCTION public.save_student_details(p_full_name text, p_phone text, p_address text, p_grade text, p_guardian_name text, p_guardian_phone text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode='P0001'; end if;
  -- Whitespace-only values used to save, then reserve_seat's trimmed gate bounced
  -- the student straight back to this form. Trim + require the three it gates on.
  if coalesce(btrim(p_full_name), '') = '' or coalesce(btrim(p_phone), '') = ''
     or coalesce(btrim(p_address), '') = '' then
    raise exception 'Please fill in your name, phone and address' using errcode='P0006'; end if;
  update profiles set full_name = btrim(p_full_name), phone = btrim(p_phone) where id = v_uid;
  insert into students (profile_id, grade, address, guardian_name, guardian_phone)
    values (v_uid, nullif(btrim(coalesce(p_grade, '')), ''), btrim(p_address),
            nullif(btrim(coalesce(p_guardian_name, '')), ''),
            nullif(btrim(coalesce(p_guardian_phone, '')), ''))
  on conflict (profile_id) where profile_id is not null do update
    set grade = excluded.grade, address = excluded.address,
        guardian_name = excluded.guardian_name, guardian_phone = excluded.guardian_phone;
end; $function$;

-- #26 unlink_child could strand a managed child's live booking (nobody left to
--     pay or cancel). remove_managed_child already blocks this.
CREATE OR REPLACE FUNCTION public.unlink_child(p_student_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_parent parents;
begin
  select * into v_parent from parents where profile_id = auth.uid() limit 1;
  if v_parent.id is null then
    raise exception 'No parent record for this account' using errcode='P0001';
  end if;
  -- A managed child (no login) with an active booking would be left with no one
  -- able to pay for / cancel it if this is their only parent.
  if exists (select 1 from students s where s.id = p_student_id and s.profile_id is null)
     and exists (select 1 from bookings b where b.student_id = p_student_id
                  and b.status in ('PENDING','CONFIRMED','WAITLISTED'))
     and not exists (select 1 from parent_students ps
                      where ps.student_id = p_student_id and ps.parent_id <> v_parent.id) then
    raise exception 'Cancel this child''s active booking before removing them' using errcode='P0007';
  end if;
  delete from parent_students
   where parent_id = v_parent.id and student_id = p_student_id;
end; $function$;

-- #21 Parent list needs the refund state to label paid cancellations
--     ('Refund pending' / 'Refunded') like the student side. Return type changes,
--     so drop + recreate and re-issue grants.
drop function if exists public.parent_children_bookings();
CREATE OR REPLACE FUNCTION public.parent_children_bookings()
 RETURNS TABLE(booking_id uuid, student_id uuid, student_name text, route_name text, institution_name text, status text, is_paid boolean, created_at timestamp with time zone, pickup_name text, departure_time time without time zone, bus_number text, driver_name text, driver_phone text, driver_changed boolean, route_id uuid, billing_period text, paid_at timestamp with time zone, payment_status text, cancel_requested_at timestamp with time zone, pass_start_at timestamp with time zone, refund_status text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select b.id, s.id, coalesce(pr.full_name, s.full_name, b.student_name),
         coalesce(r.name, r.start_location), i.name, b.status::text,
         b.is_paid, b.created_at, st.name,
         r.departure_time, v.bus_number,
         coalesce(dc.driver_name, v.driver_name),
         coalesce(dc.driver_phone, v.driver_phone),
         (dc.id is not null),
         r.id, b.billing_period::text, b.paid_at,
         b.payment_status, b.cancel_requested_at, b.pass_start_at,
         (select pm.refund_status from payments pm where pm.booking_id = b.id limit 1)
  from parent_students ps
  join parents pa on pa.id = ps.parent_id and pa.profile_id = auth.uid()
  join students s on s.id = ps.student_id
  join bookings b on b.student_id = s.id
  join routes r on r.id = b.route_id
  left join institutions i on i.id = r.institution_id
  left join vehicles v on v.id = r.vehicle_id
  left join bus_driver_changes dc
    on dc.vehicle_id = v.id and dc.role = 'DRIVER'
   and dc.effective_date = (now() at time zone 'Asia/Kolkata')::date
  left join route_stops st on st.id = b.pickup_stop_id
  left join profiles pr on pr.id = s.profile_id
  order by b.created_at desc;
$function$;
revoke execute on function public.parent_children_bookings() from public, anon;
grant execute on function public.parent_children_bookings() to authenticated, service_role;

-- #22 Parents got student copy ('Your seat is confirmed') and /student links in
--     bell/email/push. Parent recipients now get third-person copy + /parent.
CREATE OR REPLACE FUNCTION public.booking_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_route       text;
  v_who         text;
  v_title       text;
  v_body        text;
  v_kind        text;
  v_url         text;
  v_student_pid uuid;
  v_ptitle      text;   -- parent-facing (third person) variants
  v_pbody       text;
  v_is_parent   boolean;
  v_skip_student boolean := false;
  v_rec         record;
begin
  begin
    if tg_op = 'INSERT' then
      if new.status = 'PENDING' then
        v_kind := 'RESERVED';
      elsif new.status = 'WAITLISTED' then
        v_kind := 'WAITLISTED';
      else
        return new;
      end if;
    elsif tg_op = 'UPDATE' then
      if new.status is not distinct from old.status then
        return new;
      elsif new.status = 'CONFIRMED' then
        v_kind := 'CONFIRMED';
      elsif new.status = 'REJECTED' then
        v_kind := 'REJECTED';
      elsif new.status = 'PENDING' and old.status = 'WAITLISTED' then
        v_kind := 'PROMOTED';
      elsif new.status = 'CANCELLED' then
        if new.cancel_cause = 'PAYMENT_TIMEOUT' then
          v_kind := 'EXPIRED';
        elsif new.cancel_cause = 'STUDENT' then
          v_kind := 'CANCELLED_SELF';
        elsif new.cancel_cause = 'PARENT' then
          v_kind := 'CANCELLED_PARENT';
        elsif new.cancel_cause = 'PASS_ENDED' then
          v_kind := 'PASS_ENDED';
        else
          v_kind := 'CANCELLED';
        end if;
      else
        return new;
      end if;
    else
      return new;
    end if;

    select r.name into v_route from routes r where r.id = new.route_id;
    v_route := coalesce(v_route, 'your route');
    v_who := coalesce(nullif(btrim(new.student_name), ''), 'Your child');
    select s.profile_id into v_student_pid from students s where s.id = new.student_id;

    if v_kind = 'RESERVED' then
      v_title := 'Seat reserved — finish payment';
      v_body  := 'Your seat on ' || v_route || ' is held. Complete payment within 10 minutes to confirm it.';
      v_ptitle := 'Seat reserved for ' || v_who || ' — finish payment';
      v_pbody  := v_who || '''s seat on ' || v_route || ' is held. Complete payment within 10 minutes to confirm it.';
    elsif v_kind = 'WAITLISTED' then
      v_title := 'You''re on the waitlist';
      v_body  := v_route || ' is full right now — you''re on the waitlist and we''ll let you know the moment a seat opens up.';
      v_ptitle := v_who || ' is on the waitlist';
      v_pbody  := v_route || ' is full right now — ' || v_who || ' is on the waitlist and we''ll let you know the moment a seat opens up.';
    elsif v_kind = 'CONFIRMED' then
      v_title := 'Booking confirmed';
      v_body  := 'Your seat on ' || v_route || ' is confirmed. Have a safe ride!';
      v_ptitle := 'Booking confirmed for ' || v_who;
      v_pbody  := v_who || '''s seat on ' || v_route || ' is confirmed.';
    elsif v_kind = 'REJECTED' then
      v_title := 'Booking rejected';
      v_body  := 'Your booking for ' || v_route || ' was rejected by the agency. Any payment hold has been released — you can book another route anytime.';
      v_pbody  := v_who || '''s booking for ' || v_route || ' was rejected by the agency. Any payment hold has been released — you can book another route anytime.';
    elsif v_kind = 'PROMOTED' then
      v_title := 'A seat opened up!';
      v_body  := 'Good news — a seat opened on ' || v_route || '. Complete payment within 10 minutes to confirm it before it''s offered to the next person.';
      v_ptitle := 'A seat opened up for ' || v_who || '!';
      v_pbody  := 'Good news — a seat opened on ' || v_route || ' for ' || v_who || '. Complete payment within 10 minutes to confirm it before it''s offered to the next person.';
    elsif v_kind = 'EXPIRED' then
      v_title := 'Reservation expired';
      v_body  := 'Your seat hold on ' || v_route || ' expired because payment wasn''t completed in time. The seat has been released — you can book again anytime.';
      v_pbody  := v_who || '''s seat hold on ' || v_route || ' expired because payment wasn''t completed in time. The seat has been released — you can book again anytime.';
    elsif v_kind = 'CANCELLED_SELF' then
      v_kind  := 'CANCELLED';
      v_skip_student := true;
      v_title := 'Booking cancelled';
      v_body  := v_who || ' cancelled their booking for ' || v_route || '.';
    elsif v_kind = 'CANCELLED_PARENT' then
      -- A parent cancelled: tell everyone, including the student.
      v_kind  := 'CANCELLED';
      v_title := 'Booking cancelled';
      v_body  := 'A parent cancelled ' || v_who || '''s booking for ' || v_route || '.';
    elsif v_kind = 'PASS_ENDED' then
      v_kind  := 'CANCELLED';
      v_title := 'Bus pass ended';
      v_body  := 'The bus pass for ' || v_route || ' has ended and the seat was released. Book again anytime to keep riding.';
      v_pbody  := v_who || '''s bus pass for ' || v_route || ' has ended and the seat was released. Book again anytime to keep riding.';
    else
      v_title := 'Booking cancelled';
      v_body  := 'Your booking for ' || v_route || ' was cancelled and the seat released.';
      v_pbody  := v_who || '''s booking for ' || v_route || ' was cancelled and the seat released.';
    end if;
    -- Kinds already written in the third person reuse the same copy for parents.
    v_ptitle := coalesce(v_ptitle, v_title);
    v_pbody  := coalesce(v_pbody, v_body);

    for v_rec in
      select s.profile_id as pid, pr.email as email
      from students s
      left join profiles pr on pr.id = s.profile_id
      where s.id = new.student_id and s.profile_id is not null
      union
      select pa.profile_id, pr.email
      from parent_students ps
      join parents pa on pa.id = ps.parent_id
      left join profiles pr on pr.id = pa.profile_id
      where ps.student_id = new.student_id and pa.profile_id is not null
    loop
      if v_skip_student and v_rec.pid = v_student_pid then
        continue;
      end if;

      -- Anyone who isn't the rider's own login is a linked parent: third-person
      -- copy and a /parent link (parents can't open /student pages).
      v_is_parent := v_rec.pid is distinct from v_student_pid;
      v_url := case when v_is_parent then '/parent' else '/student/bookings' end;

      insert into notifications (institution_id, recipient_id, title, body)
      values (new.institution_id, v_rec.pid,
              case when v_is_parent then v_ptitle else v_title end,
              case when v_is_parent then v_pbody else v_body end);

      if v_rec.email is not null then
        insert into email_outbox (recipient_id, to_email, kind, title, body, booking_id)
        values (v_rec.pid, v_rec.email, v_kind,
                case when v_is_parent then v_ptitle else v_title end,
                case when v_is_parent then v_pbody else v_body end, new.id);
      end if;

      insert into push_outbox (recipient_id, kind, title, body, url, booking_id)
      values (v_rec.pid, v_kind,
              case when v_is_parent then v_ptitle else v_title end,
              case when v_is_parent then v_pbody else v_body end, v_url, new.id);
    end loop;

  exception when others then
    raise warning 'booking_notify failed for booking %: %', new.id, sqlerrm;
  end;

  return new;
end; $function$;

-- ===== B_agency_admin =====
-- ============================================================================
-- B_agency_admin.sql — audit-4 LOW fixes (agency panel / admin money / settings)
-- Idempotent. Merge into 0130.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- #1 + #9  agency_bookings: expose cancel_cause + cancel_requested_at, and report
-- a paid booking the agency rejected/removed (or the rider cancelled) that is
-- only HELD pending the admin's refund as effective status 'CANCELLING' — so it
-- no longer shows (and filters/counts) as an active PENDING/CONFIRMED booking.
-- Return shape changes -> drop + recreate (re-grant).
-- ---------------------------------------------------------------------------
drop function if exists public.agency_bookings(uuid, text, integer, integer);
create function public.agency_bookings(
  p_agency_id uuid, p_status text default null, p_limit integer default null, p_offset integer default 0)
returns table(booking_id uuid, student_id uuid, status text, created_at timestamptz, is_paid boolean,
  paid_at timestamptz, approved_at timestamptz, payment_due timestamptz, student_name text,
  student_email text, student_phone text, student_address text, student_grade text,
  guardian_name text, guardian_phone text, route_name text, bus_number text,
  bus_registration text, pickup_name text, drop_name text, price_cents bigint,
  cancel_cause text, cancel_requested_at timestamptz)
language sql stable security definer set search_path = public as $$
  select b.id, s.id,
         case when b.cancel_requested_at is not null and b.status in ('PENDING','CONFIRMED')
              then 'CANCELLING' else b.status::text end,
         b.created_at,
         b.is_paid, b.paid_at, b.approved_at, b.expires_at,
         coalesce(pr.full_name, s.full_name, b.student_name), coalesce(pr.email, s.email), coalesce(pr.phone, s.phone),
         s.address, s.grade, s.guardian_name, s.guardian_phone,
         coalesce(r.name, r.start_location),
         v.bus_number, v.registration_no,
         ps.name, i.name, r.price_cents,
         b.cancel_cause, b.cancel_requested_at
  from bookings b
  join routes r on r.id = b.route_id
  left join institutions i on i.id = r.institution_id
  left join vehicles v on v.id = r.vehicle_id
  left join route_stops ps on ps.id = b.pickup_stop_id
  left join students s on s.id = b.student_id
  left join profiles pr on pr.id = s.profile_id
  where r.agency_id = p_agency_id
    and exists (select 1 from agencies a where a.id = p_agency_id and a.owner_profile_id = auth.uid())
    and (p_status is null or
         (case when b.cancel_requested_at is not null and b.status in ('PENDING','CONFIRMED')
               then 'CANCELLING' else b.status::text end) = p_status)
  order by b.created_at desc
  limit p_limit offset coalesce(p_offset, 0);
$$;
grant execute on function public.agency_bookings(uuid, text, integer, integer) to authenticated, service_role;

create or replace function public.agency_bookings_count(p_agency_id uuid, p_status text default null)
returns bigint language sql stable security definer set search_path = public as $$
  select count(*)
  from bookings b
  join routes r on r.id = b.route_id
  where r.agency_id = p_agency_id
    and exists (select 1 from agencies a where a.id = p_agency_id and a.owner_profile_id = auth.uid())
    and (p_status is null or
         (case when b.cancel_requested_at is not null and b.status in ('PENDING','CONFIRMED')
               then 'CANCELLING' else b.status::text end) = p_status);
$$;

-- ---------------------------------------------------------------------------
-- #1 + #2  Manage Students (onboard list/count):
--   * skip bookings held only pending a refund (cancel_requested_at set);
--   * a PURGED hidden student stays hidden for bookings made BEFORE the purge
--     (e.g. the paid seat still held pending refund) — only a booking made
--     after the purge (a genuine re-book, per 0120) brings them back.
-- ---------------------------------------------------------------------------
create or replace function public.agency_onboard_bookings(
  p_agency_id uuid, p_limit integer default null, p_offset integer default 0)
returns table(booking_id uuid, student_id uuid, status text, created_at timestamptz, is_paid boolean,
  paid_at timestamptz, approved_at timestamptz, payment_due timestamptz, student_name text,
  student_email text, student_phone text, student_address text, student_grade text,
  guardian_name text, guardian_phone text, route_name text, bus_number text,
  bus_registration text, pickup_name text, drop_name text, price_cents bigint)
language sql stable security definer set search_path = public as $$
  select b.id, s.id, b.status::text, b.created_at,
         b.is_paid, b.paid_at, b.approved_at, b.expires_at,
         coalesce(pr.full_name, s.full_name), coalesce(pr.email, s.email), coalesce(pr.phone, s.phone),
         s.address, s.grade, s.guardian_name, s.guardian_phone,
         coalesce(r.name, r.start_location),
         v.bus_number, v.registration_no,
         ps.name, i.name, r.price_cents
  from bookings b
  join routes r on r.id = b.route_id
  left join institutions i on i.id = r.institution_id
  left join vehicles v on v.id = r.vehicle_id
  left join route_stops ps on ps.id = b.pickup_stop_id
  left join students s on s.id = b.student_id
  left join profiles pr on pr.id = s.profile_id
  where r.agency_id = p_agency_id
    and b.status::text = 'CONFIRMED'
    and b.cancel_requested_at is null
    and exists (select 1 from agencies a where a.id = p_agency_id and a.owner_profile_id = auth.uid())
    and not exists (
      select 1 from agency_hidden_students h
      where h.agency_id = p_agency_id and h.student_id = b.student_id
        and (h.purged_at is null or b.created_at <= h.purged_at)
    )
  order by b.created_at desc
  limit p_limit offset coalesce(p_offset, 0);
$$;

create or replace function public.agency_onboard_count(p_agency_id uuid)
returns bigint language sql stable security definer set search_path = public as $$
  select count(*)
  from bookings b
  join routes r on r.id = b.route_id
  where r.agency_id = p_agency_id
    and b.status::text = 'CONFIRMED'
    and b.cancel_requested_at is null
    and exists (select 1 from agencies a where a.id = p_agency_id and a.owner_profile_id = auth.uid())
    and not exists (
      select 1 from agency_hidden_students h
      where h.agency_id = p_agency_id and h.student_id = b.student_id
        and (h.purged_at is null or b.created_at <= h.purged_at)
    );
$$;

-- ---------------------------------------------------------------------------
-- #1 + #8 + #9  agency_report:
--   * refund-held bookings (cancel_requested_at set) are no longer counted as
--     pending/confirmed, earned revenue, or active students; new 'cancelling'
--     count;
--   * revenue-by-route grouped by route id (two routes sharing a name no longer
--     merge); adds 'routeId' to each row;
--   * cancellation breakdown by cause ('cancelledBy': rider/expired/agency/
--     passEnded/other) so the UI stops calling every cancel "by student".
-- Same grants as before (service_role only).
-- ---------------------------------------------------------------------------
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
    select b.id, b.status, b.is_paid, b.paid_at, b.student_id, b.cancel_cause, b.created_at,
           b.cancel_requested_at,
           (b.cancel_requested_at is not null and b.status in ('PENDING','CONFIRMED')) as cancelling,
           r.id route_id,
           coalesce(r.name, r.start_location) route_name,
           coalesce((select p.amount_cents from payments p
                      where p.booking_id = b.id and p.status = 'PAID' limit 1),
                    case b.billing_period
                      when 'MONTHLY'  then r.price_monthly_cents
                      when 'SEMESTER' then r.price_semester_cents
                      when 'YEARLY'   then r.price_yearly_cents end,
                    r.price_cents) as paid_cents
    from bookings b join routes r on r.id = b.route_id where r.agency_id = p_agency_id
  ),
  bcounts as (
    select count(*) filter (where status='PENDING'   and not cancelling) pending,
           count(*) filter (where status='CONFIRMED' and not cancelling) confirmed,
           count(*) filter (where cancelling)                            cancelling,
           count(*) filter (where status='REJECTED')  rejected,
           count(*) filter (where status='CANCELLED') cancelled,
           count(*) filter (where status='CANCELLED' and cancel_cause in ('STUDENT','PARENT')) c_rider,
           count(*) filter (where status='CANCELLED' and cancel_cause in ('PAYMENT_TIMEOUT','PAYMENT_REJECTED')) c_expired,
           count(*) filter (where status='CANCELLED' and cancel_cause = 'AGENCY') c_agency,
           count(*) filter (where status='CANCELLED' and cancel_cause = 'PASS_ENDED') c_pass_ended,
           count(*) filter (where status='CANCELLED' and (cancel_cause is null or cancel_cause not in
                    ('STUDENT','PARENT','PAYMENT_TIMEOUT','PAYMENT_REJECTED','AGENCY','PASS_ENDED'))) c_other,
           count(*) total
    from bk
  ),
  -- Earned money: paid bookings still running (not held for a refund), or whose
  -- pass simply ran out (not refunded). First payment dated by paid_at, each
  -- renewal by its own verification time.
  earned as (
    select id, route_id, route_name, paid_cents amount, paid_at at_ts from bk
     where is_paid and not cancelling
       and (status = 'CONFIRMED' or (status = 'CANCELLED' and cancel_cause = 'PASS_ENDED'))
    union all
    select bk.id, bk.route_id, bk.route_name, pr.amount_cents, pr.verified_at
      from pass_renewals pr join bk on bk.id = pr.booking_id
     where pr.status = 'PAID' and not bk.cancelling
  ),
  rev as (
    select coalesce(sum(amount),0) total_cents,
           coalesce(sum(amount) filter (where (at_ts at time zone 'Asia/Kolkata') >= date_trunc('day',   now() at time zone 'Asia/Kolkata')),0) today_cents,
           coalesce(sum(amount) filter (where (at_ts at time zone 'Asia/Kolkata') >= date_trunc('month', now() at time zone 'Asia/Kolkata')),0) month_cents
    from earned
  ),
  rev_by_route as (
    select route_id, min(route_name) name, count(distinct id) bookings, coalesce(sum(amount),0) revenue_cents
    from earned
    group by route_id order by revenue_cents desc
  ),
  active_students as (
    select count(distinct b.student_id) c from bk b
    where b.status='CONFIRMED' and not b.cancelling and b.student_id is not null
      and not exists (select 1 from agency_hidden_students h
                      where h.agency_id = p_agency_id and h.student_id = b.student_id
                        and (h.purged_at is null or b.created_at <= h.purged_at))
  )
  select jsonb_build_object(
    'fleet', (select jsonb_build_object('buses',buses,'vans',vans) from veh),
    'fleetByCollege', coalesce((select jsonb_agg(jsonb_build_object('name',name,'buses',buses,'vans',vans)) from fleet_by_college),'[]'::jsonb),
    'routesByInstitution', coalesce((select jsonb_agg(jsonb_build_object('name',name,'routes',routes)) from routes_by_inst),'[]'::jsonb),
    'bookings', (select jsonb_build_object('pending',pending,'confirmed',confirmed,'cancelling',cancelling,
                   'rejected',rejected,'cancelled',cancelled,'total',total,
                   'cancelledBy', jsonb_build_object('rider',c_rider,'expired',c_expired,'agency',c_agency,
                                                     'passEnded',c_pass_ended,'other',c_other)) from bcounts),
    'revenue', jsonb_build_object(
       'todayCents', (select today_cents from rev),
       'monthCents', (select month_cents from rev),
       'totalCents', (select total_cents from rev),
       'byRoute', coalesce((select jsonb_agg(jsonb_build_object('routeId',route_id,'name',name,'bookings',bookings,'revenueCents',revenue_cents)) from rev_by_route),'[]'::jsonb)),
    'studentsCount', (select c from active_students),
    'servicesCount', (select count(*) from agency_services where agency_id = p_agency_id),
    'routesTotal', (select count(*) from routes_inst)
  );
$$;
revoke execute on function public.agency_report(uuid) from public, anon, authenticated;
grant execute on function public.agency_report(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- #4  Deleting / deactivating a driver clears their substitute assignment for
-- today (and any later date). Covers soft-delete, is_active=false via Manage
-- Drivers, and the hard delete (BEFORE DELETE, ahead of the FK SET NULL that
-- would otherwise leave an orphaned "driver changed for today" row).
-- ---------------------------------------------------------------------------
create or replace function public.drivers_clear_substitute()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE'
     or (coalesce(new.is_deleted, false) and not coalesce(old.is_deleted, false))
     or (not coalesce(new.is_active, false) and coalesce(old.is_active, false)) then
    delete from bus_driver_changes
     where driver_id = old.id
       and effective_date >= (now() at time zone 'Asia/Kolkata')::date;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end; $$;
revoke execute on function public.drivers_clear_substitute() from public, anon, authenticated;

drop trigger if exists trg_drivers_clear_substitute_upd on public.drivers;
create trigger trg_drivers_clear_substitute_upd
  after update of is_active, is_deleted on public.drivers
  for each row execute function public.drivers_clear_substitute();
drop trigger if exists trg_drivers_clear_substitute_del on public.drivers;
create trigger trg_drivers_clear_substitute_del
  before delete on public.drivers
  for each row execute function public.drivers_clear_substitute();

-- One-off cleanup: substitute rows already pointing at inactive/deleted drivers.
delete from bus_driver_changes c
 using drivers d
 where d.id = c.driver_id
   and (coalesce(d.is_deleted, false) or not coalesce(d.is_active, false))
   and c.effective_date >= (now() at time zone 'Asia/Kolkata')::date;

-- ---------------------------------------------------------------------------
-- #5  agency_refunds: 'requested_at' was payments.updated_at (= the processing
-- time once refunded). Report the real cancellation time instead.
-- ---------------------------------------------------------------------------
create or replace function public.agency_refunds(p_agency_id uuid, p_limit integer default null, p_offset integer default 0)
returns table(booking_id uuid, student_name text, student_email text, route_name text, amount_cents bigint,
  refund_status text, refund_amount_cents bigint, refund_details jsonb, cancel_reason text,
  requested_at timestamptz, refunded_at timestamptz)
language sql stable security definer set search_path = public as $$
  select b.id, b.student_name, b.student_email, r.name,
         p.amount_cents, p.refund_status, p.refund_amount_cents,
         b.refund_details, b.cancel_reason,
         coalesce(b.cancel_requested_at, b.updated_at), p.refunded_at
  from payments p
  join bookings b on b.id = p.booking_id
  join routes r on r.id = b.route_id
  where r.agency_id = p_agency_id
    and p.refund_status in ('REQUESTED', 'PROCESSED', 'DECLINED')
    and exists (select 1 from agencies a where a.id = p_agency_id and a.owner_profile_id = auth.uid())
  -- Still-pending refunds first, then most recent.
  order by (p.refund_status = 'REQUESTED') desc, p.updated_at desc
  limit p_limit offset coalesce(p_offset, 0);
$$;

-- #5 (cont.)  verify_upi_payment: when a late-verified payment on an already
-- closed booking queues a refund, stamp cancel_requested_at with the time the
-- booking was actually closed (its pre-verify updated_at) so Refunds pages show
-- the real cancellation time, not the verification time.
-- (Body otherwise identical to the live 0126/0127 definition.)
create or replace function public.verify_upi_payment(p_booking_id uuid, p_approve boolean, p_note text default null)
returns bookings language plpgsql security definer set search_path = public as $function$
declare v_uid uuid := auth.uid(); v_role text; v_booking bookings; v_route text;
  v_note text := nullif(btrim(coalesce(p_note,'')),'');
  v_title text; v_body text;
begin
  select role::text into v_role from profiles where id = v_uid and not coalesce(is_deleted, false);
  if v_role is distinct from 'SUPER_ADMIN' then
    raise exception 'Only an admin can verify payments' using errcode='P0003'; end if;

  select * into v_booking from bookings where id = p_booking_id for update;
  if v_booking.id is null then raise exception 'Booking not found' using errcode='P0002'; end if;
  if v_booking.is_paid then return v_booking; end if;
  if not exists (select 1 from payments where booking_id = p_booking_id and status = 'CREATED') then
    raise exception 'There is no submitted payment waiting to be verified' using errcode='P0005'; end if;
  select coalesce(r.name, 'your route') into v_route from routes r where r.id = v_booking.route_id;

  if p_approve then
    update payments set status = 'PAID', verified_at = now(), verified_by = v_uid,
           verify_note = v_note, updated_at = now()
     where booking_id = p_booking_id and status = 'CREATED';

    if v_booking.status = 'PENDING' and v_booking.cancel_requested_at is null then
      update bookings
         set is_paid = true, paid_at = now(), expires_at = null,
             status = 'CONFIRMED', payment_status = 'PAID'
       where id = p_booking_id returning * into v_booking;
      return v_booking;
    end if;

    -- The rider cancelled / the agency removed the rider while this payment was
    -- being verified, or the hold already ended: keep the money on record, close
    -- the booking, and queue the refund.
    if v_booking.status = 'PENDING' then
      update bookings
         set is_paid = true, paid_at = now(), payment_status = 'PAID', expires_at = null,
             status = case when v_booking.cancel_cause = 'AGENCY'
                           then 'REJECTED'::booking_status else 'CANCELLED'::booking_status end
       where id = p_booking_id returning * into v_booking;
    elsif v_booking.status in ('CANCELLED', 'REJECTED') then
      update bookings set is_paid = true, paid_at = now(), payment_status = 'PAID',
             cancel_requested_at = coalesce(v_booking.cancel_requested_at, v_booking.updated_at)
       where id = p_booking_id returning * into v_booking;
    else
      update bookings set is_paid = true, paid_at = now(), payment_status = 'PAID'
       where id = p_booking_id returning * into v_booking;
    end if;
    update payments set refund_status = 'REQUESTED', updated_at = now()
     where booking_id = p_booking_id and status = 'PAID'
       and refund_status in ('NONE', 'DECLINED');
    v_title := 'Payment received — refund on the way';
    v_body := 'We received your UPI payment for ' || v_route ||
              ', but this booking is no longer active, so we''re refunding it to you.';
  else
    update payments set status = 'FAILED', verified_at = now(), verified_by = v_uid,
           verify_note = v_note, updated_at = now(),
           refund_status = case when refund_status = 'REQUESTED' then 'NONE' else refund_status end
     where booking_id = p_booking_id and status = 'CREATED';

    if v_booking.status = 'PENDING' and v_booking.cancel_requested_at is not null then
      update bookings
         set status = case when v_booking.cancel_cause = 'AGENCY'
                           then 'REJECTED'::booking_status else 'CANCELLED'::booking_status end,
             payment_status = 'REJECTED'
       where id = p_booking_id returning * into v_booking;
      return v_booking;
    elsif v_booking.status = 'PENDING' and v_booking.utr_attempts >= 3 then
      -- Out of attempts: release the seat rather than invite a 4th payment that
      -- submit_upi_payment would refuse.
      update bookings
         set status = 'CANCELLED', cancel_cause = 'PAYMENT_REJECTED', payment_status = 'REJECTED'
       where id = p_booking_id returning * into v_booking;
      v_title := 'Payment could not be verified — seat released';
      v_body := 'We could not verify your UPI payment for ' || v_route ||
                ' after 3 attempts, so the seat hold was released. If money left your account, ' ||
                'contact support with your UPI reference.' || coalesce(' Note: ' || v_note, '');
    elsif v_booking.status = 'PENDING' then
      update bookings
         set payment_status = 'REJECTED', expires_at = now() + interval '10 minutes'
       where id = p_booking_id returning * into v_booking;
      v_title := 'Payment could not be verified';
      v_body := 'We could not verify your UPI payment for ' || v_route ||
                '. Please pay again and re-enter the reference to confirm the seat' ||
                case when v_booking.utr_attempts = 2 then ' (last attempt).' else '.' end ||
                coalesce(' Note: ' || v_note, '');
    else
      update bookings set payment_status = 'REJECTED'
       where id = p_booking_id returning * into v_booking;
      return v_booking;
    end if;
  end if;

  insert into notifications (institution_id, recipient_id, title, body)
  select v_booking.institution_id, pid, v_title, v_body
  from (
    select s.profile_id as pid from students s
      where s.id = v_booking.student_id and s.profile_id is not null
    union
    select pa.profile_id from parent_students ps
      join parents pa on pa.id = ps.parent_id
      where ps.student_id = v_booking.student_id and pa.profile_id is not null
  ) t;
  return v_booking;
end; $function$;

-- ---------------------------------------------------------------------------
-- #6  Manual agency approval gave a 20-minute payment window; everywhere else
-- (auto-approve, UTR retry) it is 10 minutes. Align confirm_booking to 10.
-- (promote_waitlist_for still says 20 minutes — waitlist is dead since 0121/0122;
--  not owned here, flagged to lead.)
-- ---------------------------------------------------------------------------
create or replace function public.confirm_booking(p_booking_id uuid)
returns bookings language plpgsql security definer set search_path = public as $function$
declare v bookings;
begin
  if not public.agency_owns_booking(p_booking_id) then
    raise exception 'Not your booking' using errcode='P0003'; end if;
  select * into v from bookings where id = p_booking_id;
  if v.id is null then
    raise exception 'This booking no longer exists — refresh the list.' using errcode='P0002'; end if;
  if v.status <> 'PENDING' then
    raise exception 'This booking is no longer pending (the student may have just cancelled it) — refresh the list.' using errcode='P0005'; end if;
  if v.is_paid then
    -- Old pay-first flow: money already received, approval = confirmation.
    update bookings set status='CONFIRMED', approved_at = coalesce(approved_at, now())
      where id = p_booking_id and status = 'PENDING' returning * into v;
  elsif v.approved_at is not null then
    raise exception 'Already approved — waiting for the student to pay.' using errcode='P0006';
  else
    update bookings set approved_at = now(), expires_at = now() + interval '10 minutes'
      where id = p_booking_id and status = 'PENDING' and approved_at is null
    returning * into v;
  end if;
  if v.id is null then
    raise exception 'This booking just changed — refresh the list and try again.' using errcode='P0005'; end if;
  return v;
end; $function$;

-- ---------------------------------------------------------------------------
-- #12  Maintenance switches: atomic single-field update. The app used to
-- read-modify-write the whole {website, app} object from a 10s in-process
-- cache, so toggling Website then App within 10s (or on two instances) could
-- revert the other switch. This updates ONLY the target key under the row lock
-- of INSERT ... ON CONFLICT DO UPDATE, expanding a legacy {enabled} value first.
-- service_role only (called from the server with the admin client after
-- isActiveSuperAdmin()).
-- ---------------------------------------------------------------------------
create or replace function public.set_maintenance_flag(p_target text, p_enabled boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if p_target not in ('website', 'app') then
    raise exception 'Invalid maintenance target' using errcode = 'P0005'; end if;
  insert into app_settings (key, value, updated_at)
  values ('maintenance',
          jsonb_build_object('website', false, 'app', false)
            || jsonb_build_object(p_target, p_enabled, 'updatedAt', to_jsonb(now())),
          now())
  on conflict (key) do update
    set value = (
          case when app_settings.value ? 'enabled' then
                 (app_settings.value - 'enabled')
                 || jsonb_build_object(
                      'website', coalesce(app_settings.value->'website', app_settings.value->'enabled'),
                      'app',     coalesce(app_settings.value->'app',     app_settings.value->'enabled'))
               else app_settings.value end
        ) || jsonb_build_object(p_target, p_enabled, 'updatedAt', to_jsonb(now())),
        updated_at = now()
  returning value into v;
  return v;
end; $$;
revoke execute on function public.set_maintenance_flag(text, boolean) from public, anon, authenticated;
grant execute on function public.set_maintenance_flag(text, boolean) to service_role;

notify pgrst, 'reload schema';

-- ===== C_campus =====
-- Agent C (campus / institution) — audit-4 LOW #14–#17
-- No SQL required. All four fixes are app-side:
--  #14 approve/restore campus: guarded update now .select()s affected row; no audit log when 0 rows.
--  #15 disabled campus: layout shows a distinct "Campus disabled" state (is_verified && !is_active, or is_deleted).
--  #16 campus reviews: listCampusAgencyReviews (service-role) now scopes reviews to this campus via
--      reviews.booking_id -> bookings.institution_id (fallback students.institution_id), and computes
--      campus-scoped avg/count. RLS intentionally unchanged: reviews_public_read (is_hidden=false) is the
--      public marketplace rating read for every authenticated user.
--  #17 campus signup phone: written to profiles.phone (existing column) by the service-role link update.

-- ===== D_tracking =====
-- ============================================================================
-- D — tracking / driver fixes (audit-4 LOW #23, #24, #27). Idempotent.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- #23 — live bus visibility needs a CURRENT active booking, not any booking.
--
-- bus_live_location let a rider watch a bus while holding ANY PENDING booking
-- (reserve -> watch -> cancel -> reserve again ...), and kept a CONFIRMED rider
-- who had already asked to cancel (refund hold) or whose pass had lapsed (the
-- end_lapsed_passes cron only flips those 3 days + up to an hour later).
-- A rider (student or linked parent) may now watch only while the booking is
-- a live ride: CONFIRMED, no cancellation requested, and the pass not ended.
-- Staff arms (SUPER_ADMIN / owning agency / campus admin) are unchanged.
-- ----------------------------------------------------------------------------
create or replace function public.booking_is_active_ride(b public.bookings)
returns boolean
language sql
stable
set search_path = public
as $$
  select b.status = 'CONFIRMED'
     and b.cancel_requested_at is null
     and (b.billing_period is null or public.booking_pass_end(b) > now());
$$;

create or replace function public.bus_live_location(p_route_id uuid)
 returns table(live boolean, lat double precision, lng double precision, updated_at timestamp with time zone, bus_number text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select (coalesce(dl.is_online, false) and dl.updated_at > now() - interval '2 minutes') as live,
         case when coalesce(dl.is_online, false) and dl.updated_at > now() - interval '2 minutes'
              then dl.lat end,
         case when coalesce(dl.is_online, false) and dl.updated_at > now() - interval '2 minutes'
              then dl.lng end,
         dl.updated_at, v.bus_number
  from routes r
  join vehicles v on v.id = r.vehicle_id
  -- Only the DRIVER substitute matters for the live map (see 0056).
  left join bus_driver_changes dc
    on dc.vehicle_id = v.id and dc.role = 'DRIVER'
   and dc.effective_date = (now() at time zone 'Asia/Kolkata')::date
  left join driver_locations dl on dl.driver_id = coalesce(dc.driver_id, v.driver_id)
  where r.id = p_route_id
    and (
      public.jwt_role() = 'SUPER_ADMIN'
      or exists (select 1 from agencies a
                  where a.id = r.agency_id and a.owner_profile_id = auth.uid())
      or (public.jwt_role() = 'INSTITUTION_ADMIN'
          and r.institution_id is not null
          and r.institution_id = public.jwt_institution())
      -- #23: riders only while the booking is a CURRENT active ride.
      or exists (
        select 1 from bookings b join students s on s.id = b.student_id
        where b.route_id = p_route_id and s.profile_id = auth.uid()
          and public.booking_is_active_ride(b)
      )
      or exists (
        select 1 from bookings b
        join parent_students ps on ps.student_id = b.student_id
        join parents pa on pa.id = ps.parent_id
        where b.route_id = p_route_id and pa.profile_id = auth.uid()
          and public.booking_is_active_ride(b)
      )
    )
  limit 1;
$function$;

-- ----------------------------------------------------------------------------
-- #24 — ETA badge: where is the rider's (effective) pickup stop, and has the bus
-- already been there today?
--
-- Returns one row per active booking the caller rides / is a linked parent of on
-- this route. The effective pickup honours today's skips (same roll-forward as
-- check_pickup_geofence). `state`:
--   'WAITING'  — bus hasn't reached the stop yet (show "N min away")
--   'ON_BOARD' — driver marked BOARDED today (latest stage)
--   'DONE'     — REACHED / GOT_OFF today
--   'PASSED'   — driver's NEXT stop today is beyond this pickup (bus has passed)
--   'NO_STOP'  — pickup and every later stop skipped today
-- No rows for staff / non-riders (so admin maps show no badge).
-- ----------------------------------------------------------------------------
create or replace function public.rider_pickup_progress(p_route_id uuid)
returns table(booking_id uuid, student_name text, stop_id uuid, stop_name text,
              lat double precision, lng double precision, stop_sequence int, state text)
language sql
stable security definer
set search_path to 'public'
as $function$
  with today as (select (now() at time zone 'Asia/Kolkata')::date as d),
  mine as (
    select b.id, b.route_id, b.pickup_stop_id, b.student_name
      from bookings b join students s on s.id = b.student_id
     where b.route_id = p_route_id and s.profile_id = auth.uid()
       and public.booking_is_active_ride(b)
    union
    select b.id, b.route_id, b.pickup_stop_id, b.student_name from bookings b
      join parent_students ps on ps.student_id = b.student_id
      join parents pa on pa.id = ps.parent_id
     where b.route_id = p_route_id and pa.profile_id = auth.uid()
       and public.booking_is_active_ride(b)
  ),
  next_stop as (
    select rs.sequence from route_stop_progress p
      join route_stops rs on rs.id = p.stop_id
     where p.route_id = p_route_id and p.status = 'NEXT'
       and p.service_date = (select d from today)
     limit 1
  )
  select m.id, m.student_name, st.id, st.name, st.lat, st.lng, st.sequence,
         case
           when st.id is null then 'NO_STOP'
           when last_ev.stage = 'BOARDED' then 'ON_BOARD'
           when last_ev.stage in ('REACHED', 'GOT_OFF') then 'DONE'
           when (select sequence from next_stop) > st.sequence then 'PASSED'
           else 'WAITING'
         end
  from mine m
  join route_stops st0 on st0.id = m.pickup_stop_id
  left join lateral (
    select rs.id, rs.name, rs.lat, rs.lng, rs.sequence from route_stops rs
     where rs.route_id = m.route_id and rs.sequence >= st0.sequence
       and not exists (select 1 from route_stop_progress sp
                        where sp.route_id = m.route_id and sp.stop_id = rs.id
                          and sp.service_date = (select d from today)
                          and sp.status = 'SKIPPED')
     order by rs.sequence limit 1
  ) st on true
  left join lateral (
    select re.stage::text as stage from ride_events re
     where re.booking_id = m.id
       and (re.recorded_at at time zone 'Asia/Kolkata')::date = (select d from today)
     order by re.recorded_at desc limit 1
  ) last_ev on true
  order by st.sequence nulls last;
$function$;

revoke all on function public.rider_pickup_progress(uuid) from public, anon;
grant execute on function public.rider_pickup_progress(uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- #27a — skipping an already-skipped stop must not re-notify every rider.
-- Re-tap = no-op that just returns the redirect stop name for the UI.
-- ----------------------------------------------------------------------------
create or replace function public.driver_skip_stop(p_route_id uuid, p_stop_id uuid)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_institution uuid := public.driver_assert_route(p_route_id);
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_stop_name text;
  v_seq int;
  v_next_name text;
  v_barrier_seq int;
  v_body text;
  v_rec record;
  v_was_skipped boolean;
begin
  select rs.name, rs.sequence into v_stop_name, v_seq
  from route_stops rs where rs.id = p_stop_id and rs.route_id = p_route_id;
  if v_stop_name is null then
    raise exception 'That stop is not on this route' using errcode = 'P0004';
  end if;

  -- #27: already skipped today? Then this is a re-tap — don't re-alert riders.
  select exists (
    select 1 from route_stop_progress p
    where p.route_id = p_route_id and p.stop_id = p_stop_id
      and p.service_date = v_today and p.status = 'SKIPPED'
  ) into v_was_skipped;

  if not v_was_skipped then
    insert into route_stop_progress
      (institution_id, route_id, stop_id, service_date, status, recorded_by, recorded_at)
    values (v_institution, p_route_id, p_stop_id, v_today, 'SKIPPED', v_uid, now())
    on conflict (route_id, stop_id, service_date)
    do update set status = 'SKIPPED', recorded_by = v_uid, recorded_at = now();
  end if;

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

  if v_was_skipped then return v_next_name; end if; -- no change → no re-notify

  if v_next_name is not null then
    v_body := 'The bus will not stop at ' || v_stop_name
      || ' today. Please go to the next stop, ' || v_next_name || ', to board.';
  else
    v_body := 'The bus will not stop at ' || v_stop_name
      || ' today. Please contact your service provider for an alternative.';
  end if;

  -- The last NON-skipped stop before this one is the barrier: every stop after it
  -- up to and including this one is skipped today, so riders at any of them are
  -- (now) redirected to v_next_name and must be told.
  select coalesce(max(rs.sequence), -1) into v_barrier_seq
  from route_stops rs
  where rs.route_id = p_route_id and rs.sequence < v_seq
    and not exists (
      select 1 from route_stop_progress p
      where p.route_id = p_route_id and p.stop_id = rs.id
        and p.service_date = v_today and p.status = 'SKIPPED');

  for v_rec in
    select rs.id as stop_id
    from route_stops rs
    where rs.route_id = p_route_id
      and rs.sequence > v_barrier_seq and rs.sequence <= v_seq
  loop
    perform public.notify_stop_riders(
      p_route_id, v_rec.stop_id, v_institution, 'Pickup point changed', v_body);
  end loop;

  return v_next_name;
end; $function$;

-- ----------------------------------------------------------------------------
-- #27b — stage marking: reject non-active bookings (CANCELLED / REJECTED /
-- unpaid PENDING ...) and don't duplicate the same stage. A repeat of the rider's
-- LATEST stage today is a double-tap: return the existing event, no new row, no
-- new notification. (A later genuine repeat — e.g. BOARDED again for the return
-- leg after GOT_OFF — is still recorded, since the latest stage differs.)
-- ----------------------------------------------------------------------------
create or replace function public.driver_mark_stage(p_booking_id uuid, p_stage text)
 returns table(stage text, recorded_at timestamp with time zone)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_stage ride_stage;
  v_booking bookings;
  v_student_profile uuid;
  v_student_name text;
  v_bus text;
  v_college text;
  v_when timestamptz := now();
  v_time text;
  v_title text;
  v_body text;
  v_recipient uuid;
  v_last_stage ride_stage;
  v_last_at timestamptz;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = 'P0001';
  end if;

  begin
    v_stage := p_stage::ride_stage;
  exception when others then
    raise exception 'Unknown ride stage: %', p_stage using errcode = 'P0002';
  end;

  -- Authorize: the booking must be on a bus this driver drives TODAY
  -- (permanent OR substitute).
  select b.* into v_booking
  from bookings b
  join routes r on r.id = b.route_id
  join vehicles v on v.id = r.vehicle_id
  where b.id = p_booking_id
    and v.id in (select public.driver_today_vehicle_ids())
  limit 1;
  if v_booking.id is null then
    raise exception 'This rider is not on one of your buses' using errcode = 'P0003';
  end if;

  -- #27: only a live (CONFIRMED) booking can be marked.
  if v_booking.status <> 'CONFIRMED' then
    raise exception 'This booking is no longer active' using errcode = 'P0005';
  end if;

  -- #27: same stage as the latest one today → idempotent, no duplicate notice.
  -- Lock the booking row so two concurrent taps serialize on this check.
  perform 1 from bookings where id = v_booking.id for update;
  select re.stage, re.recorded_at into v_last_stage, v_last_at
  from ride_events re
  where re.booking_id = v_booking.id
    and (re.recorded_at at time zone 'Asia/Kolkata')::date
        = (v_when at time zone 'Asia/Kolkata')::date
  order by re.recorded_at desc
  limit 1;
  if v_last_stage is not null and v_last_stage = v_stage then
    return query select v_stage::text, v_last_at;
    return;
  end if;

  select pr.id, coalesce(pr.full_name, v_booking.student_name)
    into v_student_profile, v_student_name
  from students s
  left join profiles pr on pr.id = s.profile_id
  where s.id = v_booking.student_id
  limit 1;

  select v.bus_number, i.name into v_bus, v_college
  from routes r
  left join vehicles v on v.id = r.vehicle_id
  left join institutions i on i.id = r.institution_id
  where r.id = v_booking.route_id
  limit 1;

  insert into ride_events (institution_id, booking_id, student_id, stage, recorded_by, recorded_at)
  values (v_booking.institution_id, v_booking.id, v_booking.student_id, v_stage, v_uid, v_when);

  v_time := to_char(v_when at time zone 'Asia/Kolkata', 'FMHH12:MI AM');
  v_student_name := coalesce(v_student_name, 'Your child');
  if v_stage = 'BOARDED' then
    v_title := 'Boarded the bus';
    v_body := v_student_name || ' boarded '
      || coalesce('Bus ' || v_bus, 'the bus') || ' at ' || v_time || '.';
  elsif v_stage = 'REACHED' then
    v_title := 'Reached ' || coalesce(v_college, 'campus');
    v_body := v_student_name || ' reached ' || coalesce(v_college, 'campus')
      || ' at ' || v_time || '.';
  else
    v_title := 'Got off the bus';
    v_body := v_student_name || ' got off the bus at ' || v_time || '.';
  end if;

  for v_recipient in
    select v_student_profile where v_student_profile is not null
    union
    select pa.profile_id
    from parent_students ps
    join parents pa on pa.id = ps.parent_id
    where ps.student_id = v_booking.student_id and pa.profile_id is not null
  loop
    insert into notifications (institution_id, recipient_id, title, body)
    values (v_booking.institution_id, v_recipient, v_title, v_body);
  end loop;

  return query select v_stage::text, v_when;
end; $function$;

-- #27c (heartbeat vs stale-online) needs no SQL: the rider map's freshness window
-- stays 2 min and clear_stale_driver_online stays 10 min; the client heartbeat now
-- guarantees a write at most ~30s apart (see driver-tracker.tsx), a 4x margin.

notify pgrst, 'reload schema';

-- ===== C_campus #17 backfill: campus-admin phone from signup metadata =====
update public.profiles p set phone = nullif(btrim(u.raw_user_meta_data->>'phone'), '')
  from auth.users u
 where u.id = p.id and p.role = 'INSTITUTION_ADMIN' and coalesce(p.phone, '') = ''
   and nullif(btrim(u.raw_user_meta_data->>'phone'), '') is not null;

-- ===== E_housekeeping =====
-- ===========================================================================
-- E_housekeeping.sql  (agent E: audit LOW housekeeping — merge into 0130)
-- Idempotent: every block can be re-run safely. Contains NO secrets.
-- Requires: pg_cron, pg_net, supabase_vault (all installed live).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- (B) Bring the two live-only cron jobs into the repo.
--   * warm-vercel  : pings /login every 5 min to keep a function warm. No secret.
--   * drain-outbox : hits /api/cron/drain with the service-role bearer. The key
--                    used to be INLINED in cron.job.command; it is now read at
--                    run time from Supabase Vault (secret 'service_role_key',
--                    created out-of-band by the one-off E_vault_secret.sql —
--                    never committed). The route validates exactly
--                    "Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>".
--   drain-outbox is only (re)scheduled once the vault secret exists, so running
--   this before the secret is loaded leaves the old job in place rather than
--   breaking delivery.
-- ---------------------------------------------------------------------------
select cron.unschedule(jobid) from cron.job where jobname = 'warm-vercel';
select cron.schedule('warm-vercel', '*/5 * * * *',
  $cron$select net.http_get('https://campus-conveyance.vercel.app/login')$cron$);

do $$
begin
  if exists (select 1 from vault.secrets where name = 'service_role_key') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'drain-outbox';
    perform cron.schedule('drain-outbox', '*/2 * * * *', $cron$
      select net.http_get(
        url := 'https://campus-conveyance.vercel.app/api/cron/drain',
        headers := jsonb_build_object(
          'Authorization',
          'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                         where name = 'service_role_key' limit 1)))
    $cron$);
  else
    raise notice 'vault secret service_role_key missing: run E_vault_secret.sql first; drain-outbox left unchanged';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- (C) Applied-migrations ledger.
-- CONVENTION: every new migration file NNNN_name.sql must END with
--   insert into public.schema_migrations_applied (version, name)
--   values ('NNNN', 'NNNN_name') on conflict (version) do nothing;
-- so the live DB records exactly which files have been applied.
-- Backfill: every file in supabase/migrations (all verified live) + 0130.
-- There is no 0082 file (number skipped), so it is intentionally absent.
-- ---------------------------------------------------------------------------
create table if not exists public.schema_migrations_applied (
  version    text primary key,
  name       text,
  applied_at timestamptz not null default now()
);
alter table public.schema_migrations_applied enable row level security;
-- No policies + no grants: only postgres / service_role touch it.
revoke all on table public.schema_migrations_applied from public, anon, authenticated;

insert into public.schema_migrations_applied (version, name) values
  ('0001', '0001_init'),
  ('0002', '0002_rls'),
  ('0003', '0003_booking'),
  ('0004', '0004_marketplace'),
  ('0005', '0005_panels'),
  ('0006', '0006_perf_indexes'),
  ('0007', '0007_institution_verified_and_users'),
  ('0008', '0008_agency_contact_and_booking_details'),
  ('0009', '0009_agency_service_requests'),
  ('0010', '0010_backfill_agency_services'),
  ('0011', '0011_bus_driver_details'),
  ('0012', '0012_bus_driver_full_details'),
  ('0013', '0013_bus_ac'),
  ('0014', '0014_vehicle_photos_upload_policy'),
  ('0015', '0015_route_stops_map'),
  ('0016', '0016_route_stop_description_and_edit'),
  ('0017', '0017_bus_photos_multi'),
  ('0018', '0018_student_details_and_payment'),
  ('0019', '0019_reserved_seats_trigger'),
  ('0020', '0020_agency_booking_details'),
  ('0021', '0021_agency_drivers'),
  ('0022', '0022_driver_panel'),
  ('0023', '0023_agency_confirms_booking'),
  ('0024', '0024_admin_panel_fixes'),
  ('0025', '0025_student_booking_guards'),
  ('0026', '0026_contact_messages'),
  ('0027', '0027_parent_dashboard'),
  ('0028', '0028_booking_rejected_status'),
  ('0029', '0029_agency_panel_fixes'),
  ('0030', '0030_student_self_read'),
  ('0031', '0031_agency_bookings_student_id'),
  ('0032', '0032_approval_then_payment'),
  ('0033', '0033_pay_booking_race'),
  ('0034', '0034_rate_limiting'),
  ('0035', '0035_waitlist_promotion'),
  ('0036', '0036_agency_services_unique'),
  ('0037', '0037_cancel_cause'),
  ('0038', '0038_zero_capacity_not_bookable'),
  ('0039', '0039_waitlist_promotion_lock'),
  ('0040', '0040_auto_approve'),
  ('0041', '0041_bus_driver_change'),
  ('0042', '0042_driver_safety_details'),
  ('0043', '0043_ride_status'),
  ('0044', '0044_driver_location'),
  ('0045', '0045_parent_live_route'),
  ('0046', '0046_substitute_registered_driver'),
  ('0047', '0047_conductor'),
  ('0048', '0048_driver_full_profile'),
  ('0049', '0049_driver_soft_delete'),
  ('0050', '0050_parent_link_codes'),
  ('0051', '0051_agency_bookings_paginate'),
  ('0052', '0052_perf_index_and_cron'),
  ('0053', '0053_report_aggregation'),
  ('0054', '0054_rate_limit_cleanup_and_route_bookings'),
  ('0055', '0055_one_active_booking'),
  ('0056', '0056_substitute_driver_panel'),
  ('0057', '0057_drop_legacy_link_child'),
  ('0058', '0058_redeem_already_linked'),
  ('0059', '0059_agency_onboard_count'),
  ('0060', '0060_email_index_and_hidden_students_page'),
  ('0061', '0061_retention_indexes_and_driver_buses'),
  ('0062', '0062_institution_routes'),
  ('0063', '0063_driver_paging_and_agency_email'),
  ('0064', '0064_audit_retention_and_agency_driver_paging'),
  ('0065', '0065_admin_sort_indexes_and_driver_fixes'),
  ('0066', '0066_agencies_sort_index'),
  ('0067', '0067_parent_bookings_limit'),
  ('0068', '0068_driver_suppress_and_route_search'),
  ('0069', '0069_roster_tiebreak_and_revenue_by_route_id'),
  ('0070', '0070_route_search_trigram'),
  ('0071', '0071_lockdown_definer_functions'),
  ('0072', '0072_jwt_helpers_search_path'),
  ('0073', '0073_atomic_rate_limit'),
  ('0074', '0074_unique_profile_student_parent'),
  ('0075', '0075_hot_path_indexes'),
  ('0076', '0076_db_hygiene_indexes'),
  ('0077', '0077_seat_and_driver_uniqueness'),
  ('0078', '0078_graceful_autocreate_on_conflict'),
  ('0079', '0079_index_cleanup'),
  ('0080', '0080_parent_code_unique'),
  ('0081', '0081_cascade_fk_indexes'),
  ('0083', '0083_large_indexes_concurrent'),
  ('0084', '0084_lockdown_report_functions'),
  ('0085', '0085_drop_unused_tables'),
  ('0086', '0086_driver_stop_progress'),
  ('0087', '0087_reviewer_fk_indexes'),
  ('0088', '0088_retention_route_stop_progress'),
  ('0089', '0089_route_stop_progress_indexes_and_dedup'),
  ('0090', '0090_route_billing_plans'),
  ('0091', '0091_parent_link_code_ttl'),
  ('0092', '0092_reassert_signup_seed_and_backfill'),
  ('0093', '0093_booking_lifecycle_notifications'),
  ('0094', '0094_push_notifications'),
  ('0095', '0095_agency_reviews'),
  ('0096', '0096_driver_runsheet_pickup_order'),
  ('0097', '0097_pickup_geofence_alerts'),
  ('0098', '0098_ride_history'),
  ('0099', '0099_notifications_realtime'),
  ('0100', '0100_ride_history_boardings'),
  ('0101', '0101_cancel_reason_refund'),
  ('0102', '0102_route_list_live_seats'),
  ('0103', '0103_managed_children'),
  ('0104', '0104_institution_agencies'),
  ('0105', '0105_institution_agencies_by_type'),
  ('0106', '0106_route_availability_rls_fix'),
  ('0107', '0107_upi_payments'),
  ('0108', '0108_payment_window_10min'),
  ('0109', '0109_booking_status_lookup'),
  ('0110', '0110_driver_buses_live_seats'),
  ('0111', '0111_agency_hidden_students_purge'),
  ('0112', '0112_cancellation_refunds'),
  ('0113', '0113_agency_refunds'),
  ('0114', '0114_agency_completed_payments'),
  ('0115', '0115_refund_hold_cancellation'),
  ('0116', '0116_booking_history'),
  ('0117', '0117_parent_bookings_pass'),
  ('0118', '0118_driver_runsheet_managed_children'),
  ('0119', '0119_agency_remove_student_refund'),
  ('0120', '0120_onboard_ignore_purged'),
  ('0121', '0121_reserve_seat_no_waitlist'),
  ('0122', '0122_audit_fixes_batch2'),
  ('0123', '0123_set_next_stop_no_spam'),
  ('0124', '0124_service_request_two_stage'),
  ('0125', '0125_security_lockdown'),
  ('0126', '0126_money_and_tracking_fixes'),
  ('0127', '0127_rider_flow_fixes'),
  ('0128', '0128_audit4_lockdown'),
  ('0129', '0129_audit4_mediums'),
  ('0130', '0130_audit_lows')
on conflict (version) do nothing;

-- ---------------------------------------------------------------------------
-- (D) Retention: restore + extend the daily sweep.
-- 0064 (audit_logs 180d) and 0088 (route_stop_progress 30d) added these, but
-- 0093/0094 later re-created retention_cleanup() from an older body and
-- silently DROPPED both lines (verified: the live function has neither), so
-- those tables grow forever again. The 'data-retention-cleanup' cron (0061,
-- daily 03:20) already calls this function — no new job needed.
--   * audit_logs          180 days (admin trail; no rider feature reads it)
--   * route_stop_progress  30 days (only today's service_date is ever read)
--   * pickup_alerts        30 days (per-(booking, day) geofence dedup; only
--                                   today's row matters)
--   * ride_events stays at 90 days — my_ride_history (0098/0100) reads it;
--     my_booking_history (0116) reads bookings/payments, which are never purged.
-- NOTE for lead: if another agent's SQL also redefines retention_cleanup(),
-- merge the bodies — the LAST definition wins.
-- ---------------------------------------------------------------------------
create or replace function public.retention_cleanup() returns void
language sql security definer set search_path = public as $$
  delete from ride_events where created_at < now() - interval '90 days';
  delete from notifications
    where created_at < now() - interval '90 days'
       or (is_read = true and created_at < now() - interval '30 days');
  delete from parent_link_codes where expires_at < now() - interval '1 day';
  -- Sent mail after 30 days; give-up (attempts exhausted) rows after 7.
  delete from email_outbox
    where (sent_at is not null and sent_at < now() - interval '30 days')
       or (sent_at is null and attempts >= 5 and created_at < now() - interval '7 days');
  delete from push_outbox
    where (sent_at is not null and sent_at < now() - interval '30 days')
       or (sent_at is null and attempts >= 5 and created_at < now() - interval '7 days');
  -- Push endpoints unseen for 90 days are stale.
  delete from push_subscriptions where last_seen_at < now() - interval '90 days';
  delete from audit_logs where created_at < now() - interval '180 days';
  delete from route_stop_progress
    where service_date < ((now() at time zone 'Asia/Kolkata')::date - 30);
  delete from pickup_alerts
    where service_date < ((now() at time zone 'Asia/Kolkata')::date - 30);
$$;
revoke execute on function public.retention_cleanup() from public;
revoke execute on function public.retention_cleanup() from anon, authenticated;

-- ---------------------------------------------------------------------------
-- (E) Unindexed foreign keys (public schema; aw_* tables excluded). Found via a
-- pg_constraint vs pg_index leading-column check on 2026-09-30 — 8 FKs. Speeds
-- ON DELETE cascade / SET NULL from profiles + bookings and outbox/refund
-- lookups. Tables are tiny, so plain CREATE INDEX (not CONCURRENTLY) is fine.
-- ---------------------------------------------------------------------------
create index if not exists idx_email_outbox_booking_id   on public.email_outbox (booking_id);
create index if not exists idx_email_outbox_recipient_id on public.email_outbox (recipient_id);
create index if not exists idx_push_outbox_booking_id    on public.push_outbox (booking_id);
create index if not exists idx_push_outbox_recipient_id  on public.push_outbox (recipient_id);
create index if not exists idx_pass_renewals_verified_by on public.pass_renewals (verified_by);
create index if not exists idx_payments_verified_by      on public.payments (verified_by);
create index if not exists idx_payments_refunded_by      on public.payments (refunded_by);
create index if not exists idx_reviews_booking_id        on public.reviews (booking_id);

notify pgrst, 'reload schema';
