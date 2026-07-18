-- 0013_bus_ac.sql (idempotent)
-- Whether a bus is air-conditioned. Single choice (AC / Non-AC), shown to students.
alter table vehicles add column if not exists is_ac boolean not null default false;
