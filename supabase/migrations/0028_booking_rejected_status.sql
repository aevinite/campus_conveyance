-- 0028_booking_rejected_status.sql (idempotent)
-- Agency rejections get their own terminal status. reject_booking used to set
-- CANCELLED — the same value a student cancellation writes — so the dashboard's
-- "Rejected" count was permanently 0 and the two were indistinguishable.
-- Kept alone in this file: the new enum value must be committed in its own
-- transaction before any later statement can use it.
alter type booking_status add value if not exists 'REJECTED';
