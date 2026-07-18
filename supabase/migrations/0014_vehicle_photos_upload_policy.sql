-- 0014_vehicle_photos_upload_policy.sql (idempotent)
-- Allow signed-in users to upload bus/driver photos straight from the browser to
-- the public vehicle-photos bucket. Uploading client-side avoids routing large
-- files through Next (Server Action / middleware body-size limits). Reads stay
-- public via the 0012 select policy.
drop policy if exists vehicle_photos_insert on storage.objects;
create policy vehicle_photos_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'vehicle-photos');
