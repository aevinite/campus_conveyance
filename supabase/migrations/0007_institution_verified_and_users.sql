-- 0007_institution_verified_and_users.sql (idempotent)
--
-- Merged from two files that both carried the "0007" prefix
-- (0007_institution_verified.sql + 0007_users_table.sql). Duplicate numeric
-- prefixes let a migration runner keyed on the number apply only one of the two
-- and silently skip the other, so they're combined here into a single 0007. The
-- two parts are independent; order within the file does not matter.

-- ── Part A: institution "verified" trust flag ────────────────────────────────
-- A verified school/college shows a green tick to students. Purely a display
-- flag: it does NOT change visibility (that's is_active), so RLS is unchanged.
alter table institutions
  add column if not exists is_verified boolean not null default false;

-- ── Part B: dedicated `users` table for STUDENT/PARENT profiles ───────────────
-- A dedicated `users` table for end-users who sign up through the user interface,
-- i.e. profiles whose role is STUDENT or PARENT. It mirrors the relevant profile
-- columns and is kept in sync automatically by a trigger on `profiles`, so it
-- always reflects exactly the student/parent accounts. Idempotent (safe to re-run).

create table if not exists public.users (
  id          uuid primary key references public.profiles(id) on delete cascade,
  email       text,
  full_name   text,
  phone       text,
  role        public.user_role not null,
  is_deleted  boolean not null default false,
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_users_email on public.users(lower(email));

-- Keep public.users holding exactly the STUDENT/PARENT profiles: insert/update
-- when a profile is (or becomes) a student/parent, remove it otherwise.
create or replace function public.sync_users_from_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'DELETE') then
    delete from public.users where id = old.id;
    return old;
  end if;

  if new.role in ('STUDENT','PARENT') then
    insert into public.users (id, email, full_name, phone, role, is_deleted, deleted_at, created_at, updated_at)
    values (new.id, new.email, new.full_name, new.phone, new.role, new.is_deleted, new.deleted_at, new.created_at, now())
    on conflict (id) do update set
      email      = excluded.email,
      full_name  = excluded.full_name,
      phone      = excluded.phone,
      role       = excluded.role,
      is_deleted = excluded.is_deleted,
      deleted_at = excluded.deleted_at,
      updated_at = now();
  else
    -- role was changed away from student/parent → it no longer belongs here
    delete from public.users where id = new.id;
  end if;
  return new;
end; $$;

drop trigger if exists trg_sync_users on public.profiles;
create trigger trg_sync_users
  after insert or update or delete on public.profiles
  for each row execute function public.sync_users_from_profile();

-- Backfill any existing student/parent accounts.
insert into public.users (id, email, full_name, phone, role, is_deleted, deleted_at, created_at, updated_at)
select id, email, full_name, phone, role, is_deleted, deleted_at, created_at, now()
from public.profiles
where role in ('STUDENT','PARENT')
on conflict (id) do nothing;

-- RLS: only the owner can read their own row from the client; the server
-- (service role) and the SECURITY DEFINER sync trigger bypass RLS. The Supabase
-- dashboard (service role) sees every row.
alter table public.users enable row level security;
drop policy if exists users_self_select on public.users;
create policy users_self_select on public.users
  for select using (auth.uid() = id);
