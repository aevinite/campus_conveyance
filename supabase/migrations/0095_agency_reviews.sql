-- 0095_agency_reviews.sql (idempotent — requires 0001, 0004, 0005, 0008)
--
-- Agency ratings & reviews. A student who has a CONFIRMED booking with an agency
-- (a real paying rider) can leave a 1–5 star rating + optional comment. One
-- review per (agency, student) — editable, not stackable — to prevent spam. The
-- aggregate (avg + count) is denormalized onto `agencies` by a trigger so the
-- marketplace can show it without a join/roll-up on every browse.
--
-- Writes only ever happen through the SECURITY DEFINER RPCs here (students are
-- blocked from writing marketplace tables by RLS, like the booking flow). Admin
-- moderation (hide/unhide) is a service-role write from the aevinite panel.

-- ---------------------------------------------------------------------------
-- (1) Denormalized aggregate on agencies (world-readable via agencies_read).
-- ---------------------------------------------------------------------------
alter table public.agencies add column if not exists rating_avg   numeric(3,2) not null default 0;
alter table public.agencies add column if not exists rating_count int          not null default 0;

-- ---------------------------------------------------------------------------
-- (2) reviews table. One per (agency, student); booking_id is provenance.
-- ---------------------------------------------------------------------------
create table if not exists public.reviews (
  id         uuid primary key default gen_random_uuid(),
  agency_id  uuid not null references public.agencies(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete set null,
  rating     int  not null check (rating between 1 and 5),
  comment    text,
  is_hidden  boolean not null default false,   -- admin moderation flag
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agency_id, student_id)
);
create index if not exists idx_reviews_agency_visible
  on public.reviews (agency_id) where is_hidden = false;
create index if not exists idx_reviews_student on public.reviews (student_id);
create index if not exists idx_reviews_created on public.reviews (created_at desc);

drop trigger if exists trg_reviews_updated on public.reviews;
create trigger trg_reviews_updated before update on public.reviews
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- (3) RLS. Reads only; every write goes through the definer RPCs below.
-- ---------------------------------------------------------------------------
alter table public.reviews enable row level security;
-- Anyone signed in can read visible reviews (marketplace + agency panel).
drop policy if exists reviews_public_read on public.reviews;
create policy reviews_public_read on public.reviews for select to authenticated
  using (is_hidden = false);
-- A student can always read their OWN review (even if hidden) to prefill/edit.
drop policy if exists reviews_own_read on public.reviews;
create policy reviews_own_read on public.reviews for select to authenticated
  using (student_id in (select id from students where profile_id = auth.uid()));
-- No insert/update/delete policies on purpose → direct writes denied.

-- ---------------------------------------------------------------------------
-- (4) Aggregate maintenance. Recompute the owning agency's avg + count from its
--     VISIBLE reviews on every change (incl. an admin hide/unhide).
-- ---------------------------------------------------------------------------
create or replace function public.reviews_recount() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_agency uuid;
begin
  v_agency := coalesce(new.agency_id, old.agency_id);
  update agencies a
     set rating_count = sub.cnt,
         rating_avg   = sub.avg
    from (
      select count(*)                                as cnt,
             coalesce(round(avg(rating)::numeric, 2), 0) as avg
        from reviews
       where agency_id = v_agency and is_hidden = false
    ) sub
   where a.id = v_agency;
  return null;
end; $$;
drop trigger if exists trg_reviews_recount on public.reviews;
create trigger trg_reviews_recount
  after insert or update or delete on public.reviews
  for each row execute function public.reviews_recount();

-- ---------------------------------------------------------------------------
-- (5) submit_review — upsert the caller's review, gated on a CONFIRMED booking
--     with that agency. Re-derives the caller via auth.uid(); never trusts input
--     for identity. Does NOT reset is_hidden on edit (moderation persists).
-- ---------------------------------------------------------------------------
create or replace function public.submit_review(p_agency_id uuid, p_rating int, p_comment text)
returns public.reviews
language plpgsql security definer set search_path = public as $$
declare v_student uuid; v_booking uuid; v_row public.reviews;
begin
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Rating must be between 1 and 5.' using errcode = 'P0001';
  end if;
  select id into v_student from students where profile_id = auth.uid() limit 1;
  if v_student is null then
    raise exception 'Only a signed-in rider can review.' using errcode = 'P0003';
  end if;
  -- Eligibility: a CONFIRMED booking on a route belonging to this agency.
  select b.id into v_booking
    from bookings b
    join routes r on r.id = b.route_id
   where b.student_id = v_student
     and r.agency_id = p_agency_id
     and b.status = 'CONFIRMED'
   order by b.created_at desc
   limit 1;
  if v_booking is null then
    raise exception 'You can review an agency only after a confirmed booking with them.'
      using errcode = 'P0004';
  end if;

  insert into reviews (agency_id, student_id, booking_id, rating, comment)
  values (p_agency_id, v_student, v_booking, p_rating,
          nullif(btrim(coalesce(p_comment, '')), ''))
  on conflict (agency_id, student_id) do update
     set rating     = excluded.rating,
         comment    = excluded.comment,
         booking_id = excluded.booking_id,
         updated_at = now()
  returning * into v_row;
  return v_row;
end; $$;
revoke all on function public.submit_review(uuid, int, text) from public;
grant execute on function public.submit_review(uuid, int, text) to authenticated;

-- ---------------------------------------------------------------------------
-- (6) delete_my_review — a rider removes their own review.
-- ---------------------------------------------------------------------------
create or replace function public.delete_my_review(p_agency_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_student uuid;
begin
  select id into v_student from students where profile_id = auth.uid() limit 1;
  if v_student is null then return; end if;
  delete from reviews where agency_id = p_agency_id and student_id = v_student;
end; $$;
revoke all on function public.delete_my_review(uuid) from public;
grant execute on function public.delete_my_review(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- (7) agency_reviews — the owning agency (or an admin) lists its reviews WITH
--     the reviewer's first name (taken from the booking's student_name, which is
--     already stored, avoiding a profiles RLS dependency).
-- ---------------------------------------------------------------------------
create or replace function public.agency_reviews(p_agency_id uuid, p_limit int default 50, p_offset int default 0)
returns table (id uuid, rating int, comment text, created_at timestamptz, reviewer text)
language plpgsql security definer set search_path = public as $$
begin
  if not (public.jwt_role() = 'SUPER_ADMIN'
          or exists (select 1 from agencies a
                      where a.id = p_agency_id and a.owner_profile_id = auth.uid())) then
    raise exception 'Not authorized' using errcode = 'P0003';
  end if;
  return query
    select rv.id, rv.rating, rv.comment, rv.created_at,
           coalesce(nullif(split_part(coalesce(b.student_name, ''), ' ', 1), ''), 'Rider') as reviewer
      from reviews rv
      left join bookings b on b.id = rv.booking_id
     where rv.agency_id = p_agency_id and rv.is_hidden = false
     order by rv.created_at desc
     limit greatest(1, least(coalesce(p_limit, 50), 100))
    offset greatest(coalesce(p_offset, 0), 0);
end; $$;
revoke all on function public.agency_reviews(uuid, int, int) from public;
grant execute on function public.agency_reviews(uuid, int, int) to authenticated;
