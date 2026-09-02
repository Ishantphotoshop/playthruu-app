-- ============================================================
-- PRESENCE + COMMENT MODERATION — run once in the Supabase SQL Editor.
-- Safe to run more than once.
-- ============================================================
--
-- Depends on 2026-09-02_admin_toolkit.sql (it uses is_app_admin()).
-- Run that one first if you haven't.
--
-- Adds two things the admin build asked for:
--
--   user_presence — when each person was last active, so the admin app
--                   can show "online now" or "seen 20m ago".
--   a comments delete policy for admins, so an abusive comment can
--   actually be removed. Until now only the comment's own author could
--   delete it, which is the one person who won't.

-- ------------------------------------------------------------
-- Presence
-- ------------------------------------------------------------
-- A separate table rather than a last_seen_at column on profiles, and
-- that is a privacy decision, not a modelling one: profiles has a
-- blanket public-read policy, so a column there would publish
-- everyone's activity times to every other user (and to anyone holding
-- the anon key) whether or not any screen displayed it. Here the read
-- policy is narrow — you can see your own, admins can see everybody's —
-- so "who was online" stays an admin capability rather than becoming a
-- feature of the public API by accident.
create table if not exists public.user_presence (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  last_seen_at timestamptz not null default now()
);

create index if not exists user_presence_last_seen_idx
  on public.user_presence (last_seen_at desc);

alter table public.user_presence enable row level security;

drop policy if exists user_presence_read on public.user_presence;
create policy user_presence_read
  on public.user_presence for select
  using (auth.uid() = user_id or public.is_app_admin());

-- Insert and update are separate policies because the app upserts:
-- the first heartbeat of a new account inserts, every one after
-- updates, and a FOR ALL policy would also hand out DELETE for no
-- reason.
drop policy if exists user_presence_own_insert on public.user_presence;
create policy user_presence_own_insert
  on public.user_presence for insert
  with check (auth.uid() = user_id);

drop policy if exists user_presence_own_update on public.user_presence;
create policy user_presence_own_update
  on public.user_presence for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ------------------------------------------------------------
-- Comment moderation
-- ------------------------------------------------------------
-- comments already had public read, owner insert and owner delete.
-- Reports can point at a comment, so without this an admin could read
-- the report and then have no way to act on it.
drop policy if exists comments_admin_delete on public.comments;
create policy comments_admin_delete
  on public.comments for delete
  using (public.is_app_admin());

notify pgrst, 'reload schema';
