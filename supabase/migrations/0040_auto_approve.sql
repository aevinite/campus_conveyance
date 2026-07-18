-- 0040_auto_approve.sql (idempotent — requires 0032/0038/0039)
-- Auto-approval: the agency no longer has to click "Approve". When a student
-- reserves, reserve_seat validates the request and AUTO-APPROVES it in the same
-- transaction (stamping approved_at + a 20-minute payment window). Approval is
-- gated on three checks — the request is only approved when ALL pass:
--   1. Seat availability — a free seat on the route (else WAITLISTED, not approved)
--   2. Pickup point      — the chosen stop actually belongs to this route
--   3. Eligibility       — the route is active and its campus is live (not delisted)
-- Waitlist promotion (0039) likewise auto-approves the promoted booking so the
-- student gets the same payment window without any manual step.
-- The agency's manual confirm_booking (0032) is kept as a fallback but is no
-- longer part of the normal flow.

-- reserve_seat v8 = 0038 (zero-capacity guard) + pickup/eligibility checks +
-- auto-approval on the held (PENDING) seat.
create or replace function public.reserve_seat(
  p_route_id uuid, p_pickup_stop_id uuid, p_drop_stop_id uuid
) returns bookings language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_route routes; v_student students; v_alloc seat_allocations;
  v_count int; v_booking bookings; v_status booking_status;
  v_name text; v_phone text; v_email text; v_has_stops boolean;
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception 'Not authenticated' using errcode='P0001'; end if;
  select * into v_route from routes where id = p_route_id;
  if v_route.id is null then raise exception 'Route not found' using errcode='P0002'; end if;

  -- Details gate (name/phone/address must be filled first).
  select full_name, phone, email into v_name, v_phone, v_email
    from profiles where id = v_uid;
  select * into v_student from students where profile_id = v_uid limit 1;
  if v_student.id is null
     or coalesce(trim(v_name), '') = ''
     or coalesce(trim(v_phone), '') = ''
     or coalesce(trim(v_student.address), '') = '' then
    raise exception 'Please fill in your details (name, phone and address) before reserving a seat'
      using errcode = 'P0006';
  end if;

  perform public.expire_stale_holds();

  -- One active booking per student per route.
  if exists (select 1 from bookings
              where student_id = v_student.id and route_id = p_route_id
                and status in ('PENDING','CONFIRMED','WAITLISTED')) then
    raise exception 'You already have an active booking on this route — see My bookings'
      using errcode = 'P0007';
  end if;

  -- CHECK 3 — eligibility: the route must be active and its campus live.
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

  -- CHECK 2 — pickup: the chosen stop must belong to this route (when it has any).
  select exists (select 1 from route_stops where route_id = p_route_id) into v_has_stops;
  if v_has_stops then
    if p_pickup_stop_id is null
       or not exists (select 1 from route_stops
                       where id = p_pickup_stop_id and route_id = p_route_id) then
      raise exception 'Please choose a valid pickup stop for this route' using errcode='P0012';
    end if;
  end if;

  -- CHECK 1 — seat availability (lock the allocation to serialize with promotion).
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
    -- A held (PENDING) seat is auto-approved on the spot: approved_at + a
    -- 20-minute window to pay. A full bus → WAITLISTED (not approved).
    insert into bookings (institution_id, student_id, route_id, pickup_stop_id,
        drop_stop_id, status, seat_allocation_id, student_name, student_email,
        approved_at, expires_at)
    values (v_route.institution_id, v_student.id, p_route_id, p_pickup_stop_id,
        p_drop_stop_id, v_status, v_alloc.id, v_name, v_email,
        case when v_status = 'PENDING' then now() end,
        case when v_status = 'PENDING' then now() + interval '20 minutes' end)
    returning * into v_booking; -- trigger updates reserved_seats
  exception when unique_violation then
    raise exception 'You already have an active booking on this route — see My bookings'
      using errcode = 'P0007';
  end;
  return v_booking;
end; $$;
grant execute on function public.reserve_seat(uuid, uuid, uuid) to authenticated;

-- promote_waitlist_for: same locking as 0039, but a promoted booking is now
-- AUTO-APPROVED (approved_at + 20-minute window) instead of re-entering a manual
-- approval queue — keeping the whole flow hands-off for the agency.
create or replace function public.promote_waitlist_for(p_alloc uuid) returns void
language plpgsql security definer set search_path = public as $$
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
    -- → PENDING and auto-approved: the student gets a 20-minute payment window.
    update bookings
       set status = 'PENDING', approved_at = now(), expires_at = now() + interval '20 minutes'
     where id = v_next;
  end loop;
end; $$;
