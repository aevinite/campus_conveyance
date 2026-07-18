-- 0035_waitlist_promotion.sql (idempotent — requires 0019 + 0032)
-- Make the waitlist actually move.
--
-- Students who reserve a full route are parked as WAITLISTED (tied to the same
-- seat_allocation), and told "we'll notify you if a seat opens" — but NOTHING
-- ever promoted them: cancel/reject/expiry freed a seat without pulling anyone
-- up, and confirm_booking only accepts PENDING, so an agency couldn't approve a
-- waitlisted request either. They waited forever.
--
-- Fix: whenever a seat frees on an allocation (a PENDING/CONFIRMED booking leaves
-- active status, or the bus capacity is increased), promote the OLDEST waitlisted
-- booking on that allocation to PENDING. Once PENDING it flows through the normal
-- approval → payment lifecycle (0032): the agency sees it in Manage Booking and
-- approves, the student then pays.

-- Promote as many waitlisted bookings as there is now room for on one allocation.
create or replace function public.promote_waitlist_for(p_alloc uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_total int; v_active int; v_next uuid;
begin
  if p_alloc is null then return; end if;
  loop
    select total_seats into v_total from seat_allocations where id = p_alloc;
    if v_total is null then return; end if;
    select count(*) into v_active from bookings
     where seat_allocation_id = p_alloc and status in ('PENDING','CONFIRMED');
    exit when v_active >= v_total;               -- no free seat
    select id into v_next from bookings
     where seat_allocation_id = p_alloc and status = 'WAITLISTED'
     order by created_at
     limit 1 for update skip locked;             -- fair (oldest first), concurrency-safe
    exit when v_next is null;                     -- nobody waiting
    -- → PENDING (approved_at stays null): re-enters the approval queue. The
    --   recursive fire of this trigger is a no-op (a booking ENTERING active
    --   status frees nothing), so there's no loop.
    update bookings set status = 'PENDING' where id = v_next;
  end loop;
end; $$;

-- Trigger A: a booking left active status (cancelled / rejected / expired) or was
-- deleted → a seat may have freed on its allocation.
create or replace function public.trg_promote_waitlist_booking() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'UPDATE' then
    if OLD.status in ('PENDING','CONFIRMED')
       and NEW.status not in ('PENDING','CONFIRMED') then
      perform public.promote_waitlist_for(NEW.seat_allocation_id);
    end if;
  elsif TG_OP = 'DELETE' then
    if OLD.status in ('PENDING','CONFIRMED') then
      perform public.promote_waitlist_for(OLD.seat_allocation_id);
    end if;
  end if;
  return null;
end; $$;

drop trigger if exists trg_promote_waitlist_booking on bookings;
create trigger trg_promote_waitlist_booking
after update or delete on bookings
for each row execute function public.trg_promote_waitlist_booking();

-- Trigger B: the agency raised the bus capacity (0029 propagates it to
-- seat_allocations.total_seats) → newly-available seats pull the waitlist up.
create or replace function public.trg_promote_waitlist_alloc() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.promote_waitlist_for(NEW.id);
  return null;
end; $$;

drop trigger if exists trg_promote_waitlist_alloc on seat_allocations;
create trigger trg_promote_waitlist_alloc
after update of total_seats on seat_allocations
for each row when (NEW.total_seats > OLD.total_seats)
execute function public.trg_promote_waitlist_alloc();

-- One-time reconcile: promote any waitlisted booking that is already sitting
-- behind a free seat right now (seats freed before this migration existed).
do $$
declare r record;
begin
  for r in
    select distinct seat_allocation_id as id from bookings
     where status = 'WAITLISTED' and seat_allocation_id is not null
  loop
    perform public.promote_waitlist_for(r.id);
  end loop;
end $$;
