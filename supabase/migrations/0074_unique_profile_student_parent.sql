-- Enforce ONE students row and ONE parents row per profile_id.
--
-- Why: reserve_seat / save_student_details / the parent link-code RPCs all
-- auto-create a students (or parents) row with a "select … limit 1; if null then
-- insert" pattern and no unique constraint. Two concurrent first-time actions
-- each insert a row → the same person gets two students.id. Since the
-- one-active-booking guard (uq_bookings_one_active_per_student, 0055) is keyed on
-- student_id, that person can then hold an active booking on EACH id — bypassing
-- the core rule and corrupting seat-hold accounting. parents(profile_id) has the
-- same latent bug (duplicate parent → double-linked child).
--
-- This (1) de-dupes any existing rows, merging all references onto a canonical
-- id, then (2) adds partial unique indexes so the race can't recur. Idempotent:
-- re-running is a no-op once there are no duplicates. Runs in one transaction, so
-- a plain (non-CONCURRENT) unique index is used — the students/parents tables are
-- small and only briefly locked.

do $$
declare
  r record;
  canonical uuid;
  dup uuid;
begin
  -- ── STUDENTS ────────────────────────────────────────────────────────────
  for r in
    select profile_id, array_agg(id order by created_at) as ids
    from students
    where profile_id is not null
    group by profile_id
    having count(*) > 1
  loop
    canonical := r.ids[1]; -- keep the oldest; merge the rest onto it

    -- Merging two active bookings onto one student would violate
    -- uq_bookings_one_active_per_student, so first collapse the whole group's
    -- active bookings to a single "best" one (CONFIRMED > PENDING > WAITLISTED,
    -- newest wins) and cancel the others.
    update bookings b set status = 'CANCELLED'
    from (
      select id, row_number() over (
               order by case status when 'CONFIRMED' then 0 when 'PENDING' then 1 else 2 end,
                        created_at desc) as rn
      from bookings
      where student_id = any(r.ids) and status in ('PENDING', 'CONFIRMED', 'WAITLISTED')
    ) k
    where b.id = k.id and k.rn > 1;

    foreach dup in array r.ids[2:array_length(r.ids, 1)] loop
      update bookings          set student_id = canonical where student_id = dup;
      update ride_events       set student_id = canonical where student_id = dup;
      update parent_link_codes set student_id = canonical where student_id = dup;
      -- Composite-PK tables: drop rows that would collide on repoint, then move.
      delete from parent_students ps
        where ps.student_id = dup
          and exists (select 1 from parent_students p2
                       where p2.parent_id = ps.parent_id and p2.student_id = canonical);
      update parent_students set student_id = canonical where student_id = dup;
      delete from agency_hidden_students a
        where a.student_id = dup
          and exists (select 1 from agency_hidden_students a2
                       where a2.agency_id = a.agency_id and a2.student_id = canonical);
      update agency_hidden_students set student_id = canonical where student_id = dup;
      delete from students where id = dup;
    end loop;
  end loop;

  -- ── PARENTS ─────────────────────────────────────────────────────────────
  for r in
    select profile_id, array_agg(id order by created_at) as ids
    from parents
    where profile_id is not null
    group by profile_id
    having count(*) > 1
  loop
    canonical := r.ids[1];
    foreach dup in array r.ids[2:array_length(r.ids, 1)] loop
      delete from parent_students ps
        where ps.parent_id = dup
          and exists (select 1 from parent_students p2
                       where p2.student_id = ps.student_id and p2.parent_id = canonical);
      update parent_students   set parent_id = canonical where parent_id = dup;
      update parent_link_codes set used_by   = canonical where used_by = dup;
      delete from parents where id = dup;
    end loop;
  end loop;
end $$;

create unique index if not exists uq_students_profile_id
  on students (profile_id) where profile_id is not null;
create unique index if not exists uq_parents_profile_id
  on parents (profile_id) where profile_id is not null;
