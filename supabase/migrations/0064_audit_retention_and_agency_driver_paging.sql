-- 0064_audit_retention_and_agency_driver_paging.sql (idempotent)
-- (renamed from *_driver_paging: this pages the AGENCY's driver roster; the
--  driver-PANEL paging is in 0063.)

-- (2) audit_logs: every log-page view did a global ORDER BY created_at DESC +
-- count:'exact' with NO created_at index (only idx_audit_institution on
-- (institution_id, created_at)) → seq-scan + sort on a table that grows with
-- every admin action forever. Add the sort index + a retention sweep so the
-- table (and the exact count) stays bounded.
create index if not exists idx_audit_created_at on audit_logs (created_at desc);

-- Extend the daily retention sweep (function from 0061; the
-- 'data-retention-cleanup' cron already calls it) to also age out old audit
-- logs. 180 days keeps a useful trail while bounding growth.
create or replace function public.retention_cleanup() returns void
language sql security definer set search_path = public as $$
  delete from ride_events where created_at < now() - interval '90 days';
  delete from notifications
    where created_at < now() - interval '90 days'
       or (is_read = true and created_at < now() - interval '30 days');
  delete from parent_link_codes where expires_at < now() - interval '1 day';
  delete from audit_logs where created_at < now() - interval '180 days';
$$;

-- (1) Agency drivers & deleted-drivers pages loaded the ENTIRE roster via
-- agency_drivers and split is_deleted in JS — the last unpaginated agency list.
-- Add a paginated, is_deleted-filtered variant + count (mirrors the buses page),
-- backed by an index on (agency_id, is_deleted, created_at desc).
create index if not exists idx_drivers_agency_deleted_created
  on drivers (agency_id, is_deleted, created_at desc);

create or replace function public.agency_drivers_page(
  p_agency_id uuid, p_deleted boolean, p_limit int default null, p_offset int default 0
)
returns table (
  driver_id uuid, profile_id uuid, name text, email text, phone text,
  license_no text, aadhaar_no text, address text, blood_group text, dob date, alt_phone text,
  is_active boolean, is_deleted boolean, created_at timestamptz
) language sql stable security definer set search_path = public as $$
  select d.id, d.profile_id, pr.full_name, pr.email, pr.phone,
         d.license_no, d.aadhaar_no, d.address, d.blood_group, d.dob, d.alt_phone,
         d.is_active, d.is_deleted, d.created_at
  from drivers d
  left join profiles pr on pr.id = d.profile_id
  where d.agency_id = p_agency_id
    and d.is_deleted = p_deleted
    and exists (select 1 from agencies a where a.id = p_agency_id and a.owner_profile_id = auth.uid())
  order by d.created_at desc
  limit p_limit offset coalesce(p_offset, 0);
$$;
grant execute on function public.agency_drivers_page(uuid, boolean, int, int) to authenticated;

create or replace function public.agency_drivers_count(p_agency_id uuid, p_deleted boolean)
returns bigint language sql stable security definer set search_path = public as $$
  select count(*)
  from drivers d
  where d.agency_id = p_agency_id
    and d.is_deleted = p_deleted
    and exists (select 1 from agencies a where a.id = p_agency_id and a.owner_profile_id = auth.uid());
$$;
grant execute on function public.agency_drivers_count(uuid, boolean) to authenticated;
