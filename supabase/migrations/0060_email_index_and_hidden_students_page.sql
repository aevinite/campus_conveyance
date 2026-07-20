-- 0060_email_index_and_hidden_students_page.sql (idempotent)
--
-- (#4) profiles.email was looked up with .ilike('email', …) on every signup,
-- OTP send, forgot-password and re-signup — all UNAUTHENTICATED, public endpoints
-- — which is a case-insensitive sequential scan whose cost grows with the user
-- count. Add a STORED generated `email_lower` column + btree index so those
-- lookups become an O(log n) equality probe (.eq('email_lower', lower(input))).
alter table profiles
  add column if not exists email_lower text generated always as (lower(email)) stored;
create index if not exists idx_profiles_email_lower on profiles (email_lower);

-- (#5) The Deleted Students page loaded EVERY distinct student who ever booked
-- with the agency (agency_students) and filtered `hidden` in JS. Paginate the
-- hidden set directly off agency_hidden_students instead, so the query scales
-- with the number of removed students, not the whole booking history.
create or replace function public.agency_hidden_students_page(
  p_agency_id uuid, p_limit int default null, p_offset int default 0
) returns table (student_id uuid, name text, email text, phone text)
language sql stable security definer set search_path = public as $$
  select s.id, pr.full_name, pr.email, pr.phone
  from agency_hidden_students h
  join students s on s.id = h.student_id
  left join profiles pr on pr.id = s.profile_id
  where h.agency_id = p_agency_id
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
    and exists (select 1 from agencies a where a.id = p_agency_id and a.owner_profile_id = auth.uid());
$$;
grant execute on function public.agency_hidden_students_count(uuid) to authenticated;
