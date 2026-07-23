-- Index cleanup after 0077 + fill remaining unindexed cascade FKs.

-- 0077 added UNIQUE indexes on the same columns as these plain indexes, which now
-- fully serve every lookup the old ones did — drop the redundant duplicates
-- (they only cost write + storage overhead).
--   uq_vehicles_driver            shadows idx_vehicles_driver           (0022)
--   uq_seat_allocations_assignment shadows idx_seat_allocations_assignment (0006)
--   uq_route_assignments_route     shadows idx_route_assignments_route     (0006)
drop index if exists idx_vehicles_driver;
drop index if exists idx_seat_allocations_assignment;
drop index if exists idx_route_assignments_route;

-- parent_link_codes cascade FKs are unindexed → deleting a student/parent
-- seq-scans this table. (parent_students(student_id) is already covered by
-- idx_parent_students_student from 0061.)
create index if not exists idx_parent_link_codes_student on parent_link_codes(student_id);
create index if not exists idx_parent_link_codes_used_by on parent_link_codes(used_by);

-- agency_hidden_students.student_id: PK is (agency_id, student_id) so student_id
-- alone is unindexed → a hard student delete / the 0074 de-dupe seq-scans it.
create index if not exists idx_agency_hidden_students_student
  on agency_hidden_students(student_id);
