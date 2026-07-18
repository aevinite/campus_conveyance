-- 0011_bus_driver_details.sql (idempotent)
-- Add Bus is no longer tied to a "service" — a bus is just the agency's vehicle,
-- and routes link a bus to a college. Capture a student-facing bus number plus
-- the driver's basic details on the vehicle row. (RC number reuses the existing
-- vehicles.registration_no; agency_service_id is already nullable.)
alter table vehicles add column if not exists bus_number text;
alter table vehicles add column if not exists driver_name text;
alter table vehicles add column if not exists driver_photo_url text;
alter table vehicles add column if not exists driver_email text;
alter table vehicles add column if not exists driver_phone text;
