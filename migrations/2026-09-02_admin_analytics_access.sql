-- ============================================================
-- ADMIN ANALYTICS ACCESS — run once in the Supabase SQL Editor.
-- Safe to run more than once.
-- ============================================================
--
-- Depends on 2026-09-02_admin_toolkit.sql (it uses is_app_admin()).
--
-- The admin dashboard counts and breaks down logs, lists and the
-- waitlist. Read access to each is currently narrower than that needs:
--
--   logs      — readable only when is_public or your own, so private
--               logs would silently drop out of every total and chart.
--   lists     — same public-or-own rule.
--   waitlist  — has an INSERT policy and no SELECT policy at all, so
--               right now NOBODY can read it, admins included.
--
-- These add an admin-only read path to each (and a delete on lists, so
-- an abusive list can be removed the way a comment already can). None of
-- them widen what a normal user sees — every policy is gated on
-- is_app_admin(), which is false for everyone but you.

-- Analytics should reflect all activity, not just the public slice.
drop policy if exists logs_admin_read on public.logs;
create policy logs_admin_read
  on public.logs for select
  using (public.is_app_admin());

drop policy if exists lists_admin_read on public.lists;
create policy lists_admin_read
  on public.lists for select
  using (public.is_app_admin());

drop policy if exists lists_admin_delete on public.lists;
create policy lists_admin_delete
  on public.lists for delete
  using (public.is_app_admin());

-- list_items already reads "via list", but that check only passes for a
-- list you can already see. An admin viewing any list needs its items
-- too, so this mirrors the list-level admin read.
drop policy if exists list_items_admin_read on public.list_items;
create policy list_items_admin_read
  on public.list_items for select
  using (public.is_app_admin());

-- The waitlist is the app owner's own signup list; reading it is exactly
-- what an admin panel is for. Still admin-only — a normal user can add
-- their email (the existing insert policy) but not read anyone else's.
drop policy if exists waitlist_admin_read on public.waitlist;
create policy waitlist_admin_read
  on public.waitlist for select
  using (public.is_app_admin());

-- A sentinel the admin app can read to know this migration ran. Unlike
-- the earlier two, this one only adds policies — no new table to probe
-- for — so without a marker the setup screen couldn't tell whether it
-- had been applied. app_settings is public-read, so the check is cheap.
insert into public.app_settings (key, value)
values ('analytics_ready', 'true'::jsonb)
on conflict (key) do nothing;

notify pgrst, 'reload schema';
