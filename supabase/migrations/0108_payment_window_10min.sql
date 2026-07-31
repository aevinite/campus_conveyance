-- 0108_payment_window_10min.sql (idempotent — requires 0094, 0103, 0107)
--
-- Shorten the seat-hold PAYMENT WINDOW from 20 minutes to 10 minutes (user
-- decision 2026-07-31): a held seat whose payment isn't completed within 10
-- minutes is released and the rider must request the seat again.
--
-- The 20-minute value is baked into three latest-defining function bodies, so
-- each is recreated verbatim with the window changed to 10 minutes:
--   * reserve_seat        (0103) — the initial PENDING hold.
--   * verify_upi_payment  (0107) — the re-payment window after a rejection.
--   * booking_notify      (0094) — the RESERVED/PROMOTED alert copy.
-- Nothing else in these bodies changes. The expire_stale_holds sweep + the
-- inline sweep inside reserve_seat already reclaim any hold past its expires_at.

-- ---------------------------------------------------------------------------
-- reserve_seat — 0103 body, hold window 20m → 10m.
-- ---------------------------------------------------------------------------
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
        case when v_status = 'PENDING' then now() + interval '10 minutes' end)
    returning * into v_booking;
  exception when unique_violation then
    raise exception 'This rider already has an active booking — one bus at a time. Cancel it from My bookings or wait until it ends.'
      using errcode = 'P0007';
  end;
  return v_booking;
end; $$;
grant execute on function public.reserve_seat(uuid, uuid, uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- verify_upi_payment — 0107 body, reject re-payment window 20m → 10m.
-- ---------------------------------------------------------------------------
create or replace function public.verify_upi_payment(p_booking_id uuid, p_approve boolean, p_note text default null)
returns bookings language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_role text; v_booking bookings; v_route text;
begin
  select role::text into v_role from profiles where id = v_uid;
  if v_role is distinct from 'SUPER_ADMIN' then
    raise exception 'Only an admin can verify payments' using errcode='P0003'; end if;

  select * into v_booking from bookings where id = p_booking_id for update;
  if v_booking.id is null then raise exception 'Booking not found' using errcode='P0002'; end if;
  if v_booking.is_paid then return v_booking; end if;

  if p_approve then
    update payments set status = 'PAID', verified_at = now(), verified_by = v_uid,
           verify_note = nullif(btrim(coalesce(p_note,'')),''), updated_at = now()
     where booking_id = p_booking_id;
    update bookings
       set is_paid = true, paid_at = now(), expires_at = null,
           status = 'CONFIRMED', payment_status = 'PAID'
     where id = p_booking_id returning * into v_booking;
  else
    update payments set status = 'FAILED', verified_at = now(), verified_by = v_uid,
           verify_note = nullif(btrim(coalesce(p_note,'')),''), updated_at = now()
     where booking_id = p_booking_id;
    update bookings
       set payment_status = 'REJECTED', expires_at = now() + interval '10 minutes'
     where id = p_booking_id returning * into v_booking;

    select coalesce(r.name, 'your route') into v_route from routes r where r.id = v_booking.route_id;
    insert into notifications (institution_id, recipient_id, title, body)
    select v_booking.institution_id, pid, 'Payment could not be verified',
           'We could not verify your UPI payment for ' || v_route ||
           '. Please pay again and re-enter the reference to confirm the seat.'
    from (
      select s.profile_id as pid from students s
        where s.id = v_booking.student_id and s.profile_id is not null
      union
      select pa.profile_id from parent_students ps
        join parents pa on pa.id = ps.parent_id
        where ps.student_id = v_booking.student_id and pa.profile_id is not null
    ) t;
  end if;

  return v_booking;
end; $$;
grant execute on function public.verify_upi_payment(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- booking_notify — 0094 body, RESERVED/PROMOTED copy "20 minutes" → "10 minutes".
-- ---------------------------------------------------------------------------
create or replace function public.booking_notify()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_route       text;
  v_who         text;
  v_title       text;
  v_body        text;
  v_kind        text;
  v_url         text;
  v_student_pid uuid;
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
    elsif v_kind = 'WAITLISTED' then
      v_title := 'You''re on the waitlist';
      v_body  := v_route || ' is full right now — you''re on the waitlist and we''ll let you know the moment a seat opens up.';
    elsif v_kind = 'CONFIRMED' then
      v_title := 'Booking confirmed';
      v_body  := 'Your seat on ' || v_route || ' is confirmed. Have a safe ride!';
    elsif v_kind = 'REJECTED' then
      v_title := 'Booking rejected';
      v_body  := 'Your booking for ' || v_route || ' was rejected by the agency. Any payment hold has been released — you can book another route anytime.';
    elsif v_kind = 'PROMOTED' then
      v_title := 'A seat opened up!';
      v_body  := 'Good news — a seat opened on ' || v_route || '. Complete payment within 10 minutes to confirm it before it''s offered to the next person.';
    elsif v_kind = 'EXPIRED' then
      v_title := 'Reservation expired';
      v_body  := 'Your seat hold on ' || v_route || ' expired because payment wasn''t completed in time. The seat has been released — you can book again anytime.';
    elsif v_kind = 'CANCELLED_SELF' then
      v_kind  := 'CANCELLED';
      v_skip_student := true;
      v_title := 'Booking cancelled';
      v_body  := v_who || ' cancelled their booking for ' || v_route || '.';
    else
      v_title := 'Booking cancelled';
      v_body  := 'Your booking for ' || v_route || ' was cancelled and the seat released.';
    end if;

    v_url := '/student/bookings';

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

      insert into notifications (institution_id, recipient_id, title, body)
      values (new.institution_id, v_rec.pid, v_title, v_body);

      if v_rec.email is not null then
        insert into email_outbox (recipient_id, to_email, kind, title, body, booking_id)
        values (v_rec.pid, v_rec.email, v_kind, v_title, v_body, new.id);
      end if;

      insert into push_outbox (recipient_id, kind, title, body, url, booking_id)
      values (v_rec.pid, v_kind, v_title, v_body, v_url, new.id);
    end loop;

  exception when others then
    raise warning 'booking_notify failed for booking %: %', new.id, sqlerrm;
  end;

  return new;
end; $$;

drop trigger if exists trg_booking_notify on public.bookings;
create trigger trg_booking_notify
  after insert or update on public.bookings
  for each row execute function public.booking_notify();
