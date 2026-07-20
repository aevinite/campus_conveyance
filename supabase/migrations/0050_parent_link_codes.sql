-- 0050_parent_link_codes.sql (idempotent)
-- Parent linking via a student-generated code (replaces link-by-email in the UI):
--   1. The student taps "Generate parent code" → a random 6-digit code, valid
--      for 3 minutes, single use (generating a new one voids the old one).
--   2. The parent enters the code on their dashboard within the window →
--      parent_students link is created and the code is consumed.
-- The table is RLS-locked with no client policies — all access goes through
-- the SECURITY DEFINER RPCs below, like every other student/parent mutation.

create table if not exists parent_link_codes (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  code text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references parents(id) on delete set null
);
create index if not exists idx_parent_link_codes_active
  on parent_link_codes (code) where used_at is null;
alter table parent_link_codes enable row level security;

-- Student side: mint a fresh code (voiding any still-active one).
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
  values (v_student.id, v_code, now() + interval '3 minutes')
  returning parent_link_codes.code, parent_link_codes.expires_at;
end; $$;
grant execute on function public.create_parent_link_code() to authenticated;

-- Parent side: redeem the code → linked to that student. Single use (FOR
-- UPDATE prevents two parents racing on the same code).
create or replace function public.redeem_parent_link_code(p_code text)
returns table (student_id uuid, full_name text, email text)
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_role text; v_parent parents;
  v_row parent_link_codes; v_profile profiles;
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

  update parent_link_codes plc set used_at = now(), used_by = v_parent.id
   where plc.id = v_row.id;

  return query
  select s.id, pr.full_name, pr.email
  from students s
  left join profiles pr on pr.id = s.profile_id
  where s.id = v_row.student_id;
end; $$;
grant execute on function public.redeem_parent_link_code(text) to authenticated;
