-- 0039_waitlist_promotion_lock.sql (idempotent — supersedes promote_waitlist_for from 0035)
-- Close an oversell race between reservation and waitlist promotion.
--
-- reserve_seat locks the seat_allocations row (SELECT … FOR UPDATE of sa) before
-- it counts active bookings, but promote_waitlist_for (0035) read the SAME
-- allocation with a PLAIN select. So a promotion fired by a concurrent
-- cancel/reject/expire sweep could fill a just-freed seat at the same moment an
-- in-flight reserve_seat was filling it → more PENDING/CONFIRMED than total_seats.
-- pay_booking doesn't re-check capacity, so those could all confirm = real
-- oversell (narrow window; agency approval only a partial backstop).
--
-- Fix: lock the allocation row FOR UPDATE at the top of the loop. Now promotion
-- serializes with reserve_seat on the same row — whichever gets the lock first
-- fills the seat, the other blocks and then re-reads the up-to-date active count.
-- Lock order is consistent with reserve_seat (allocation first), and the
-- existing `for update skip locked` on the waitlisted booking is unchanged, so no
-- deadlock. The triggers from 0035 call this by name and are untouched.
create or replace function public.promote_waitlist_for(p_alloc uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_total int; v_active int; v_next uuid;
begin
  if p_alloc is null then return; end if;
  loop
    -- FOR UPDATE: serialize with reserve_seat's lock on the same allocation so a
    -- concurrent reservation can't fill the same freed seat this promotion is.
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
    -- → PENDING (approved_at stays null): re-enters the approval queue. The
    --   recursive fire of this trigger is a no-op (a booking ENTERING active
    --   status frees nothing), so there's no loop.
    update bookings set status = 'PENDING' where id = v_next;
  end loop;
end; $$;
