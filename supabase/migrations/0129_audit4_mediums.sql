-- 0129_audit4_mediums.sql (idempotent)
-- Audit round 4 MEDIUM fixes (security, money, display). Numbers = the audit list.

-- ---------------------------------------------------------------------------
-- #1 Deactivated accounts lose DATABASE access immediately, not at token expiry.
-- PostgREST runs this before every API request; a soft-deleted profile (or the
-- owner of a soft-deleted agency) gets HTTP 403. Service-role calls (no uid) pass.
-- ---------------------------------------------------------------------------
create or replace function public.check_request()
 returns void
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return; end if;
  if exists (select 1 from profiles p where p.id = v_uid and coalesce(p.is_deleted, false))
     or exists (select 1 from agencies a where a.owner_profile_id = v_uid and a.is_deleted) then
    raise exception 'This account has been deactivated' using errcode = 'PT403';
  end if;
end; $function$;
revoke all on function public.check_request() from public;
grant execute on function public.check_request() to anon, authenticated;
alter role authenticator set pgrst.db_pre_request to 'public.check_request';

-- #1 + #3 Role / campus come from the LIVE profile, not the (up to 1h old) token:
-- a demoted, deleted or unlinked account loses its privileges at once.
create or replace function public.jwt_role()
 returns text
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select case when coalesce(p.is_deleted, false) then null else p.role::text end
    from public.profiles p where p.id = auth.uid();
$function$;

create or replace function public.jwt_institution()
 returns uuid
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select p.institution_id from public.profiles p
   where p.id = auth.uid() and not coalesce(p.is_deleted, false)
     and p.role = 'INSTITUTION_ADMIN';
$function$;

-- The token itself no longer carries a role / campus for a deleted account, and
-- drops a stale campus claim once the admin is unlinked.
create or replace function public.custom_access_token_hook(event jsonb)
 returns jsonb
 language plpgsql
 stable
 set search_path to 'public'
as $function$
declare claims jsonb; p record;
begin
  select institution_id, role, coalesce(is_deleted, false) as is_deleted into p
  from public.profiles where id = (event->>'user_id')::uuid;
  claims := coalesce(event->'claims','{}'::jsonb);
  if p.is_deleted then
    claims := claims #- '{app_metadata,role}';
    claims := claims #- '{app_metadata,institution_id}';
    return jsonb_set(event,'{claims}',claims);
  end if;
  if p.institution_id is not null then
    claims := jsonb_set(claims,'{app_metadata,institution_id}',
                        to_jsonb(p.institution_id::text));
  else
    claims := claims #- '{app_metadata,institution_id}';
  end if;
  if p.role is not null then
    claims := jsonb_set(claims,'{app_metadata,role}', to_jsonb(p.role::text));
  end if;
  return jsonb_set(event,'{claims}',claims);
end; $function$;

-- ---------------------------------------------------------------------------
-- #4 Agency GST / PAN / registration / address / KYC links: service role only
-- (admin + the agency's own account page read them server-side). NOTE: a new
-- agencies column must be granted explicitly to authenticated.
-- ---------------------------------------------------------------------------
do $$
declare cols text;
begin
  revoke select on public.agencies from anon, authenticated;
  select string_agg(quote_ident(column_name), ', ') into cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'agencies'
     and column_name not in ('gst_number','pan_number','registration_no',
                             'registered_address','permit_doc_url','fitness_doc_url');
  execute format('grant select (%s) on public.agencies to authenticated', cols);
end $$;

-- ---------------------------------------------------------------------------
-- #6 Photo bucket: images only, <= 6 MB, uploads only by an approved agency.
-- ---------------------------------------------------------------------------
update storage.buckets
   set file_size_limit = 6291456,
       allowed_mime_types = array['image/jpeg','image/png','image/webp','image/heic','image/heif','image/gif']
 where id = 'vehicle-photos';
drop policy if exists vehicle_photos_insert on storage.objects;
create policy vehicle_photos_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'vehicle-photos'
    and exists (select 1 from public.agencies a
                 where a.owner_profile_id = auth.uid() and a.status = 'APPROVED' and not a.is_deleted)
  );

-- ---------------------------------------------------------------------------
-- #10 A bus's capacity can't drop below the seats already booked on it.
-- ---------------------------------------------------------------------------
create or replace function public.sync_vehicle_capacity()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_booked int;
begin
  select coalesce(max(sa.reserved_seats), 0) into v_booked
    from seat_allocations sa join route_assignments ra on ra.id = sa.route_assignment_id
   where ra.vehicle_id = NEW.id;
  if NEW.capacity < v_booked then
    raise exception '% seats are already booked on this bus — capacity can''t be lower than that', v_booked
      using errcode = 'P0005';
  end if;
  update seat_allocations sa
     set total_seats = NEW.capacity
    from route_assignments ra
   where ra.id = sa.route_assignment_id
     and ra.vehicle_id = NEW.id;
  return null;
end; $function$;

-- #11 One bus -> at most one active route (backstop for add_route's check).
create unique index if not exists uq_routes_active_vehicle
  on public.routes (vehicle_id) where is_active and vehicle_id is not null;

-- ---------------------------------------------------------------------------
-- #13 A UPI reference (UTR) can back only ONE payment / renewal.
-- ---------------------------------------------------------------------------
create or replace function public.guard_unique_utr()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if NEW.upi_utr is null then return NEW; end if;
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
drop trigger if exists trg_payments_unique_utr on public.payments;
create trigger trg_payments_unique_utr before insert or update of upi_utr on public.payments
  for each row execute function public.guard_unique_utr();
drop trigger if exists trg_pass_renewals_unique_utr on public.pass_renewals;
create trigger trg_pass_renewals_unique_utr before insert or update of upi_utr on public.pass_renewals
  for each row execute function public.guard_unique_utr();
create index if not exists idx_payments_upi_utr on public.payments (upi_utr) where upi_utr is not null;
create index if not exists idx_pass_renewals_upi_utr on public.pass_renewals (upi_utr) where upi_utr is not null;

-- #16 a renewal can be refunded (with its booking)
alter table public.pass_renewals drop constraint if exists pass_renewals_status_check;
alter table public.pass_renewals add constraint pass_renewals_status_check
  check (status in ('CREATED','PAID','FAILED','REFUNDED'));

-- ---------------------------------------------------------------------------
-- #14 #15 verify_upi_payment
--   * approving money for a booking whose cancel/removal is pending (or that
--     already ended) never confirms it — the booking is closed and refunded;
--   * the 3rd rejected payment releases the seat instead of asking to pay again.
-- ---------------------------------------------------------------------------
create or replace function public.verify_upi_payment(p_booking_id uuid, p_approve boolean, p_note text DEFAULT NULL::text)
 returns bookings
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
-- #16 process_refund: refundable = verified first payment + verified renewals,
-- and it can pay out a renewal received after the booking was already refunded.
-- ---------------------------------------------------------------------------
create or replace function public.process_refund(p_booking_id uuid, p_amount_cents bigint, p_approve boolean, p_note text DEFAULT NULL::text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid(); v_role text; v_booking bookings; v_route text;
  v_amt bigint; v_kind text; v_title text; v_body text; v_note text; v_rec record;
  v_pay payments; v_refundable bigint;
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
  else
    -- DECLINE -> keep the booking as it is; clear the pending-cancellation flag.
    update payments set refund_status = 'DECLINED',
        refunded_at = now(), refunded_by = v_uid, refund_note = v_note, updated_at = now()
     where id = v_pay.id;
    update bookings set cancel_requested_at = null, cancel_cause = null, refund_details = null
     where id = p_booking_id and status in ('PENDING', 'CONFIRMED');
    v_kind := 'CANCELLED'; v_title := 'Refund request declined';
    v_body := 'Your refund request for ' || v_route || ' was declined' ||
              case when v_booking.status in ('PENDING', 'CONFIRMED')
                   then ', so your booking is still active.' else '.' end ||
              coalesce(' Note: ' || v_note, '');
  end if;

  -- Notify the rider + linked parents (bell + email + push), best-effort.
  begin
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
      insert into notifications (institution_id, recipient_id, title, body)
      values (v_booking.institution_id, v_rec.pid, v_title, v_body);
      if v_rec.email is not null then
        insert into email_outbox (recipient_id, to_email, kind, title, body, booking_id)
        values (v_rec.pid, v_rec.email, v_kind, v_title, v_body, p_booking_id);
      end if;
      insert into push_outbox (recipient_id, kind, title, body, url, booking_id)
      values (v_rec.pid, v_kind, v_title, v_body, '/student/history', p_booking_id);
    end loop;
  exception when others then
    raise warning 'process_refund notify failed for booking %: %', p_booking_id, sqlerrm;
  end;
end; $function$;

-- #16 verify_pass_renewal: money received for a booking that's no longer active
-- is recorded and queued for refund (instead of "reject + refund by hand").
create or replace function public.verify_pass_renewal(p_renewal_id uuid, p_approve boolean, p_note text DEFAULT NULL::text)
 returns pass_renewals
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid(); v_role text; v_r pass_renewals; v_b bookings; v_start timestamptz;
  v_route text; v_title text; v_body text; v_note text := nullif(btrim(coalesce(p_note,'')),'');
begin
  select role::text into v_role from profiles where id = v_uid and not coalesce(is_deleted, false);
  if v_role is distinct from 'SUPER_ADMIN' then
    raise exception 'Only an admin can verify payments' using errcode='P0003'; end if;
  select * into v_r from pass_renewals where id = p_renewal_id for update;
  if v_r.id is null then raise exception 'Renewal not found' using errcode='P0002'; end if;
  if v_r.status <> 'CREATED' then return v_r; end if;
  select * into v_b from bookings where id = v_r.booking_id for update;
  select coalesce(r.name, 'your route') into v_route from routes r where r.id = v_b.route_id;

  if p_approve and (v_b.status <> 'CONFIRMED' or v_b.cancel_requested_at is not null) then
    update pass_renewals set status = 'PAID', verified_at = now(), verified_by = v_uid,
           verify_note = coalesce(v_note, 'Booking no longer active — refunding')
     where id = v_r.id returning * into v_r;
    update payments set refund_status = 'REQUESTED', updated_at = now()
     where booking_id = v_b.id and status in ('PAID', 'REFUNDED') and refund_status <> 'REQUESTED';
    v_title := 'Renewal payment received — refund on the way';
    v_body := 'We received your renewal payment for ' || v_route ||
              ', but this booking is no longer active, so we''re refunding it to you.';
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
  else
    update pass_renewals set status = 'FAILED', verified_at = now(), verified_by = v_uid, verify_note = v_note
     where id = v_r.id returning * into v_r;
    v_title := 'Renewal payment could not be verified';
    v_body := 'We could not verify your renewal payment for ' || v_route ||
              '. Please pay again and re-enter the reference.' || coalesce(' Note: ' || v_note, '');
  end if;

  insert into notifications (institution_id, recipient_id, title, body)
  select v_b.institution_id, pid, v_title, v_body
  from (
    select s.profile_id as pid from students s
      where s.id = v_b.student_id and s.profile_id is not null
    union
    select pa.profile_id from parent_students ps
      join parents pa on pa.id = ps.parent_id
      where ps.student_id = v_b.student_id and pa.profile_id is not null
  ) t;
  return v_r;
end; $function$;

-- ---------------------------------------------------------------------------
-- #29 cron.job_run_details grows forever (every-minute jobs) -> keep 3 days.
-- ---------------------------------------------------------------------------
delete from cron.job_run_details where end_time < now() - interval '3 days';
select cron.unschedule(jobid) from cron.job where jobname = 'purge-cron-log';
select cron.schedule('purge-cron-log', '40 3 * * *',
  $cron$delete from cron.job_run_details where end_time < now() - interval '3 days'$cron$);

-- ---------------------------------------------------------------------------
-- #18 Permanently deleting a college must not wipe PEOPLE or MONEY records:
-- students/parents/drivers/vehicles and payments just lose the campus link.
-- (The admin action also refuses while bookings/verifications/refunds are open.)
-- ---------------------------------------------------------------------------
alter table public.payments alter column institution_id drop not null;
do $$
declare t text;
begin
  foreach t in array array['students','parents','drivers','vehicles','payments'] loop
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_institution_id_fkey');
    execute format('alter table public.%I add constraint %I foreign key (institution_id) references public.institutions(id) on delete set null',
                   t, t || '_institution_id_fkey');
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Patched from the live definitions (minimal edits; see each comment)
-- ---------------------------------------------------------------------------
-- #2 only an ACTIVE, non-deleted driver has buses today
CREATE OR REPLACE FUNCTION public.driver_today_vehicle_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with me as (select id from drivers where profile_id = auth.uid()
                and is_active and not coalesce(is_deleted, false))
  select v.id from vehicles v
   where v.driver_id in (select id from me)
     and not exists (
       select 1 from bus_driver_changes dc
        where dc.vehicle_id = v.id
          and dc.role = 'DRIVER'
          and dc.effective_date = (now() at time zone 'Asia/Kolkata')::date
     )
  union
  select dc.vehicle_id from bus_driver_changes dc
   where dc.driver_id in (select id from me)
     and dc.role = 'DRIVER'  -- a CONDUCTOR substitute must NOT get the driver panel
     and dc.effective_date = (now() at time zone 'Asia/Kolkata')::date;
$function$;

-- #2 deactivated drivers can't send locations
CREATE OR REPLACE FUNCTION public.driver_update_location(p_lat double precision, p_lng double precision)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_driver uuid;
begin
  select d.id into v_driver from drivers d where d.profile_id = auth.uid()
     and d.is_active and not coalesce(d.is_deleted, false) limit 1;
  if v_driver is null then
    raise exception 'Not an active driver account' using errcode = 'P0001';
  end if;
  insert into driver_locations (driver_id, is_online, lat, lng, updated_at)
  values (v_driver, true, p_lat, p_lng, now())
  on conflict (driver_id) do update set
    is_online = true, lat = excluded.lat, lng = excluded.lng, updated_at = now();
end; $function$;

-- #2 deactivated drivers can't go online
CREATE OR REPLACE FUNCTION public.driver_set_online(p_online boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_driver uuid;
begin
  select d.id into v_driver from drivers d where d.profile_id = auth.uid()
     and d.is_active and not coalesce(d.is_deleted, false) limit 1;
  if v_driver is null then
    raise exception 'Not an active driver account' using errcode = 'P0001';
  end if;
  insert into driver_locations (driver_id, is_online, updated_at)
  values (v_driver, p_online, now())
  on conflict (driver_id) do update set
    is_online = excluded.is_online,
    updated_at = now(),
    lat = case when excluded.is_online then driver_locations.lat else null end,
    lng = case when excluded.is_online then driver_locations.lng else null end;
  return p_online;
end; $function$;

-- #2 active drivers only; #27 alert at the rider's EFFECTIVE stop (skipped stop -> next non-skipped one)
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
    where b.status = 'CONFIRMED'
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
      values (v_rec.pid, 'APPROACHING', v_title, v_body, '/student/bookings', r.booking_id);
    end loop;

    v_count := v_count + 1;
  end loop;

  return v_count;
exception when others then
  -- Best-effort: never let a geofence failure break the GPS ping.
  raise warning 'check_pickup_geofence failed: %', sqlerrm;
  return v_count;
end; $function$;

-- #25 driver column = today's DRIVER substitute only (not the conductor; no duplicate rows)
CREATE OR REPLACE FUNCTION public.parent_children_bookings()
 RETURNS TABLE(booking_id uuid, student_id uuid, student_name text, route_name text, institution_name text, status text, is_paid boolean, created_at timestamp with time zone, pickup_name text, departure_time time without time zone, bus_number text, driver_name text, driver_phone text, driver_changed boolean, route_id uuid, billing_period text, paid_at timestamp with time zone, payment_status text, cancel_requested_at timestamp with time zone, pass_start_at timestamp with time zone)
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
         b.payment_status, b.cancel_requested_at, b.pass_start_at
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

-- #23 trips of ended/cancelled passes stay in history (a trip = an actual boarding)
CREATE OR REPLACE FUNCTION public.my_ride_history()
 RETURNS TABLE(ride_id uuid, booking_id uuid, student_name text, route_name text, college_name text, bus_number text, agency_name text, pickup_name text, boarded_at timestamp with time zone, reached_at timestamp with time zone, got_off_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with mine as (
    -- The caller's own bookings (as a student) or their linked children's (as a
    -- parent), in ANY status: an entry is an actual boarding, so a pass that ended
    -- or was cancelled keeps its past trips.
    select b.id, b.student_name, b.route_id, b.pickup_stop_id
    from bookings b
    where (

        b.student_id in (select s.id from students s where s.profile_id = auth.uid())
        or b.student_id in (
          select ps2.student_id from parent_students ps2
          join parents pa on pa.id = ps2.parent_id
          where pa.profile_id = auth.uid()
        )
      )
  ),
  boardings as (
    -- One row per actual boarding. This is what makes an entry a "trip".
    select re.id as ride_id, re.booking_id, re.recorded_at as boarded_at,
           (re.recorded_at at time zone 'Asia/Kolkata')::date as ride_date
    from ride_events re
    join mine m on m.id = re.booking_id
    where re.stage = 'BOARDED'
  )
  select
    bo.ride_id, bo.booking_id, m.student_name,
    r.name, i.name, v.bus_number, ag.name, ps.name,
    bo.boarded_at,
    -- that same IST-day's reached / got-off times (if the driver recorded them).
    (select min(re2.recorded_at) from ride_events re2
       where re2.booking_id = bo.booking_id and re2.stage = 'REACHED'
         and re2.recorded_at >= bo.boarded_at
         and (re2.recorded_at at time zone 'Asia/Kolkata')::date = bo.ride_date),
    (select min(re3.recorded_at) from ride_events re3
       where re3.booking_id = bo.booking_id and re3.stage = 'GOT_OFF'
         and re3.recorded_at >= bo.boarded_at
         and (re3.recorded_at at time zone 'Asia/Kolkata')::date = bo.ride_date)
  from boardings bo
  join mine m on m.id = bo.booking_id
  join routes r on r.id = m.route_id
  left join institutions i on i.id = r.institution_id
  left join vehicles v on v.id = r.vehicle_id
  left join agencies ag on ag.id = r.agency_id
  left join route_stops ps on ps.id = m.pickup_stop_id
  order by bo.boarded_at desc;
$function$;

-- #22 managed children (no login) show their own name/contact
CREATE OR REPLACE FUNCTION public.agency_bookings(p_agency_id uuid, p_status text DEFAULT NULL::text, p_limit integer DEFAULT NULL::integer, p_offset integer DEFAULT 0)
 RETURNS TABLE(booking_id uuid, student_id uuid, status text, created_at timestamp with time zone, is_paid boolean, paid_at timestamp with time zone, approved_at timestamp with time zone, payment_due timestamp with time zone, student_name text, student_email text, student_phone text, student_address text, student_grade text, guardian_name text, guardian_phone text, route_name text, bus_number text, bus_registration text, pickup_name text, drop_name text, price_cents bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select b.id, s.id, b.status::text, b.created_at,
         b.is_paid, b.paid_at, b.approved_at, b.expires_at,
         coalesce(pr.full_name, s.full_name, b.student_name), coalesce(pr.email, s.email), coalesce(pr.phone, s.phone),
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
    and exists (select 1 from agencies a where a.id = p_agency_id and a.owner_profile_id = auth.uid())
    and (p_status is null or b.status::text = p_status)
  order by b.created_at desc
  limit p_limit offset coalesce(p_offset, 0);
$function$;

-- #22 managed children names
CREATE OR REPLACE FUNCTION public.agency_onboard_bookings(p_agency_id uuid, p_limit integer DEFAULT NULL::integer, p_offset integer DEFAULT 0)
 RETURNS TABLE(booking_id uuid, student_id uuid, status text, created_at timestamp with time zone, is_paid boolean, paid_at timestamp with time zone, approved_at timestamp with time zone, payment_due timestamp with time zone, student_name text, student_email text, student_phone text, student_address text, student_grade text, guardian_name text, guardian_phone text, route_name text, bus_number text, bus_registration text, pickup_name text, drop_name text, price_cents bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    and exists (select 1 from agencies a where a.id = p_agency_id and a.owner_profile_id = auth.uid())
    and not exists (
      select 1 from agency_hidden_students h
      where h.agency_id = p_agency_id and h.student_id = b.student_id
        and h.purged_at is null
    )
  order by b.created_at desc
  limit p_limit offset coalesce(p_offset, 0);
$function$;

-- #22 managed children names
CREATE OR REPLACE FUNCTION public.agency_students(p_agency_id uuid)
 RETURNS TABLE(student_id uuid, name text, email text, phone text, hidden boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select distinct s.id, coalesce(pr.full_name, s.full_name), coalesce(pr.email, s.email), coalesce(pr.phone, s.phone),
         (h.student_id is not null) as hidden
  from bookings b
  join routes r on r.id = b.route_id
  join students s on s.id = b.student_id
  left join profiles pr on pr.id = s.profile_id
  left join agency_hidden_students h on h.student_id = s.id and h.agency_id = p_agency_id
  where r.agency_id = p_agency_id
    and exists (select 1 from agencies a where a.id = p_agency_id and a.owner_profile_id = auth.uid());
$function$;

-- #22 managed children names
CREATE OR REPLACE FUNCTION public.agency_hidden_students_page(p_agency_id uuid, p_limit integer DEFAULT NULL::integer, p_offset integer DEFAULT 0)
 RETURNS TABLE(student_id uuid, name text, email text, phone text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select s.id, coalesce(pr.full_name, s.full_name), coalesce(pr.email, s.email), coalesce(pr.phone, s.phone)
  from agency_hidden_students h
  join students s on s.id = h.student_id
  left join profiles pr on pr.id = s.profile_id
  where h.agency_id = p_agency_id
    and h.purged_at is null
    and exists (select 1 from agencies a where a.id = p_agency_id and a.owner_profile_id = auth.uid())
  order by h.hidden_at desc
  limit p_limit offset coalesce(p_offset, 0);
$function$;

-- #12 a plan can't be removed while riders are booked on it (they'd be charged another plan's price)
CREATE OR REPLACE FUNCTION public.update_route(p_route_id uuid, p_price_monthly_cents bigint, p_price_semester_cents bigint, p_price_yearly_cents bigint, p_departure_time time without time zone, p_stops jsonb DEFAULT '[]'::jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_inst uuid; v_has_bookings boolean; v_first text; v_primary bigint;
begin
  select r.institution_id into v_inst from routes r join agencies a on a.id=r.agency_id
    where r.id=p_route_id and a.owner_profile_id=auth.uid() and a.status='APPROVED';
  if v_inst is null then raise exception 'Not your route' using errcode='P0003'; end if;

  if coalesce(p_price_monthly_cents,0) <= 0
     and coalesce(p_price_semester_cents,0) <= 0
     and coalesce(p_price_yearly_cents,0) <= 0 then
    raise exception 'Set a price for at least one plan (monthly, semester or yearly)' using errcode='P0014';
  end if;
  v_primary := coalesce(nullif(p_price_semester_cents,0), nullif(p_price_yearly_cents,0), nullif(p_price_monthly_cents,0));
  if coalesce(p_price_monthly_cents,0) <= 0 and exists (select 1 from bookings
       where route_id = p_route_id and billing_period = 'MONTHLY'
         and status in ('PENDING','CONFIRMED','WAITLISTED')) then
    raise exception 'Riders are booked on the monthly plan — keep its price until their passes end' using errcode='P0014';
  end if;
  if coalesce(p_price_semester_cents,0) <= 0 and exists (select 1 from bookings
       where route_id = p_route_id and billing_period = 'SEMESTER'
         and status in ('PENDING','CONFIRMED','WAITLISTED')) then
    raise exception 'Riders are booked on the semester plan — keep its price until their passes end' using errcode='P0014';
  end if;
  if coalesce(p_price_yearly_cents,0) <= 0 and exists (select 1 from bookings
       where route_id = p_route_id and billing_period = 'YEARLY'
         and status in ('PENDING','CONFIRMED','WAITLISTED')) then
    raise exception 'Riders are booked on the yearly plan — keep its price until their passes end' using errcode='P0014';
  end if;

  update routes set
      price_cents          = v_primary,
      price_monthly_cents  = nullif(p_price_monthly_cents,0),
      price_semester_cents = nullif(p_price_semester_cents,0),
      price_yearly_cents   = nullif(p_price_yearly_cents,0),
      departure_time       = p_departure_time
   where id=p_route_id;

  select exists(select 1 from bookings where route_id=p_route_id) into v_has_bookings;
  if v_has_bookings then
    return false; -- keep stops (bookings reference them)
  end if;

  delete from route_stops where route_id=p_route_id;
  insert into route_stops (institution_id, route_id, name, sequence, lat, lng, address, description)
  select v_inst, p_route_id,
         coalesce(nullif(elem->>'name',''), 'Stop ' || ord::text),
         ord::int,
         (elem->>'lat')::double precision,
         (elem->>'lng')::double precision,
         nullif(elem->>'address',''),
         nullif(elem->>'description','')
  from jsonb_array_elements(coalesce(p_stops, '[]'::jsonb)) with ordinality as t(elem, ord)
  where (elem->>'lat') is not null and (elem->>'lng') is not null;

  select name into v_first from route_stops where route_id=p_route_id order by sequence limit 1;
  if v_first is not null then
    update routes set name=v_first, start_location=v_first where id=p_route_id;
  end if;
  return true;
end; $function$;

-- #11 one bus can serve only one active route (else it sells its seats twice)
CREATE OR REPLACE FUNCTION public.add_route(p_agency_id uuid, p_agency_service_id uuid, p_institution_id uuid, p_vehicle_id uuid, p_start_location text, p_price_monthly_cents bigint, p_price_semester_cents bigint, p_price_yearly_cents bigint, p_departure_time time without time zone, p_image_url text, p_stops jsonb DEFAULT '[]'::jsonb)
 RETURNS routes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_route routes; v_cap int; v_ra uuid; v_vtype vehicle_type; v_primary bigint; v_svc uuid;
begin
  if not exists (select 1 from agencies where id=p_agency_id and owner_profile_id=auth.uid() and status='APPROVED') then
    raise exception 'Agency not approved' using errcode='P0003'; end if;
  select capacity, vehicle_type into v_cap, v_vtype from vehicles where id=p_vehicle_id and agency_id=p_agency_id;
  if v_cap is null then raise exception 'Bus not found' using errcode='P0002'; end if;
  if exists (select 1 from routes where vehicle_id = p_vehicle_id and is_active) then
    raise exception 'This bus already runs another route — pick a different bus' using errcode='P0005'; end if;

  -- The agency must have an APPROVED service area at this campus (created only by
  -- the campus → admin review). A supplied service id must be that same area.
  select s.id into v_svc from agency_services s
   where s.agency_id = p_agency_id and s.institution_id = p_institution_id
     and (p_agency_service_id is null or s.id = p_agency_service_id)
   order by (s.vehicle_type = v_vtype) desc, s.vehicle_type
   limit 1;
  if v_svc is null then
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

notify pgrst, 'reload config';
notify pgrst, 'reload schema';
