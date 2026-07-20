-- 0066_agencies_sort_index.sql (idempotent)
-- The admin Manage Providers list filters status + is_deleted then ORDER BY name
-- (listAgencies). Small population today, but add the matching composite index so
-- it doesn't seq-scan + sort as providers grow (mirrors the profiles/institutions
-- sort indexes in 0065).
create index if not exists idx_agencies_status_deleted_name
  on agencies (status, is_deleted, name);
