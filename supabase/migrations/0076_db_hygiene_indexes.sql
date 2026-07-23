-- DB hygiene: cover FK-cascade / sort paths that currently seq-scan, and pin the
-- shared updated_at trigger's search_path.

-- ride_events(student_id, institution_id): both are ON DELETE CASCADE FKs but
-- unindexed, so deleting a student/institution seq-scans ride_events. (booking_id
-- is already covered by idx_ride_events_booking, 0043.)
create index if not exists idx_ride_events_student on ride_events(student_id);
create index if not exists idx_ride_events_institution on ride_events(institution_id);

-- Notification bell reads `where recipient_id = ? order by created_at desc`. The
-- existing (recipient_id, is_read) index (0001) doesn't cover the sort, so it
-- still sorts. Add a recipient+created_at index for the inbox list.
create index if not exists idx_notifications_recipient_created
  on notifications(recipient_id, created_at desc);

-- set_updated_at() (0001) had no pinned search_path. It's attached to ~17 tables;
-- pin it to public for consistency with the other definer/trigger functions.
create or replace function public.set_updated_at() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end; $$;
