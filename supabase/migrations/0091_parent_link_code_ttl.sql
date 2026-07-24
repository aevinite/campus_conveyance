-- 0091_parent_link_code_ttl.sql (idempotent — requires 0050)
-- L3: the parent link code expired in 3 minutes — too tight for a parent who's
-- still mid-signup (create account → confirm email → open dashboard → type code)
-- and often missed the window. Widen it to 15 minutes: comfortable for onboarding
-- while still short-lived and single-use. Only the expiry interval changes; the
-- rest of create_parent_link_code() is verbatim from 0050.
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
    insert into students (profile_id) values (v_uid) returning * into v_student;
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
  values (v_student.id, v_code, now() + interval '15 minutes')
  returning parent_link_codes.code, parent_link_codes.expires_at;
end; $$;
grant execute on function public.create_parent_link_code() to authenticated;
