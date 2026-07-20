-- 0057_drop_legacy_link_child.sql (idempotent)
-- Remove the dead email-based parent linking RPC. Parents now link a child via
-- the one-time 6-digit code flow (create_parent_link_code / redeem_parent_link_code
-- from 0050); link_child(email) has no caller left (its TS action was removed).
drop function if exists public.link_child(text);
