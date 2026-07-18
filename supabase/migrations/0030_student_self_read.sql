-- 0030_student_self_read.sql (idempotent)
-- Students could not see their OWN bookings: bookings_owner_read resolves the
-- caller's student row via a subquery on `students`, but `students` only had
-- the tenant policy (institution match) — a marketplace student has
-- institution_id NULL, so the subquery returned nothing under RLS and
-- "My bookings" was always empty for them (while reserve_seat, being
-- SECURITY DEFINER, still saw the existing booking and said "already booked").
-- Let every user read their own student row; that also un-hides their bookings.
drop policy if exists students_self_read on students;
create policy students_self_read on students for select to authenticated
  using (profile_id = auth.uid());
