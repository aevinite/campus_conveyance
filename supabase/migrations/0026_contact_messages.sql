-- 0026_contact_messages.sql (idempotent)
-- Landing-page "Contact Us" inquiries. Rows are written by the server with the
-- service-role client (the sender is an anonymous visitor); only the platform
-- admin can read/manage them.
create table if not exists contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  phone text,
  organization text,
  message text not null,
  status text not null default 'NEW',
  created_at timestamptz not null default now()
);
create index if not exists idx_contact_messages_created
  on contact_messages (created_at desc);

alter table contact_messages enable row level security;
drop policy if exists contact_messages_admin on contact_messages;
create policy contact_messages_admin on contact_messages for all
  using (public.jwt_role() = 'SUPER_ADMIN')
  with check (public.jwt_role() = 'SUPER_ADMIN');
