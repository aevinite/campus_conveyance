-- 0058_redeem_already_linked.sql (idempotent — supersedes 0050's redeem_parent_link_code)
-- Report whether redeeming a code actually created a NEW link. The insert is
-- `on conflict do nothing`, so redeeming a code for an already-linked child left
-- everything unchanged but the UI still showed a "linked!" success toast. Return
-- an `already_linked` flag so the UI can say "already linked" instead.
drop function if exists public.redeem_parent_link_code(text);
create or replace function public.redeem_parent_link_code(p_code text)
returns table (student_id uuid, full_name text, email text, already_linked boolean)
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_role text; v_parent parents;
  v_row parent_link_codes; v_inserted int;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode='P0001'; end if;
  select p.role::text into v_role from profiles p where p.id = v_uid;
  if v_role not in ('PARENT','SUPER_ADMIN') then
    raise exception 'Only parent accounts can use a link code' using errcode='P0003';
  end if;

  select plc.* into v_row from parent_link_codes plc
   where plc.code = trim(p_code) and plc.used_at is null and plc.expires_at > now()
   order by plc.created_at desc limit 1
   for update;
  if v_row.id is null then
    raise exception 'Invalid or expired code — ask your child to generate a new one from their profile'
      using errcode = 'P0002';
  end if;

  select * into v_parent from parents where profile_id = v_uid limit 1;
  if v_parent.id is null then
    insert into parents (profile_id) values (v_uid) returning * into v_parent;
  end if;

  insert into parent_students (parent_id, student_id)
  values (v_parent.id, v_row.student_id)
  on conflict do nothing;
  get diagnostics v_inserted = row_count;  -- 1 = newly linked, 0 = already linked

  update parent_link_codes plc set used_at = now(), used_by = v_parent.id
   where plc.id = v_row.id;

  return query
  select s.id, pr.full_name, pr.email, (v_inserted = 0) as already_linked
  from students s
  left join profiles pr on pr.id = s.profile_id
  where s.id = v_row.student_id;
end; $$;
grant execute on function public.redeem_parent_link_code(text) to authenticated;
