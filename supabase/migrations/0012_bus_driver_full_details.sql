-- 0012_bus_driver_full_details.sql (idempotent)
-- Full, manually-entered bus + driver details (no links), with device-uploaded
-- photos stored in a public Storage bucket. Shown to students/parents so they
-- know the bus number, what it looks like, and who's driving (safety).

-- Extra detail columns (bus_number / driver_name / driver_phone / driver_email /
-- driver_photo_url already exist from 0011; image_url is the bus photo).
alter table vehicles add column if not exists bus_model text;
alter table vehicles add column if not exists bus_color text;
alter table vehicles add column if not exists driver_license_no text;
alter table vehicles add column if not exists driver_experience_years int;

-- Public bucket for bus/driver photos uploaded from the agency's device.
insert into storage.buckets (id, name, public)
values ('vehicle-photos', 'vehicle-photos', true)
on conflict (id) do nothing;

-- Anyone can read the photos (public URLs); uploads are done server-side with the
-- service-role key, so no insert policy is required here.
drop policy if exists vehicle_photos_read on storage.objects;
create policy vehicle_photos_read on storage.objects
  for select using (bucket_id = 'vehicle-photos');
