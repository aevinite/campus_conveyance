-- 0017_bus_photos_multi.sql (idempotent)
-- Buses now carry multiple photos (min 5 enforced in the app). Keep image_url as
-- the primary/cover photo (= photos[1]) for existing displays.
alter table vehicles add column if not exists photos text[] not null default '{}';

-- Backfill: seed the array from the single existing image_url where present.
update vehicles
set photos = array[image_url]
where (photos is null or cardinality(photos) = 0)
  and image_url is not null and image_url <> '';
