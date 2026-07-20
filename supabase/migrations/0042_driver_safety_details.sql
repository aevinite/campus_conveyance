-- 0042_driver_safety_details.sql (idempotent)
-- Richer driver profile so parents/students can see the bus is driven by a
-- verified, identifiable person — not just a licence number. All optional except
-- the pre-existing name/phone/licence. Government ID is stored in full but shown
-- MASKED to riders (last 4 only) in the app for privacy.
alter table vehicles add column if not exists driver_govt_id text;        -- Aadhaar / govt ID card no.
alter table vehicles add column if not exists driver_address text;        -- residential address
alter table vehicles add column if not exists driver_alt_phone text;      -- alternate / emergency contact
alter table vehicles add column if not exists driver_dob date;            -- date of birth
alter table vehicles add column if not exists driver_blood_group text;    -- blood group (emergencies)
alter table vehicles add column if not exists driver_verified boolean not null default false; -- background-verified
