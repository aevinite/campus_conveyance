-- 0134: audit-5 LOW fixes (rider notices/maps, agency/admin money + lists, campus/auth/misc). Idempotent.

-- ===== L_A_rider =====
-- =============================================================================
-- L_A_rider — audit LOW fixes #1, #5, #6, #7, #8, #10 (rider/notification side).
-- (#3, #9, #11 are UI-only.) Idempotent. Built from the LIVE definitions
-- (pg_get_functiondef, 2026-10-01); everything not called out is byte-identical.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- #1  "Bus arriving" push sent parents to /student/bookings (a page they can't
--     open) -> parents now get /parent/child/<id> (that child's live map).
-- #6  Riders with a cancellation pending (or an ended pass) still got the
--     geofence alert -> gate on booking_is_active_ride(b), like notify_stop_riders.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.check_pickup_geofence(p_lat double precision, p_lng double precision)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  select d.id into v_driver from drivers d where d.profile_id = auth.uid()
     and d.is_active and not coalesce(d.is_deleted, false) limit 1;
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
    join route_stops st0 on st0.id = b.pickup_stop_id
    -- Effective pickup today: the rider's own stop, or â€” if the driver skipped it â€”
    -- the next non-skipped stop they were redirected to. No such stop = no alert.
    join lateral (
      select rs.id, rs.name, rs.lat, rs.lng from route_stops rs
       where rs.route_id = b.route_id and rs.sequence >= st0.sequence
         and not exists (select 1 from route_stop_progress sp
                          where sp.route_id = b.route_id and sp.stop_id = rs.id
                            and sp.service_date = v_today and sp.status = 'SKIPPED')
       order by rs.sequence limit 1
    ) st on true
    -- #6: only an ACTIVE ride (CONFIRMED, no cancellation pending, pass valid).
    where public.booking_is_active_ride(b)
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
      -- #1: parents can't open /student pages -> their child's hub (live map).
      values (v_rec.pid, 'APPROACHING', v_title, v_body,
              case when v_rec.is_parent then '/parent/child/' || r.student_id::text
                   else '/student/bookings' end,
              r.booking_id);
    end loop;

    v_count := v_count + 1;
  end loop;

  return v_count;
exception when others then
  -- Best-effort: never let a geofence failure break the GPS ping.
  raise warning 'check_pickup_geofence failed: %', sqlerrm;
  return v_count;
end; $function$;


-- ---------------------------------------------------------------------------
-- #5  "Bus passed your stop" stayed up all day (incl. the evening trip): the
--     NEXT pointer / last ride event of the morning run were read for the whole
--     service date. Now only the current trip's (last 3h) state counts, so a
--     later trip shows WAITING again.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rider_pickup_progress(p_route_id uuid)
 RETURNS TABLE(booking_id uuid, student_name text, stop_id uuid, stop_name text, lat double precision, lng double precision, stop_sequence integer, state text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- #5: PASSED / DONE / ON_BOARD are scoped to the CURRENT trip. route_stop_progress
  -- and ride_events are keyed only by service date (no trip/leg id), so a trip is
  -- the window of recent activity: the driver's NEXT pointer is re-stamped at each
  -- stop and a rider's stage event is written as it happens; anything older than
  -- 3 hours belongs to an earlier run (e.g. the morning trip seen in the evening).
  -- A driver starting a new run at an earlier stop also resets PASSED at once.
  with today as (select (now() at time zone 'Asia/Kolkata')::date as d,
                        now() - interval '3 hours' as trip_start),
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
       and p.recorded_at > (select trip_start from today)
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
       and re.recorded_at > (select trip_start from today)
     order by re.recorded_at desc limit 1
  ) last_ev on true
  order by st.sequence nulls last;
$function$;


-- ---------------------------------------------------------------------------
-- #7  Re-entering the same UTR showed "already used for another payment".
--     (a) guard_unique_utr: the booking's own payment row is not a duplicate
--         (upsert saw a fresh NEW.id); a UTR reused on the same booking gets an
--         accurate message.
--     (b) submit_upi_payment / submit_pass_renewal: re-sending the UTR that is
--         already awaiting verification is a no-op success (no extra attempt,
--         no admin re-notification, deadline untouched).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.guard_unique_utr()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if NEW.upi_utr is null then return NEW; end if;
  -- #7: submit_upi_payment upserts (INSERT ... ON CONFLICT (booking_id) DO UPDATE).
  -- This BEFORE INSERT trigger sees the PROPOSED row with a fresh id, so re-sending
  -- the SAME UTR for the SAME booking matched that booking's own payment row and
  -- raised the cross-booking "already used" error. A booking has exactly one
  -- payment row, so its own pending row is never a duplicate.
  if TG_TABLE_NAME = 'payments' and NEW.booking_id is not null
     and exists (select 1 from payments p
                  where p.booking_id = NEW.booking_id and p.upi_utr = NEW.upi_utr
                    and p.status = 'CREATED') then
    return NEW;
  end if;
  -- The reference is already on THIS booking (its seat payment or an earlier
  -- renewal): say so plainly instead of blaming "another payment".
  if exists (select 1 from payments p
              where p.upi_utr = NEW.upi_utr and p.status in ('CREATED','PAID','REFUNDED')
                and p.booking_id = NEW.booking_id
                and (TG_TABLE_NAME <> 'payments' or p.id <> NEW.id))
     or exists (select 1 from pass_renewals r
                 where r.upi_utr = NEW.upi_utr and r.status in ('CREATED','PAID','REFUNDED')
                   and r.booking_id = NEW.booking_id
                   and (TG_TABLE_NAME <> 'pass_renewals' or r.id <> NEW.id)) then
    raise exception 'This UPI reference was already submitted for this booking — enter the UTR of the new payment'
      using errcode = 'P0017';
  end if;
  if exists (select 1 from payments p
              where p.upi_utr = NEW.upi_utr and p.status in ('CREATED','PAID','REFUNDED')
                and (TG_TABLE_NAME <> 'payments' or p.id <> NEW.id))
     or exists (select 1 from pass_renewals r
                 where r.upi_utr = NEW.upi_utr and r.status in ('CREATED','PAID','REFUNDED')
                   and (TG_TABLE_NAME <> 'pass_renewals' or r.id <> NEW.id)) then
    raise exception 'This UPI reference was already used for another payment — enter the UTR of this payment'
      using errcode = 'P0017';
  end if;
  return NEW;
end; $function$;

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
  -- #7: this same UTR is already submitted and awaiting verification -> no-op.
  if v_booking.payment_status = 'SUBMITTED'
     and exists (select 1 from payments p
                  where p.booking_id = p_booking_id and p.status = 'CREATED' and p.upi_utr = p_utr) then
    return v_booking;
  end if;

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

CREATE OR REPLACE FUNCTION public.submit_pass_renewal(p_booking_id uuid, p_period billing_period, p_utr text)
 RETURNS pass_renewals
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_b bookings; v_end timestamptz; v_price bigint; v_row pass_renewals; v_ref text;
begin
  select * into v_b from bookings where id = p_booking_id for update;
  if v_b.id is null then raise exception 'Booking not found' using errcode='P0002'; end if;
  if not public.can_act_for_student(v_b.student_id) then
    raise exception 'Not your booking' using errcode='P0003'; end if;
  if v_b.status <> 'CONFIRMED' or not v_b.is_paid or v_b.cancel_requested_at is not null then
    raise exception 'Only an active, paid pass can be renewed' using errcode='P0005'; end if;
  v_end := public.booking_pass_end(v_b);
  if v_end is null or now() < v_end - interval '7 days' or now() > v_end + interval '3 days' then
    raise exception 'Renewal is open in the last 7 days of the pass (and 3 days after it ends)' using errcode='P0017'; end if;
  if coalesce(p_utr,'') !~ '^[0-9]{12}$' then
    raise exception 'Enter the 12-digit UPI reference (UTR) exactly as shown in your UPI app' using errcode='P0015'; end if;
  -- #7: this exact renewal (same plan + UTR) is already awaiting verification -> no-op.
  select * into v_row from pass_renewals pr
   where pr.booking_id = p_booking_id and pr.status = 'CREATED'
     and pr.upi_utr = p_utr and pr.billing_period = p_period
   limit 1;
  if v_row.id is not null then return v_row; end if;
  if (select count(*) from pass_renewals pr where pr.booking_id = p_booking_id and pr.status = 'FAILED'
        and pr.verified_at > now() - interval '7 days') >= 3 then
    raise exception 'Too many failed renewal payments — please contact support' using errcode='P0016'; end if;

  select case p_period when 'MONTHLY' then r.price_monthly_cents
                       when 'SEMESTER' then r.price_semester_cents
                       when 'YEARLY' then r.price_yearly_cents end
    into v_price from routes r where r.id = v_b.route_id;
  if coalesce(v_price, 0) <= 0 then
    raise exception 'This plan isn''t offered on this route' using errcode='P0013'; end if;

  v_ref := 'RN' || upper(left(replace(v_b.id::text, '-', ''), 12));
  -- One pending renewal per booking; re-submitting corrects it in place.
  update pass_renewals set billing_period = p_period, amount_cents = v_price, upi_utr = p_utr,
         submitted_at = now()
   where booking_id = p_booking_id and status = 'CREATED' returning * into v_row;
  if v_row.id is null then
    insert into pass_renewals (booking_id, billing_period, amount_cents, upi_utr, reference)
    values (p_booking_id, p_period, v_price, p_utr, v_ref) returning * into v_row;
  end if;

  insert into notifications (institution_id, recipient_id, title, body)
  select v_b.institution_id, p.id, 'Pass renewal to verify',
         coalesce(v_b.student_name, 'A rider') || ' paid a pass renewal (ref ' || v_ref || ') — verify it in Payments.'
  from profiles p where p.role = 'SUPER_ADMIN' and coalesce(p.is_deleted, false) = false;
  return v_row;
end; $function$;


-- ---------------------------------------------------------------------------
-- #8  Nothing checked that a child's route is at their campus (the booking
--     checklist claimed "Campus eligibility"). reserve_seat now refuses a route
--     whose institution differs from the rider's students.institution_id.
-- ---------------------------------------------------------------------------

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
      when coalesce(v_route.price_semester_cents, 0) > 0 then 'SEMESTER'::billing_period
      when coalesce(v_route.price_yearly_cents, 0)  > 0 then 'YEARLY'::billing_period
      when coalesce(v_route.price_monthly_cents, 0) > 0 then 'MONTHLY'::billing_period
      else null
    end;
  end if;
  -- An unpriced route used to fall through with no plan → a ₹0 pass that never
  -- ends. Direct RPC calls must not book it until the agency sets a price.
  if v_period is null then
    raise exception 'This ride has no price set yet — it can''t be booked right now' using errcode = 'P0013';
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
  -- #8: a rider with a campus on file may only book that campus's routes (the
  -- booking checklist's "Campus eligibility" row reports this P0011).
  if v_student.institution_id is not null
     and v_route.institution_id is distinct from v_student.institution_id then
    raise exception 'This bus serves a different campus than %''s — pick a route at their own campus',
      coalesce(nullif(btrim(v_name), ''), 'the rider')
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


-- ---------------------------------------------------------------------------
-- #10 Payment/refund messages addressed parents as if they were the student.
--     Message-only edits (logic byte-identical): verify_upi_payment's bell,
--     process_refund's bell/email/push (+ #1: parents' push link -> /parent/history),
--     verify_pass_renewal's approved / refund-on-the-way bell.
--     (booking_notify already sends parent copy + /parent links — unchanged.)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.verify_upi_payment(p_booking_id uuid, p_approve boolean, p_note text DEFAULT NULL::text)
 RETURNS bookings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid(); v_role text; v_booking bookings; v_route text;
  v_note text := nullif(btrim(coalesce(p_note,'')),'');
  v_title text; v_body text;
  v_who text; v_ptitle text; v_pbody text; v_student_pid uuid;
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
  v_who := coalesce(nullif(btrim(v_booking.student_name), ''), 'your child');

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
    v_ptitle := 'Payment for ' || v_who || ' received — refund on the way';
    v_pbody := 'We received the UPI payment for ' || v_who || '''s seat on ' || v_route ||
               ', but this booking is no longer active, so we''re refunding it.';
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
      v_ptitle := 'Payment for ' || v_who || ' could not be verified — seat released';
      v_pbody := 'We could not verify the UPI payment for ' || v_who || '''s seat on ' || v_route ||
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
      v_ptitle := 'Payment for ' || v_who || ' could not be verified';
      v_pbody := 'We could not verify the UPI payment for ' || v_who || '''s seat on ' || v_route ||
                 '. Please pay again and re-enter the reference to confirm the seat' ||
                 case when v_booking.utr_attempts = 2 then ' (last attempt).' else '.' end ||
                 coalesce(' Note: ' || v_note, '');
    else
      update bookings set payment_status = 'REJECTED'
       where id = p_booking_id returning * into v_booking;
      return v_booking;
    end if;
  end if;

  -- #10: linked parents (anyone who isn't the rider's own login) get third-person copy.
  select s.profile_id into v_student_pid from students s where s.id = v_booking.student_id;
  insert into notifications (institution_id, recipient_id, title, body)
  select v_booking.institution_id, pid,
         case when pid is distinct from v_student_pid then coalesce(v_ptitle, v_title) else v_title end,
         case when pid is distinct from v_student_pid then coalesce(v_pbody, v_body) else v_body end
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

CREATE OR REPLACE FUNCTION public.process_refund(p_booking_id uuid, p_amount_cents bigint, p_approve boolean, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid(); v_role text; v_booking bookings; v_route text;
  v_amt bigint; v_kind text; v_title text; v_body text; v_note text; v_rec record;
  v_pay payments; v_refundable bigint; v_ren pass_renewals; v_start timestamptz;
  v_renewed boolean := false; v_agency_closed boolean := false;
  v_who text; v_ptitle text; v_pbody text; v_student_pid uuid; v_is_parent boolean;
begin
  select role::text into v_role from profiles where id = v_uid and not coalesce(is_deleted, false);
  if v_role is distinct from 'SUPER_ADMIN' then
    raise exception 'Only an admin can process refunds' using errcode='P0003'; end if;

  select * into v_booking from bookings where id = p_booking_id for update;
  if v_booking.id is null then raise exception 'Booking not found' using errcode='P0002'; end if;
  select * into v_pay from payments
   where booking_id = p_booking_id and refund_status = 'REQUESTED' limit 1;
  if v_pay.id is null then
    raise exception 'No pending refund for this booking' using errcode='P0005'; end if;

  v_note := nullif(btrim(coalesce(p_note, '')), '');
  select coalesce(r.name, 'your route') into v_route from routes r where r.id = v_booking.route_id;

  if p_approve then
    -- #5: never refund (and cancel) a pass nobody asked to cancel.
    if v_booking.status not in ('CANCELLED', 'REJECTED') and v_booking.cancel_requested_at is null then
      raise exception 'This booking is still active and no cancellation was requested — decline this refund request instead'
        using errcode = 'P0006';
    end if;
    if v_pay.status not in ('PAID', 'REFUNDED') then
      raise exception 'This payment has not been verified yet — verify the UTR under "To verify" before refunding'
        using errcode = 'P0006';
    end if;
    v_refundable := (case when v_pay.status = 'PAID' then v_pay.amount_cents else 0 end)
      + (select coalesce(sum(pr.amount_cents), 0) from pass_renewals pr
          where pr.booking_id = p_booking_id and pr.status = 'PAID');
    if v_refundable <= 0 then
      raise exception 'Nothing left to refund on this booking' using errcode = 'P0006'; end if;
    v_amt := least(greatest(coalesce(p_amount_cents, 0), 0), v_refundable);
    update payments set status = 'REFUNDED', refund_status = 'PROCESSED',
        refund_amount_cents = (case when v_pay.status = 'REFUNDED' then coalesce(v_pay.refund_amount_cents, 0) else 0 end) + v_amt,
        refunded_at = now(), refunded_by = v_uid, refund_note = v_note, updated_at = now()
     where id = v_pay.id;
    update pass_renewals set status = 'REFUNDED'
     where booking_id = p_booking_id and status = 'PAID';
    -- NOW finalize the cancellation -> frees the seat + promotes the waitlist (trigger).
    update bookings set status = 'CANCELLED', cancel_cause = coalesce(cancel_cause, 'STUDENT')
     where id = p_booking_id and status not in ('CANCELLED', 'REJECTED');
    v_kind := 'REFUNDED'; v_title := 'Refund processed — booking cancelled';
    v_body := 'A refund of ₹' || (v_amt / 100)::text || ' for ' || v_route ||
              ' has been sent, and your booking is now cancelled.';
    v_who := coalesce(nullif(btrim(v_booking.student_name), ''), 'your child');
    v_ptitle := 'Refund processed — ' || v_who || '''s booking cancelled';
    v_pbody := 'A refund of ₹' || (v_amt / 100)::text || ' for ' || v_who || '''s seat on ' || v_route ||
               ' has been sent, and the booking is now cancelled.';
  else
    update payments set refund_status = 'DECLINED',
        refunded_at = now(), refunded_by = v_uid, refund_note = v_note, updated_at = now()
     where id = v_pay.id;

    if v_booking.status in ('PENDING', 'CONFIRMED')
       and v_booking.cancel_cause = 'AGENCY' and v_booking.cancel_requested_at is not null then
      -- #6: the agency removed this rider (and hid them from its lists). Declining
      -- the refund must NOT revive the seat — finalize the removal instead.
      update bookings set status = 'REJECTED'
       where id = p_booking_id returning * into v_booking;
      v_agency_closed := true;
    elsif v_booking.status in ('PENDING', 'CONFIRMED') then
      -- Rider-initiated cancellation declined -> booking stays active.
      update bookings set cancel_requested_at = null, cancel_cause = null, refund_details = null
       where id = p_booking_id returning * into v_booking;
      -- #7: apply verified renewals that were approved while the cancellation
      -- was pending (they were held for refund and never extended the pass).
      if v_booking.status = 'CONFIRMED' then
        for v_ren in
          select * from pass_renewals
           where booking_id = p_booking_id and status = 'PAID' and period_start is null
           order by submitted_at, created_at
           for update
        loop
          v_start := greatest(public.booking_pass_end(v_booking), now());
          update bookings set billing_period = v_ren.billing_period, pass_start_at = v_start
           where id = p_booking_id returning * into v_booking;
          update pass_renewals
             set period_start = v_start,
                 verify_note = coalesce(nullif(verify_note, '') || ' · ', '') || 'Applied after the refund was declined'
           where id = v_ren.id;
          v_renewed := true;
        end loop;
      end if;
    end if;

    v_kind := 'CANCELLED'; v_title := 'Refund request declined';
    v_body := 'Your refund request for ' || v_route || ' was declined' ||
              case when v_agency_closed
                     then '. The operator removed this booking, so it stays closed.'
                   when v_booking.status in ('PENDING', 'CONFIRMED')
                     then ', so your booking is still active.'
                   else '.' end ||
              case when v_renewed
                     then ' Your renewal has been applied — the pass is valid until ' ||
                          to_char(public.booking_pass_end(v_booking) at time zone 'Asia/Kolkata', 'DD Mon YYYY') || '.'
                   else '' end ||
              coalesce(' Note: ' || v_note, '');
    v_who := coalesce(nullif(btrim(v_booking.student_name), ''), 'your child');
    v_ptitle := 'Refund request for ' || v_who || ' declined';
    v_pbody := 'The refund request for ' || v_who || '''s seat on ' || v_route || ' was declined' ||
              case when v_agency_closed
                     then '. The operator removed this booking, so it stays closed.'
                   when v_booking.status in ('PENDING', 'CONFIRMED')
                     then ', so the booking is still active.'
                   else '.' end ||
              case when v_renewed
                     then ' The renewal has been applied — the pass is valid until ' ||
                          to_char(public.booking_pass_end(v_booking) at time zone 'Asia/Kolkata', 'DD Mon YYYY') || '.'
                   else '' end ||
              coalesce(' Note: ' || v_note, '');
  end if;

  -- Notify the rider + linked parents (bell + email + push), best-effort.
  begin
    select s.profile_id into v_student_pid from students s where s.id = v_booking.student_id;
    for v_rec in
      select s.profile_id as pid, pr.email as email
      from students s left join profiles pr on pr.id = s.profile_id
      where s.id = v_booking.student_id and s.profile_id is not null
      union
      select pa.profile_id, pr.email
      from parent_students ps
      join parents pa on pa.id = ps.parent_id
      left join profiles pr on pr.id = pa.profile_id
      where ps.student_id = v_booking.student_id and pa.profile_id is not null
    loop
      -- #10/#1: a linked parent (not the rider's own login) gets third-person
      -- copy and a /parent link (parents can't open /student pages).
      v_is_parent := v_rec.pid is distinct from v_student_pid;
      insert into notifications (institution_id, recipient_id, title, body)
      values (v_booking.institution_id, v_rec.pid,
              case when v_is_parent then v_ptitle else v_title end,
              case when v_is_parent then v_pbody else v_body end);
      if v_rec.email is not null then
        insert into email_outbox (recipient_id, to_email, kind, title, body, booking_id)
        values (v_rec.pid, v_rec.email, v_kind,
                case when v_is_parent then v_ptitle else v_title end,
                case when v_is_parent then v_pbody else v_body end, p_booking_id);
      end if;
      insert into push_outbox (recipient_id, kind, title, body, url, booking_id)
      values (v_rec.pid, v_kind,
              case when v_is_parent then v_ptitle else v_title end,
              case when v_is_parent then v_pbody else v_body end,
              case when v_is_parent then '/parent/history' else '/student/history' end, p_booking_id);
    end loop;
  exception when others then
    raise warning 'process_refund notify failed for booking %: %', p_booking_id, sqlerrm;
  end;
end; $function$;

CREATE OR REPLACE FUNCTION public.verify_pass_renewal(p_renewal_id uuid, p_approve boolean, p_note text DEFAULT NULL::text)
 RETURNS pass_renewals
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid(); v_role text; v_r pass_renewals; v_b bookings; v_start timestamptz;
  v_route text; v_title text; v_body text; v_note text := nullif(btrim(coalesce(p_note,'')),'');
  v_who text; v_ptitle text; v_pbody text; v_rejected boolean := false;
  v_student_pid uuid; v_is_parent boolean; v_rec record;
begin
  select role::text into v_role from profiles where id = v_uid and not coalesce(is_deleted, false);
  if v_role is distinct from 'SUPER_ADMIN' then
    raise exception 'Only an admin can verify payments' using errcode='P0003'; end if;
  select * into v_r from pass_renewals where id = p_renewal_id for update;
  if v_r.id is null then raise exception 'Renewal not found' using errcode='P0002'; end if;
  if v_r.status <> 'CREATED' then return v_r; end if;
  select * into v_b from bookings where id = v_r.booking_id for update;
  if v_b.id is null then
    raise exception 'The booking for this renewal no longer exists' using errcode='P0002'; end if;
  select coalesce(r.name, 'your route') into v_route from routes r where r.id = v_b.route_id;
  v_route := coalesce(v_route, 'your route');

  if p_approve and (v_b.status <> 'CONFIRMED' or v_b.cancel_requested_at is not null) then
    update pass_renewals set status = 'PAID', verified_at = now(), verified_by = v_uid,
           verify_note = coalesce(v_note, 'Booking no longer active — refunding')
     where id = v_r.id returning * into v_r;
    update payments set refund_status = 'REQUESTED', updated_at = now()
     where booking_id = v_b.id and status in ('PAID', 'REFUNDED') and refund_status <> 'REQUESTED';
    v_title := 'Renewal payment received — refund on the way';
    v_body := 'We received your renewal payment for ' || v_route ||
              ', but this booking is no longer active, so we''re refunding it to you.';
    v_who := coalesce(nullif(btrim(v_b.student_name), ''), 'your child');
    v_ptitle := 'Renewal payment for ' || v_who || ' received — refund on the way';
    v_pbody := 'We received the renewal payment for ' || v_who || '''s pass on ' || v_route ||
               ', but this booking is no longer active, so we''re refunding it.';
  elsif p_approve then
    v_start := greatest(public.booking_pass_end(v_b), now());
    update bookings set billing_period = v_r.billing_period, pass_start_at = v_start
     where id = v_b.id returning * into v_b;
    update pass_renewals set status = 'PAID', verified_at = now(), verified_by = v_uid,
           verify_note = v_note, period_start = v_start
     where id = v_r.id returning * into v_r;
    v_title := 'Bus pass renewed';
    v_body := 'Your pass for ' || v_route || ' is renewed until ' ||
              to_char(public.booking_pass_end(v_b) at time zone 'Asia/Kolkata', 'DD Mon YYYY') || '.';
    v_who := coalesce(nullif(btrim(v_b.student_name), ''), 'your child');
    v_ptitle := 'Bus pass renewed for ' || v_who;
    v_pbody := v_who || '''s pass for ' || v_route || ' is renewed until ' ||
               to_char(public.booking_pass_end(v_b) at time zone 'Asia/Kolkata', 'DD Mon YYYY') || '.';
  else
    update pass_renewals set status = 'FAILED', verified_at = now(), verified_by = v_uid, verify_note = v_note
     where id = v_r.id returning * into v_r;
    v_rejected := true;
    v_who := coalesce(nullif(btrim(v_b.student_name), ''), 'your child');
    v_title := 'Renewal payment could not be verified';
    v_body := 'We could not verify your renewal payment for ' || v_route ||
              '. Please pay again and re-enter the reference.' || coalesce(' Note: ' || v_note, '');
    v_ptitle := 'Renewal payment for ' || v_who || ' could not be verified';
    v_pbody := 'We could not verify the renewal payment for ' || v_who || '''s pass on ' || v_route ||
               '. Please pay again and re-enter the reference.' || coalesce(' Note: ' || v_note, '');
  end if;

  if not v_rejected then
    -- #10: linked parents get third-person copy.
    select s.profile_id into v_student_pid from students s where s.id = v_b.student_id;
    insert into notifications (institution_id, recipient_id, title, body)
    select v_b.institution_id, pid,
           case when pid is distinct from v_student_pid then v_ptitle else v_title end,
           case when pid is distinct from v_student_pid then v_pbody else v_body end
    from (
      select s.profile_id as pid from students s
        where s.id = v_b.student_id and s.profile_id is not null
      union
      select pa.profile_id from parent_students ps
        join parents pa on pa.id = ps.parent_id
        where ps.student_id = v_b.student_id and pa.profile_id is not null
    ) t;
    return v_r;
  end if;

  -- Rejected: bell + email + push, parent-specific copy/links. Best-effort.
  begin
    select s.profile_id into v_student_pid from students s where s.id = v_b.student_id;
    for v_rec in
      select s.profile_id as pid, pr.email as email
      from students s left join profiles pr on pr.id = s.profile_id
      where s.id = v_b.student_id and s.profile_id is not null
      union
      select pa.profile_id, pr.email
      from parent_students ps
      join parents pa on pa.id = ps.parent_id
      left join profiles pr on pr.id = pa.profile_id
      where ps.student_id = v_b.student_id and pa.profile_id is not null
    loop
      v_is_parent := v_rec.pid is distinct from v_student_pid;
      insert into notifications (institution_id, recipient_id, title, body)
      values (v_b.institution_id, v_rec.pid,
              case when v_is_parent then v_ptitle else v_title end,
              case when v_is_parent then v_pbody else v_body end);
      if v_rec.email is not null then
        insert into email_outbox (recipient_id, to_email, kind, title, body, booking_id)
        values (v_rec.pid, v_rec.email, 'RENEWAL_REJECTED',
                case when v_is_parent then v_ptitle else v_title end,
                case when v_is_parent then v_pbody else v_body end, v_b.id);
      end if;
      insert into push_outbox (recipient_id, kind, title, body, url, booking_id)
      values (v_rec.pid, 'RENEWAL_REJECTED',
              case when v_is_parent then v_ptitle else v_title end,
              case when v_is_parent then v_pbody else v_body end,
              case when v_is_parent then '/parent' else '/student/bookings' end, v_b.id);
    end loop;
  exception when others then
    raise warning 'verify_pass_renewal notify failed for renewal %: %', p_renewal_id, sqlerrm;
  end;
  return v_r;
end; $function$;


notify pgrst, 'reload schema';

-- ===== L_B_agency_admin =====
-- ===========================================================================
-- L_B agency/admin (audit LOW #12 #13 #14 #15 #17 #18) — idempotent.
-- Merged by the lead into migration 0134. Requires 0130 + 0133.
-- (#16 #22 #23 are app-only changes.)
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- #12  A student the agency HID (not purged) who books again stayed invisible
--      on every agency list. Same rule as the purge re-book (0120/0130): a
--      hidden row only hides bookings made BEFORE the hide (or purge) time —
--      cutoff = coalesce(purged_at, hidden_at). A NEW booking brings the rider
--      back to Manage Students, and they drop off Deleted Students while that
--      new booking is active (so they're never on both lists).
--      hideStudentAction resets hidden_at=now() on a re-hide, so re-removing
--      the returned rider hides them again.
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
        and b.created_at <= coalesce(h.purged_at, h.hidden_at)
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
        and b.created_at <= coalesce(h.purged_at, h.hidden_at)
    );
$$;

-- Deleted Students: skip a hidden rider who has re-booked (active booking made
-- after the hide) — they are back on Manage Students / View Bookings.
create or replace function public.agency_hidden_students_page(
  p_agency_id uuid, p_limit integer default null, p_offset integer default 0)
returns table(student_id uuid, name text, email text, phone text)
language sql stable security definer set search_path = public as $$
  select s.id, coalesce(pr.full_name, s.full_name), coalesce(pr.email, s.email), coalesce(pr.phone, s.phone)
  from agency_hidden_students h
  join students s on s.id = h.student_id
  left join profiles pr on pr.id = s.profile_id
  where h.agency_id = p_agency_id
    and h.purged_at is null
    and exists (select 1 from agencies a where a.id = p_agency_id and a.owner_profile_id = auth.uid())
    and not exists (
      select 1 from bookings b join routes r on r.id = b.route_id
      where r.agency_id = p_agency_id and b.student_id = h.student_id
        and b.status in ('PENDING', 'CONFIRMED')
        and b.created_at > h.hidden_at
    )
  order by h.hidden_at desc
  limit p_limit offset coalesce(p_offset, 0);
$$;

create or replace function public.agency_hidden_students_count(p_agency_id uuid)
returns bigint language sql stable security definer set search_path = public as $$
  select count(*)
  from agency_hidden_students h
  where h.agency_id = p_agency_id
    and h.purged_at is null
    and exists (select 1 from agencies a where a.id = p_agency_id and a.owner_profile_id = auth.uid())
    and not exists (
      select 1 from bookings b join routes r on r.id = b.route_id
      where r.agency_id = p_agency_id and b.student_id = h.student_id
        and b.status in ('PENDING', 'CONFIRMED')
        and b.created_at > h.hidden_at
    );
$$;

-- `hidden` flag: false once the rider has an active booking made after the hide/purge.
create or replace function public.agency_students(p_agency_id uuid)
returns table(student_id uuid, name text, email text, phone text, hidden boolean)
language sql stable security definer set search_path = public as $$
  select distinct s.id, coalesce(pr.full_name, s.full_name), coalesce(pr.email, s.email), coalesce(pr.phone, s.phone),
         (h.student_id is not null and not exists (
            select 1 from bookings b2 join routes r2 on r2.id = b2.route_id
            where r2.agency_id = p_agency_id and b2.student_id = s.id
              and b2.status in ('PENDING', 'CONFIRMED')
              and b2.created_at > coalesce(h.purged_at, h.hidden_at))) as hidden
  from bookings b
  join routes r on r.id = b.route_id
  join students s on s.id = b.student_id
  left join profiles pr on pr.id = s.profile_id
  left join agency_hidden_students h on h.student_id = s.id and h.agency_id = p_agency_id
  where r.agency_id = p_agency_id
    and exists (select 1 from agencies a where a.id = p_agency_id and a.owner_profile_id = auth.uid());
$$;

grant execute on function public.agency_onboard_bookings(uuid, integer, integer) to authenticated;
grant execute on function public.agency_onboard_count(uuid) to authenticated;
grant execute on function public.agency_hidden_students_page(uuid, integer, integer) to authenticated;
grant execute on function public.agency_hidden_students_count(uuid) to authenticated;
grant execute on function public.agency_students(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- #13 + #12  agency_report:
--   * revenue = verified money (fare + verified renewals) MINUS the refunded
--     amount, per booking — a PARTIAL refund no longer wipes the whole payment
--     out of revenue; a refund is booked (negative) on its refund date.
--   * money kept on a cancelled/rejected booking whose refund was declined (or
--     never requested) now counts; money with a refund still REQUESTED (or a
--     cancellation awaiting refund) stays out until the admin decides (0130).
--   * legacy is_paid bookings with no payment row keep the old fare fallback
--     (CONFIRMED or pass-ended only).
--   * revenue-by-route 'bookings' = bookings with net money > 0.
--   * active students use the #12 hide cutoff.
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
           coalesce(case b.billing_period
                      when 'MONTHLY'  then r.price_monthly_cents
                      when 'SEMESTER' then r.price_semester_cents
                      when 'YEARLY'   then r.price_yearly_cents end,
                    r.price_cents) as expected_cents
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
  -- One verified payment per booking (PAID, or REFUNDED = verified then refunded).
  pay as (
    select bk.*, p.status as pstatus, coalesce(p.amount_cents, bk.expected_cents) as fare_cents,
           coalesce(p.refund_status, 'NONE') as refund_status,
           coalesce(p.refund_amount_cents, 0) as refund_cents, p.refunded_at, p.verified_at
    from bk
    left join lateral (
      select * from payments p
       where p.booking_id = bk.id and p.status in ('PAID', 'REFUNDED')
       order by p.created_at desc limit 1) p on true
  ),
  counted as (
    -- Refund still pending (or cancellation awaiting a refund) -> not earned yet.
    select pay.*,
           coalesce((select sum(pr.amount_cents) from pass_renewals pr
                      where pr.booking_id = pay.id and pr.status in ('PAID', 'REFUNDED')), 0) as renewal_cents
    from pay
    where not cancelling and refund_status <> 'REQUESTED'
      and (pstatus is not null
           or (is_paid and (status = 'CONFIRMED' or (status = 'CANCELLED' and cancel_cause = 'PASS_ENDED'))))
  ),
  earned as (
    -- First payment, dated by paid_at.
    select id, route_id, route_name, fare_cents amount, coalesce(paid_at, verified_at) at_ts from counted
    union all
    -- Each verified renewal, dated by its own verification.
    select c.id, c.route_id, c.route_name, pr.amount_cents, pr.verified_at
      from pass_renewals pr join counted c on c.id = pr.booking_id
     where pr.status in ('PAID', 'REFUNDED')
    union all
    -- Refunded money, negative on the refund date (capped at what was paid).
    select id, route_id, route_name, -least(refund_cents, fare_cents + renewal_cents), refunded_at
      from counted where refund_cents > 0
  ),
  rev as (
    select coalesce(sum(amount),0) total_cents,
           coalesce(sum(amount) filter (where (at_ts at time zone 'Asia/Kolkata') >= date_trunc('day',   now() at time zone 'Asia/Kolkata')),0) today_cents,
           coalesce(sum(amount) filter (where (at_ts at time zone 'Asia/Kolkata') >= date_trunc('month', now() at time zone 'Asia/Kolkata')),0) month_cents
    from earned
  ),
  by_booking as (
    select id, route_id, min(route_name) route_name, sum(amount) net from earned group by id, route_id
  ),
  rev_by_route as (
    select route_id, min(route_name) name, count(*) filter (where net > 0) bookings,
           coalesce(sum(net),0) revenue_cents
    from by_booking
    group by route_id order by revenue_cents desc
  ),
  active_students as (
    select count(distinct b.student_id) c from bk b
    where b.status='CONFIRMED' and not b.cancelling and b.student_id is not null
      and not exists (select 1 from agency_hidden_students h
                      where h.agency_id = p_agency_id and h.student_id = b.student_id
                        and b.created_at <= coalesce(h.purged_at, h.hidden_at))
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
-- #13  Agency "Completed payments": a PARTIALLY refunded payment stays listed
--      (with the refunded amount); only a FULL refund drops it. Renewals of a
--      partially refunded booking stay too. New columns -> drop + recreate.
-- ---------------------------------------------------------------------------
drop function if exists public.agency_completed_payments(uuid, integer, integer);
create function public.agency_completed_payments(
  p_agency_id uuid, p_limit integer default null, p_offset integer default 0)
returns table(booking_id uuid, student_name text, student_email text, route_name text,
  amount_cents bigint, upi_utr text, reference text, submitted_at timestamptz,
  verified_at timestamptz, kind text, refund_status text, refund_amount_cents bigint)
language sql stable security definer set search_path = public as $$
  with tot as (
    -- per booking: verified money and refunded money (refund capped at paid)
    select p.booking_id,
           coalesce(p.amount_cents, 0)
             + coalesce((select sum(pr.amount_cents) from pass_renewals pr
                          where pr.booking_id = p.booking_id and pr.status in ('PAID','REFUNDED')), 0) as paid_cents,
           coalesce(p.refund_amount_cents, 0) as refund_cents
    from payments p
    join bookings b on b.id = p.booking_id
    join routes r on r.id = b.route_id
    where r.agency_id = p_agency_id and p.status in ('PAID', 'REFUNDED')
  )
  select x.booking_id, x.student_name, x.student_email, x.route_name, x.amount_cents,
         x.upi_utr, x.reference, x.submitted_at, x.verified_at, x.kind, x.refund_status, x.refund_amount_cents
  from (
    select b.id, b.student_name, b.student_email, r.name,
           p.amount_cents, p.upi_utr, p.reference, p.submitted_at, p.verified_at,
           'FARE'::text, p.refund_status,
           case when coalesce(t.refund_cents, 0) > 0 then least(t.refund_cents, t.paid_cents) end,
           coalesce(p.verified_at, p.submitted_at, p.created_at) as sort_at
    from payments p
    join bookings b on b.id = p.booking_id
    join routes r on r.id = b.route_id
    left join tot t on t.booking_id = p.booking_id
    where r.agency_id = p_agency_id
      and (p.status = 'PAID'
           or (p.status = 'REFUNDED' and coalesce(t.refund_cents, 0) < coalesce(t.paid_cents, 0)))
    union all
    select b.id, b.student_name, b.student_email, r.name,
           pr.amount_cents, pr.upi_utr, pr.reference, pr.submitted_at, pr.verified_at,
           'RENEWAL'::text, null::text, null::bigint,
           coalesce(pr.verified_at, pr.submitted_at)
    from pass_renewals pr
    join bookings b on b.id = pr.booking_id
    join routes r on r.id = b.route_id
    left join tot t on t.booking_id = pr.booking_id
    where r.agency_id = p_agency_id
      and (pr.status = 'PAID'
           or (pr.status = 'REFUNDED' and coalesce(t.refund_cents, 0) < coalesce(t.paid_cents, 0)))
  ) x (booking_id, student_name, student_email, route_name, amount_cents, upi_utr, reference,
       submitted_at, verified_at, kind, refund_status, refund_amount_cents, sort_at)
  where exists (select 1 from agencies a where a.id = p_agency_id and a.owner_profile_id = auth.uid())
  order by x.sort_at desc
  limit p_limit offset coalesce(p_offset, 0);
$$;
revoke execute on function public.agency_completed_payments(uuid, integer, integer) from public, anon;
grant execute on function public.agency_completed_payments(uuid, integer, integer) to authenticated, service_role;

create or replace function public.agency_completed_payments_count(p_agency_id uuid)
returns bigint language sql stable security definer set search_path = public as $$
  with tot as (
    select p.booking_id,
           coalesce(p.amount_cents, 0)
             + coalesce((select sum(pr.amount_cents) from pass_renewals pr
                          where pr.booking_id = p.booking_id and pr.status in ('PAID','REFUNDED')), 0) as paid_cents,
           coalesce(p.refund_amount_cents, 0) as refund_cents
    from payments p
    join bookings b on b.id = p.booking_id
    join routes r on r.id = b.route_id
    where r.agency_id = p_agency_id and p.status in ('PAID', 'REFUNDED')
  )
  select case when exists (select 1 from agencies a where a.id = p_agency_id and a.owner_profile_id = auth.uid())
    then (select count(*) from payments p join bookings b on b.id = p.booking_id
            join routes r on r.id = b.route_id
            left join tot t on t.booking_id = p.booking_id
           where r.agency_id = p_agency_id
             and (p.status = 'PAID'
                  or (p.status = 'REFUNDED' and coalesce(t.refund_cents, 0) < coalesce(t.paid_cents, 0))))
       + (select count(*) from pass_renewals pr join bookings b on b.id = pr.booking_id
            join routes r on r.id = b.route_id
            left join tot t on t.booking_id = pr.booking_id
           where r.agency_id = p_agency_id
             and (pr.status = 'PAID'
                  or (pr.status = 'REFUNDED' and coalesce(t.refund_cents, 0) < coalesce(t.paid_cents, 0))))
    else 0 end;
$$;
grant execute on function public.agency_completed_payments_count(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- #14  Agency refunds page:
--   * amount_cents = what the rider actually paid on the booking (fare +
--     verified renewals) — a refund that included renewals no longer looks
--     larger than "the payment";
--   * refund_amount_cents capped at that paid total;
--   * requested_at falls back to bookings.updated_at only while the refund is
--     still REQUESTED; a declined rider cancellation clears cancel_requested_at
--     and bumps updated_at, so decided rows now use refunded_at (= decision
--     date, also set on DECLINE by process_refund) — the UI shows that date.
--   Same return type -> create or replace.
-- ---------------------------------------------------------------------------
create or replace function public.agency_refunds(
  p_agency_id uuid, p_limit integer default null, p_offset integer default 0)
returns table(booking_id uuid, student_name text, student_email text, route_name text,
  amount_cents bigint, refund_status text, refund_amount_cents bigint, refund_details jsonb,
  cancel_reason text, requested_at timestamptz, refunded_at timestamptz)
language sql stable security definer set search_path = public as $$
  select b.id, b.student_name, b.student_email, r.name,
         t.paid_cents, p.refund_status,
         case when p.refund_amount_cents is not null then least(p.refund_amount_cents, t.paid_cents) end,
         b.refund_details, b.cancel_reason,
         coalesce(b.cancel_requested_at,
                  case when p.refund_status = 'REQUESTED' then b.updated_at end,
                  p.refunded_at),
         p.refunded_at
  from payments p
  join bookings b on b.id = p.booking_id
  join routes r on r.id = b.route_id
  cross join lateral (
    select coalesce(p.amount_cents, 0)
           + coalesce((select sum(pr.amount_cents) from pass_renewals pr
                        where pr.booking_id = p.booking_id and pr.status in ('PAID', 'REFUNDED')), 0) as paid_cents
  ) t
  where r.agency_id = p_agency_id
    and p.refund_status in ('REQUESTED', 'PROCESSED', 'DECLINED')
    and exists (select 1 from agencies a where a.id = p_agency_id and a.owner_profile_id = auth.uid())
  -- Still-pending refunds first, then most recent.
  order by (p.refund_status = 'REQUESTED') desc, p.updated_at desc
  limit p_limit offset coalesce(p_offset, 0);
$$;
grant execute on function public.agency_refunds(uuid, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- #15  Vehicle type must match the approved service. An agency approved only
--      for VANs at a campus could add a BUS route there (add_route picked any
--      service at that campus, BUS-first).
--   * add_route: the service area must be for the vehicle's own type.
--   * routes_guard_tenancy: for agency routes, the campus must be served for
--     the route's vehicle type, and a linked service area must be of that type.
--     Fires also on vehicle_type changes (trigger column list widened).
--   Live data: 3 agency routes, all BUS on BUS services -> 0 violations.
-- ---------------------------------------------------------------------------
create or replace function public.add_route(p_agency_id uuid, p_agency_service_id uuid, p_institution_id uuid,
  p_vehicle_id uuid, p_start_location text, p_price_monthly_cents bigint, p_price_semester_cents bigint,
  p_price_yearly_cents bigint, p_departure_time time without time zone, p_image_url text,
  p_stops jsonb default '[]'::jsonb)
returns routes language plpgsql security definer set search_path = public as $function$
declare v_route routes; v_cap int; v_ra uuid; v_vtype vehicle_type; v_primary bigint; v_svc uuid;
begin
  if not exists (select 1 from agencies where id=p_agency_id and owner_profile_id=auth.uid() and status='APPROVED') then
    raise exception 'Agency not approved' using errcode='P0003'; end if;
  select capacity, vehicle_type into v_cap, v_vtype from vehicles where id=p_vehicle_id and agency_id=p_agency_id;
  if v_cap is null then raise exception 'Bus not found' using errcode='P0002'; end if;
  if exists (select 1 from routes where vehicle_id = p_vehicle_id and is_active) then
    raise exception 'This bus already runs another route — pick a different bus' using errcode='P0005'; end if;

  -- The agency must have an APPROVED service area at this campus FOR THIS
  -- VEHICLE TYPE (created only by the campus → admin review). A supplied
  -- service id must be that same area.
  select s.id into v_svc from agency_services s
   where s.agency_id = p_agency_id and s.institution_id = p_institution_id
     and s.vehicle_type = v_vtype
     and (p_agency_service_id is null or s.id = p_agency_service_id)
   limit 1;
  if v_svc is null then
    if exists (select 1 from agency_services s
                where s.agency_id = p_agency_id and s.institution_id = p_institution_id) then
      raise exception 'You are not approved to run % routes at this campus — request a % service area first',
        lower(v_vtype::text), lower(v_vtype::text) using errcode='P0003';
    end if;
    raise exception 'You don''t serve this campus yet — request it under Service areas first' using errcode='P0003';
  end if;

  if coalesce(p_price_monthly_cents,0) <= 0
     and coalesce(p_price_semester_cents,0) <= 0
     and coalesce(p_price_yearly_cents,0) <= 0 then
    raise exception 'Set a price for at least one plan (monthly, semester or yearly)' using errcode='P0014';
  end if;
  v_primary := coalesce(nullif(p_price_semester_cents,0), nullif(p_price_yearly_cents,0), nullif(p_price_monthly_cents,0));

  insert into routes (institution_id, agency_id, agency_service_id, vehicle_id, vehicle_type,
    name, start_location, price_cents, price_monthly_cents, price_semester_cents, price_yearly_cents,
    departure_time, image_url, is_active)
  values (p_institution_id, p_agency_id, v_svc, p_vehicle_id, v_vtype,
    coalesce(nullif(p_start_location,''),'Route'), p_start_location, v_primary,
    nullif(p_price_monthly_cents,0), nullif(p_price_semester_cents,0), nullif(p_price_yearly_cents,0),
    p_departure_time, p_image_url, true)
  returning * into v_route;

  insert into route_assignments (institution_id, route_id, vehicle_id)
  values (p_institution_id, v_route.id, p_vehicle_id) returning id into v_ra;
  insert into seat_allocations (institution_id, route_assignment_id, total_seats, reserved_seats)
  values (p_institution_id, v_ra, v_cap, 0);

  insert into route_stops (institution_id, route_id, name, sequence, lat, lng, address, description)
  select p_institution_id, v_route.id,
         coalesce(nullif(elem->>'name',''), 'Stop ' || ord::text),
         ord::int,
         (elem->>'lat')::double precision,
         (elem->>'lng')::double precision,
         nullif(elem->>'address',''),
         nullif(elem->>'description','')
  from jsonb_array_elements(coalesce(p_stops, '[]'::jsonb)) with ordinality as t(elem, ord)
  where (elem->>'lat') is not null and (elem->>'lng') is not null;

  return v_route;
end; $function$;
revoke execute on function public.add_route(uuid, uuid, uuid, uuid, text, bigint, bigint, bigint, time without time zone, text, jsonb) from public, anon;
grant execute on function public.add_route(uuid, uuid, uuid, uuid, text, bigint, bigint, bigint, time without time zone, text, jsonb) to authenticated, service_role;

create or replace function public.routes_guard_tenancy()
returns trigger language plpgsql security definer set search_path = public as $function$
declare v_vt vehicle_type;
begin
  if new.agency_id is null then return new; end if;  -- legacy campus-owned routes

  if new.institution_id is not null
     and (tg_op = 'INSERT' or new.institution_id is distinct from old.institution_id
          or new.agency_id is distinct from old.agency_id)
     and not exists (select 1 from agency_services s
                      where s.agency_id = new.agency_id and s.institution_id = new.institution_id) then
    raise exception 'This agency is not approved to serve that campus' using errcode = 'P0003';
  end if;

  if new.vehicle_id is not null
     and (tg_op = 'INSERT' or new.vehicle_id is distinct from old.vehicle_id
          or new.agency_id is distinct from old.agency_id)
     and not exists (select 1 from vehicles v where v.id = new.vehicle_id and v.agency_id = new.agency_id) then
    raise exception 'That bus belongs to another agency' using errcode = 'P0003';
  end if;

  if new.agency_service_id is not null
     and (tg_op = 'INSERT' or new.agency_service_id is distinct from old.agency_service_id
          or new.agency_id is distinct from old.agency_id)
     and not exists (select 1 from agency_services s
                      where s.id = new.agency_service_id and s.agency_id = new.agency_id) then
    raise exception 'That service area belongs to another agency' using errcode = 'P0003';
  end if;

  -- #15: the vehicle type must match an approved service at this campus (and
  -- the linked service area itself).
  if new.institution_id is not null
     and (tg_op = 'INSERT'
          or new.institution_id is distinct from old.institution_id
          or new.agency_id is distinct from old.agency_id
          or new.vehicle_id is distinct from old.vehicle_id
          or new.vehicle_type is distinct from old.vehicle_type
          or new.agency_service_id is distinct from old.agency_service_id) then
    v_vt := coalesce((select v.vehicle_type from vehicles v where v.id = new.vehicle_id), new.vehicle_type);
    if v_vt is not null then
      if not exists (select 1 from agency_services s
                      where s.agency_id = new.agency_id and s.institution_id = new.institution_id
                        and s.vehicle_type = v_vt) then
        raise exception 'This agency is not approved to run % routes at that campus', lower(v_vt::text)
          using errcode = 'P0003';
      end if;
      if new.agency_service_id is not null
         and not exists (select 1 from agency_services s
                          where s.id = new.agency_service_id and s.vehicle_type = v_vt) then
        raise exception 'That service area is for a different vehicle type' using errcode = 'P0003';
      end if;
    end if;
  end if;
  return new;
end; $function$;
revoke execute on function public.routes_guard_tenancy() from public, anon, authenticated;

drop trigger if exists trg_routes_guard_tenancy on public.routes;
create trigger trg_routes_guard_tenancy
  before insert or update of agency_id, institution_id, vehicle_id, agency_service_id, vehicle_type
  on public.routes for each row execute function public.routes_guard_tenancy();

-- ---------------------------------------------------------------------------
-- #17  Admin revenue: all verified money (fares PAID/REFUNDED + renewals
--      PAID/REFUNDED, any booking status — incl. money kept on cancelled /
--      rejected bookings) minus refunded amounts. Exposed as new keys
--      payments.revenueCents / grossCents / refundedCents; the existing
--      paid/unpaid counts (active bookings) are unchanged. service_role only.
-- ---------------------------------------------------------------------------
create or replace function public.admin_report()
returns jsonb language sql stable security definer set search_path = public as $function$
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
  bk as (
    select b.id, b.is_paid,
           coalesce(case b.billing_period
                      when 'MONTHLY'  then r.price_monthly_cents
                      when 'SEMESTER' then r.price_semester_cents
                      when 'YEARLY'   then r.price_yearly_cents end,
                    r.price_cents) as expected_cents,
           (select p.amount_cents from payments p
             where p.booking_id = b.id and p.status in ('PAID', 'REFUNDED') limit 1) as paid_cents,
           (select coalesce(sum(pr.amount_cents),0) from pass_renewals pr
             where pr.booking_id = b.id and pr.status = 'PAID') as renewal_cents
    from bookings b join routes r on r.id = b.route_id
    where b.status in ('PENDING','CONFIRMED')
  ),
  fees as (
    select count(*) filter (where is_paid)     as paid_count,
           count(*) filter (where not is_paid) as unpaid_count,
           coalesce(sum(coalesce(paid_cents, expected_cents) + renewal_cents) filter (where is_paid),0) as paid_cents,
           coalesce(sum(expected_cents) filter (where not is_paid),0) as unpaid_cents
    from bk
  ),
  -- Platform money, regardless of booking status (bookings may even be gone —
  -- payments keep their snapshot since 0133).
  money as (
    select
      (select coalesce(sum(p.amount_cents), 0) from payments p where p.status in ('PAID', 'REFUNDED'))
      + (select coalesce(sum(pr.amount_cents), 0) from pass_renewals pr where pr.status in ('PAID', 'REFUNDED'))
        as gross_cents,
      (select coalesce(sum(p.refund_amount_cents), 0) from payments p
        where p.status in ('PAID', 'REFUNDED') and p.refund_amount_cents > 0) as refunded_cents
  )
  select jsonb_build_object(
    'providers', coalesce((select jsonb_agg(jsonb_build_object(
       'agencyId', id, 'name', name, 'buses', buses, 'vans', vans, 'students', students)) from rows), '[]'::jsonb),
    'totals', (select jsonb_build_object(
       'buses', coalesce(sum(buses),0), 'vans', coalesce(sum(vans),0), 'students', coalesce(sum(students),0)) from rows),
    'payments', (select jsonb_build_object(
       'paidCount', paid_count, 'unpaidCount', unpaid_count, 'paidCents', paid_cents, 'unpaidCents', unpaid_cents,
       'grossCents', (select gross_cents from money),
       'refundedCents', (select least(refunded_cents, gross_cents) from money),
       'revenueCents', (select greatest(gross_cents - refunded_cents, 0) from money)) from fees)
  );
$function$;
revoke execute on function public.admin_report() from public, anon, authenticated;
grant execute on function public.admin_report() to service_role;

-- ---------------------------------------------------------------------------
-- #18  Admin payment history: fares AND pass renewals, with the refund outcome
--      (amount + REQUESTED/PROCESSED/DECLINED + decision date). service_role
--      only (read by the SUPER_ADMIN-gated /aevinite page via the admin client).
-- ---------------------------------------------------------------------------
create or replace function public.admin_payment_history(p_limit integer default null, p_offset integer default 0)
returns table(kind text, booking_id uuid, rider_name text, rider_email text, route_name text,
  amount_cents bigint, upi_utr text, reference text, method text, status text,
  refund_status text, refund_amount_cents bigint, refunded_at timestamptz, refund_note text,
  submitted_at timestamptz, verified_at timestamptz, verify_note text)
language sql stable security definer set search_path = public as $function$
  select x.kind, x.booking_id, x.rider_name, x.rider_email, x.route_name, x.amount_cents,
         x.upi_utr, x.reference, x.method, x.status, x.refund_status, x.refund_amount_cents,
         x.refunded_at, x.refund_note, x.submitted_at, x.verified_at, x.verify_note
  from (
    select 'FARE'::text as kind, p.booking_id,
           coalesce(b.student_name, p.rider_name) as rider_name,
           coalesce(b.student_email, p.rider_email) as rider_email,
           coalesce(r.name, p.route_name, '—') as route_name,
           p.amount_cents, p.upi_utr, p.reference, p.method, p.status::text as status,
           nullif(p.refund_status, 'NONE') as refund_status,
           p.refund_amount_cents,
           case when p.refund_status in ('PROCESSED', 'DECLINED') or p.refund_amount_cents > 0
                then p.refunded_at end as refunded_at,
           p.refund_note,
           p.submitted_at, p.verified_at, p.verify_note,
           coalesce(p.verified_at, p.submitted_at, p.created_at) as sort_at
    from payments p
    left join bookings b on b.id = p.booking_id
    left join routes r on r.id = b.route_id
    where p.status in ('PAID', 'FAILED', 'REFUNDED')
    union all
    select 'RENEWAL', pr.booking_id,
           coalesce(b.student_name, pr.rider_name),
           b.student_email,
           coalesce(r.name, pr.route_name, '—'),
           pr.amount_cents, pr.upi_utr, pr.reference, 'UPI', pr.status,
           null, null, null, null,
           pr.submitted_at, pr.verified_at, pr.verify_note,
           coalesce(pr.verified_at, pr.submitted_at, pr.created_at)
    from pass_renewals pr
    left join bookings b on b.id = pr.booking_id
    left join routes r on r.id = b.route_id
    where pr.status in ('PAID', 'FAILED', 'REFUNDED')
  ) x
  order by x.sort_at desc nulls last
  limit p_limit offset coalesce(p_offset, 0);
$function$;

create or replace function public.admin_payment_history_count()
returns bigint language sql stable security definer set search_path = public as $function$
  select (select count(*) from payments where status in ('PAID', 'FAILED', 'REFUNDED'))
       + (select count(*) from pass_renewals where status in ('PAID', 'FAILED', 'REFUNDED'));
$function$;

revoke execute on function public.admin_payment_history(integer, integer) from public, anon, authenticated;
revoke execute on function public.admin_payment_history_count() from public, anon, authenticated;
grant execute on function public.admin_payment_history(integer, integer) to service_role;
grant execute on function public.admin_payment_history_count() to service_role;

notify pgrst, 'reload schema';

-- ===== L_C_misc =====
-- L_C_misc.sql — audit LOW fixes (agent C). Idempotent; lead merges into 0134.
-- Covers: #2 (drop dead set_bus_driver_today), #20 (disabled campus admin
-- loses DB-level campus access), #21 (purged students never appear as a
-- parent's managed child). Other C items (#4, #19, #24–#29, #31) are app-side.

-- ---------------------------------------------------------------------------
-- #2 set_bus_driver_today: legacy agency RPC, failed on every call (its
--     ON CONFLICT (vehicle_id, effective_date) no longer matches
--     bus_driver_changes' unique key after the role column/0133 tenancy
--     triggers). No callers: the app uses set_bus_driver_today_by_driver
--     (src/features/agency/actions.ts), no other function references it, and no
--     pg_cron job calls it. Drop it.
-- ---------------------------------------------------------------------------
drop function if exists public.set_bus_driver_today(uuid, text, text, text, text);

-- ---------------------------------------------------------------------------
-- #20 jwt_institution(): the campus a signed-in INSTITUTION_ADMIN may see via
--     RLS (audit_logs/bookings/drivers/notifications/parents/payments/
--     route_assignments/route_stops/routes/seat_allocations/students/vehicles
--     *_tenant_read, profiles_self, inst_select) and RPCs (bus_live_location,
--     ride_pass). It now also requires the campus to be ACTIVE and NOT DELETED,
--     so a disabled/removed campus's admin can't read campus data directly
--     (bypassing the /institution page guard). The server actions apply the
--     same check app-side (resolveActiveInstitutionId).
-- ---------------------------------------------------------------------------
create or replace function public.jwt_institution()
 returns uuid
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select p.institution_id
    from public.profiles p
    join public.institutions i on i.id = p.institution_id
   where p.id = auth.uid()
     and not coalesce(p.is_deleted, false)
     and p.role = 'INSTITUTION_ADMIN'
     and i.is_active
     and not coalesce(i.is_deleted, false);
$function$;

-- ---------------------------------------------------------------------------
-- #21 Purged students vs parent-managed children. A "managed" child is a
--     students row with profile_id NULL — but permanently deleting a student's
--     auth user also NULLs students.profile_id (FK on delete set null), so a
--     purged student looked exactly like a managed child. Mark purges explicitly
--     and exclude purged / soft-deleted students from the parent child list and
--     from can_act_for_student.
-- ---------------------------------------------------------------------------
alter table public.students add column if not exists purged_at timestamptz;

create or replace function public.students_mark_purged()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if old.profile_id is not null and new.profile_id is null then
    -- The login behind this student was deleted (auth user purge).
    new.purged_at := coalesce(new.purged_at, now());
  elsif current_user in ('authenticated', 'anon') then
    -- purged_at is system-managed: clients can neither set nor clear it.
    new.purged_at := old.purged_at;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_students_mark_purged on public.students;
create trigger trg_students_mark_purged
  before update on public.students
  for each row execute function public.students_mark_purged();

-- Data fix: the one live orphan (students a7a9d10e-d492-4263-b685-ed75e426eff1,
-- created 2026-07-16 — before managed children existed in 0103 — no name/email,
-- no profile, no bookings/parent links/codes/reviews) is a purged login student,
-- not a managed child. Mark it (and any other such shell) as purged. Managed
-- children always carry full_name (create_managed_student requires it).
update public.students s
   set purged_at = coalesce(s.updated_at, now())
 where s.profile_id is null
   and s.purged_at is null
   and s.full_name is null;

create or replace function public.parent_children()
 returns table(student_id uuid, full_name text, email text, phone text, grade text, address text, institution_id uuid, institution_name text, managed boolean, active_booking_id uuid, active_status text, active_route_id uuid, active_route_name text, active_payment_status text, active_cancel_requested_at timestamp with time zone)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select s.id,
         coalesce(pr.full_name, s.full_name),
         coalesce(pr.email, s.email),
         coalesce(pr.phone, s.phone),
         s.grade, s.address,
         -- A login-backed student picks a campus per booking (students.institution_id
         -- stays NULL) — fall back to the campus of their most recent booking.
         coalesce(s.institution_id, lb.institution_id), i.name,
         (s.profile_id is null) as managed,
         ab.id, ab.status::text, ab.route_id, r.name,
         ab.payment_status, ab.cancel_requested_at
  from parent_students ps
  join parents pa on pa.id = ps.parent_id and pa.profile_id = auth.uid()
  join students s on s.id = ps.student_id
  left join lateral (
    select rr.institution_id from bookings b join routes rr on rr.id = b.route_id
    where b.student_id = s.id
    order by b.created_at desc limit 1
  ) lb on s.institution_id is null
  left join institutions i on i.id = coalesce(s.institution_id, lb.institution_id)
  left join lateral (
    select b.id, b.status, b.route_id, b.payment_status, b.cancel_requested_at
    from bookings b
    where b.student_id = s.id and b.status in ('PENDING','CONFIRMED','WAITLISTED')
    order by b.created_at desc limit 1
  ) ab on true
  left join routes r on r.id = ab.route_id
  left join profiles pr on pr.id = s.profile_id
  -- #21: never list a purged student (login deleted) or a soft-deleted one.
  where s.purged_at is null
    and not coalesce(pr.is_deleted, false)
  order by coalesce(pr.full_name, s.full_name) nulls last;
$function$;

create or replace function public.can_act_for_student(p_student_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from students s
     where s.id = p_student_id and s.profile_id = auth.uid()
  ) or exists (
    select 1 from parent_students ps
    join parents pa on pa.id = ps.parent_id
    join students s on s.id = ps.student_id
    where ps.student_id = p_student_id and pa.profile_id = auth.uid()
      and s.purged_at is null  -- #21: a purged student can't be acted for
  );
$function$;

notify pgrst, 'reload schema';

insert into public.schema_migrations_applied (version, name) values ('0134', '0134_audit5_lows') on conflict do nothing;
notify pgrst, 'reload schema';
