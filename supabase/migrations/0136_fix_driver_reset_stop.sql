-- 0136: audit-6 HIGH — driver "Undo" on a skipped stop always failed: 0133 gave
-- notify_stop_riders two new params (p_kind, p_email) but driver_reset_stop still
-- called the old 5-arg version. Pass the kind + email (it changes the pickup
-- point back, same as a skip). Idempotent.
CREATE OR REPLACE FUNCTION public.driver_reset_stop(p_route_id uuid, p_stop_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_institution uuid := public.driver_assert_route(p_route_id);
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_prev_status text;
  v_stop_name text;
  v_seq int;
  v_barrier_seq int;
  v_body text;
  v_rec record;
begin
  select status into v_prev_status from route_stop_progress
  where route_id = p_route_id and stop_id = p_stop_id and service_date = v_today;

  delete from route_stop_progress
  where route_id = p_route_id and stop_id = p_stop_id and service_date = v_today;

  -- Only an undone SKIP needs a rider notice (undoing a NEXT is silent).
  if v_prev_status is distinct from 'SKIPPED' then return; end if;

  select rs.name, rs.sequence into v_stop_name, v_seq
  from route_stops rs where rs.id = p_stop_id and rs.route_id = p_route_id;
  if v_stop_name is null then return; end if;

  v_body := 'Update: the bus will now stop at ' || v_stop_name
    || ' after all. Please board at ' || v_stop_name || '.';

  -- Same contiguous-skipped-run logic as the skip path: riders at earlier stops
  -- that were redirected past this one now board here again.
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
      p_route_id, v_rec.stop_id, v_institution, 'Pickup point restored', v_body,
      'STOP_RESTORED', true);
  end loop;
end; $function$;

insert into public.schema_migrations_applied (version, name)
values ('0136', '0136_fix_driver_reset_stop') on conflict do nothing;

notify pgrst, 'reload schema';
