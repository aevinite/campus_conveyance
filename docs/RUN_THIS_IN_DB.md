# What to run in your Supabase database

You host the database in your own Supabase account — this project never connects
to it. After pulling these changes, run the SQL below in your Supabase
**SQL Editor** (Dashboard → SQL Editor → New query).

## 1. Run the migrations in order

If your database is brand new, run every migration once, in this order:

1. `supabase/migrations/0001_init.sql`
2. `supabase/migrations/0002_rls.sql`
3. `supabase/migrations/0003_booking.sql`
4. `supabase/migrations/0004_marketplace.sql`
5. `supabase/migrations/0005_panels.sql`  ← **new (admin + agency panels)**

If your database already has 0001–0004 applied, you only need to run
**`0005_panels.sql`**. Every statement is idempotent, so re-running is safe.

> `0005` also re-defines `handle_new_user`, `reserve_seat` and `cancel_booking`.
> That is intentional — it switches bookings to the agency-approval flow
> (a reservation is held as **PENDING** until the agency confirms/rejects) and
> makes an **AGENCY** signup auto-create a pending agency row.

## 2. Enable the access-token hook (once)

Dashboard → **Authentication → Hooks → Customize Access Token (JWT)** →
select the function `custom_access_token_hook`. (Already required by 0002; skip
if you did this before.) This injects the `role` claim used by every panel.

## 3. Create your admin (SUPER_ADMIN)

There is **no public admin signup**. Make yourself admin like this:

1. Register a normal account in the app (any role) with the email you want to
   use as admin, and confirm it.
2. Run this once, replacing the email:

   ```sql
   update profiles
   set role = 'SUPER_ADMIN'
   where id = (select id from auth.users where email = 'YOUR_EMAIL@example.com');
   ```

3. **Log out and back in** (the role lives in the JWT, which only refreshes on a
   new login). Then open `/admin/login`.

## Quick test flow

1. `/agency/register` → submit an agency application (it becomes **PENDING**).
2. `/admin/login` → **Service Provider Requests** → **Accept**.
3. Log in as the agency at `/agency/login` → add a **Transport service**, a
   **Bus**, then a **Route** (this creates seats automatically).
4. As a student, browse and reserve a seat → it shows **Pending**.
5. Back in the agency → **Manage Booking** → **Confirm** (or **Reject** to free
   the seat).
