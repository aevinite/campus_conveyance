-- Make the first-time students/parents auto-create race-safe now that 0074 added
-- the unique constraints. The old "select … limit 1; if null then insert" blocks
-- throw a raw 23505 (duplicate key) to the client on a concurrent double-submit
-- (two tabs, redeem race). Use ON CONFLICT so the loser falls through to the
-- existing row instead of erroring. (This file now OWNS these three bodies —
-- latest-defining migration; never re-apply the older 0018/0050/0058 copies.)

-- save_student_details: upsert the student row (insert-or-update details).
create or replace function public.save_student_details(
  p_full_name text, p_phone text, p_address text,
  p_grade text, p_guardian_name text, p_guardian_phone text
) returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode='P0001'; end if;
  update profiles set full_name = p_full_name, phone = p_phone where id = v_uid;
  insert into students (profile_id, grade, address, guardian_name, guardian_phone)
    values (v_uid, p_grade, p_address, p_guardian_name, p_guardian_phone)
  on conflict (profile_id) where profile_id is not null do update
    set grade = excluded.grade, address = excluded.address,
        guardian_name = excluded.guardian_name, guardian_phone = excluded.guardian_phone;
end; $$;
grant execute on function public.save_student_details(text,text,text,text,text,text) to authenticated;

-- create_parent_link_code: insert-on-conflict then re-select (body unchanged
-- otherwise; from 0050).
create or replace function public.create_parent_link_code()
returns table (code text, expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_role text; v_student students;
  v_code text; v_tries int := 0;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode='P0001'; end if;
  select p.role::text into v_role from profiles p where p.id = v_uid;
  if v_role not in ('STUDENT','SUPER_ADMIN') then
    raise exception 'Only student accounts can generate a parent code' using errcode='P0003';
  end if;

  select * into v_student from students where profile_id = v_uid limit 1;
  if v_student.id is null then
    insert into students (profile_id) values (v_uid)
      on conflict (profile_id) where profile_id is not null do nothing;
    select * into v_student from students where profile_id = v_uid limit 1;
  end if;

  -- One active code per student: void previous ones.
  update parent_link_codes plc set expires_at = now()
   where plc.student_id = v_student.id and plc.used_at is null and plc.expires_at > now();
  -- Housekeeping: drop long-dead codes.
  delete from parent_link_codes plc where plc.expires_at < now() - interval '1 day';

  loop
    v_tries := v_tries + 1;
    v_code := lpad(floor(random() * 1000000)::int::text, 6, '0');
    exit when not exists (
      select 1 from parent_link_codes plc
       where plc.code = v_code and plc.used_at is null and plc.expires_at > now());
    if v_tries > 20 then
      raise exception 'Could not generate a code — try again' using errcode='P0004';
    end if;
  end loop;

  return query
  insert into parent_link_codes (student_id, code, expires_at)
  values (v_student.id, v_code, now() + interval '3 minutes')
  returning parent_link_codes.code, parent_link_codes.expires_at;
end; $$;
grant execute on function public.create_parent_link_code() to authenticated;

-- redeem_parent_link_code: parents insert-on-conflict then re-select (body from
-- 0058, keeps the already_linked flag).
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
    insert into parents (profile_id) values (v_uid)
      on conflict (profile_id) where profile_id is not null do nothing;
    select * into v_parent from parents where profile_id = v_uid limit 1;
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
