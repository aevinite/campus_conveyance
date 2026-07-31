-- 0108_agency_hidden_students_purge.sql (idempotent — requires 0060)
--
-- The agency "Deleted students" list (rows in agency_hidden_students) only had a
-- Restore action. Add a permanent "Remove" that clears an entry from that list
-- for good WITHOUT deleting the student's account or booking/payment history, and
-- without letting an agency purge a platform-wide account (that stays admin-only).
--
-- Implemented as a soft `purged_at` flag on the hidden row: the row is KEPT (so
-- the student stays excluded from the active onboard roster and can't reappear),
-- but the two Deleted-Students list RPCs skip purged rows, so the entry is gone
-- from the agency's view permanently. Fully reversible at the DB level if needed.

alter table public.agency_hidden_students
  add column if not exists purged_at timestamptz;

create or replace function public.agency_hidden_students_page(
  p_agency_id uuid, p_limit int default null, p_offset int default 0
) returns table (student_id uuid, name text, email text, phone text)
language sql stable security definer set search_path = public as $$
  select s.id, pr.full_name, pr.email, pr.phone
  from agency_hidden_students h
  join students s on s.id = h.student_id
  left join profiles pr on pr.id = s.profile_id
  where h.agency_id = p_agency_id
    and h.purged_at is null
    and exists (select 1 from agencies a where a.id = p_agency_id and a.owner_profile_id = auth.uid())
  order by h.hidden_at desc
  limit p_limit offset coalesce(p_offset, 0);
$$;
grant execute on function public.agency_hidden_students_page(uuid, int, int) to authenticated;

create or replace function public.agency_hidden_students_count(p_agency_id uuid)
returns bigint language sql stable security definer set search_path = public as $$
  select count(*)
  from agency_hidden_students h
  where h.agency_id = p_agency_id
    and h.purged_at is null
    and exists (select 1 from agencies a where a.id = p_agency_id and a.owner_profile_id = auth.uid());
$$;
grant execute on function public.agency_hidden_students_count(uuid) to authenticated;
