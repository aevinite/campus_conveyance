# Supabase Setup (do this once)

The app needs a Supabase project for the database and authentication. It's free.

## 1. Create the project
1. Go to <https://supabase.com> → sign in → **New project**.
2. Give it a name (e.g. `campus-conveyance`), set a database password, pick a region close to you, **Create**.
3. Wait ~2 minutes for it to provision.

## 2. Copy your keys
In the project: **Settings → API**. Copy:
- **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
- **anon / public** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- **service_role** key (under *Project API keys*, click reveal) → `SUPABASE_SERVICE_ROLE_KEY`

Then in the repo:
```bash
cp .env.example .env.local
```
Paste the three values into `.env.local`. Leave `NEXT_PUBLIC_SITE_URL` as `http://localhost:3000` for local dev.

> The service_role key is secret — it bypasses RLS. `.env.local` is git-ignored; never commit it.

## 3. Run the migrations
In Supabase: **SQL Editor → New query**. Open `supabase/migrations/0001_init.sql`, paste its full contents, **Run**. Then do the same with `supabase/migrations/0002_rls.sql`.

## 4. Enable the access-token hook (this is what makes multi-tenant isolation work)
**Authentication → Hooks** (sometimes under *Auth → Hooks*):
1. Find **Customize Access Token (JWT) Claims**.
2. Enable it.
3. Hook type: **Postgres**. Schema: `public`. Function: `custom_access_token_hook`.
4. Save.

This injects each user's `institution_id` and `role` into their login token, which the database's security rules read to keep one school's data invisible to another.

## 5. Set the Site URL
**Authentication → URL Configuration** → set **Site URL** to `http://localhost:3000` and add `http://localhost:3000/auth/callback` to **Redirect URLs**.

## 6. Run the app
```bash
npm run dev
```
Open <http://localhost:3000>, register an account, confirm the email Supabase sends, and log in.
