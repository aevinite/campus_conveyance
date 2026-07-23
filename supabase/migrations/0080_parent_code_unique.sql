-- Make parent link-code generation collision-safe. create_parent_link_code did a
-- check-then-insert with only a PLAIN index on code, so two concurrent
-- generations could mint the SAME 6-digit code; redeem then `order by created_at
-- desc limit 1` links the parent to whichever student sorts first — a
-- privacy/data-integrity bug, not just perf. Add a UNIQUE partial index on active
-- codes + retry-on-unique_violation. (This file now OWNS create_parent_link_code
-- — supersedes 0050/0078; never re-apply those copies for this function.)

-- De-dupe any existing duplicate ACTIVE (unused) codes first (keep newest).
with d as (
  select id, row_number() over (partition by code order by created_at desc) as rn
  from parent_link_codes
  where used_at is null
)
delete from parent_link_codes p using d where p.id = d.id and d.rn > 1;

-- At most one UNUSED row per code value. A used code frees the value for reuse.
create unique index if not exists uq_parent_link_codes_active_code
  on parent_link_codes(code) where used_at is null;

-- The pre-existing plain partial index (0050) on the same column+predicate is now
-- shadowed by the UNIQUE one above — drop the dead write/storage weight.
drop index if exists idx_parent_link_codes_active;

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

  -- Insert with retry: the UNIQUE index makes a colliding code fail atomically;
  -- catch it and regenerate rather than minting a duplicate.
  loop
    v_tries := v_tries + 1;
    v_code := lpad(floor(random() * 1000000)::int::text, 6, '0');
    begin
      return query
      insert into parent_link_codes (student_id, code, expires_at)
      values (v_student.id, v_code, now() + interval '3 minutes')
      returning parent_link_codes.code, parent_link_codes.expires_at;
      return; -- success
    exception when unique_violation then
      if v_tries > 20 then
        raise exception 'Could not generate a code — try again' using errcode='P0004';
      end if;
      -- else loop and pick a new code
    end;
  end loop;
end; $$;
grant execute on function public.create_parent_link_code() to authenticated;
