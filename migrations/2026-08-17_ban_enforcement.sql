-- ============================================================
-- BAN (SUSPEND) ENFORCEMENT — run once in the Supabase SQL Editor.
-- Safe to run more than once.
-- ============================================================
--
-- profiles.is_suspended already existed but nothing read it: flipping it
-- did nothing. This makes it real at the database level, which is the
-- only place that actually counts — a client-side block alone can be
-- bypassed by calling the API directly, so the ban has to live in RLS.
--
-- A suspended account can no longer CREATE or EDIT content: logs,
-- reviews, likes, follows, lists, list items, favourites, catalogue
-- entries, reports, or its own profile. It can still READ (so it can see
-- it's suspended) and still DELETE its own content (so a suspension is
-- never a data trap — people can remove their own things and, via the
-- separate delete-account flow, leave entirely). Blocking other users
-- also stays allowed, since that's a safety action, not abuse.
--
-- To suspend someone: set is_suspended = true on their profiles row.
-- To lift it: set it back to false. Enforcement is immediate on their
-- next write — no redeploy needed.

-- Is the CURRENT caller suspended? security definer so the policy can
-- read the flag regardless of the caller's own row-level visibility.
create or replace function public.is_suspended()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.is_suspended from public.profiles p where p.id = auth.uid()), false);
$$;

revoke all on function public.is_suspended() from public;
grant execute on function public.is_suspended() to authenticated;

-- --- logs -----------------------------------------------------------
drop policy if exists "logs_owner_insert" on public.logs;
create policy "logs_owner_insert" on public.logs
  for insert with check (auth.uid() = user_id and not public.is_suspended());
drop policy if exists "logs_owner_update" on public.logs;
create policy "logs_owner_update" on public.logs
  for update using (auth.uid() = user_id and not public.is_suspended());

-- --- log_likes ------------------------------------------------------
drop policy if exists "log_likes_owner_insert" on public.log_likes;
create policy "log_likes_owner_insert" on public.log_likes
  for insert with check (auth.uid() = user_id and not public.is_suspended());

-- --- follows --------------------------------------------------------
drop policy if exists "follows_owner_insert" on public.follows;
create policy "follows_owner_insert" on public.follows
  for insert with check (auth.uid() = follower_id and not public.is_suspended());

-- --- lists ----------------------------------------------------------
drop policy if exists "lists_owner_insert" on public.lists;
create policy "lists_owner_insert" on public.lists
  for insert with check (auth.uid() = user_id and not public.is_suspended());
drop policy if exists "lists_owner_update" on public.lists;
create policy "lists_owner_update" on public.lists
  for update using (auth.uid() = user_id and not public.is_suspended());

-- --- list_items -----------------------------------------------------
drop policy if exists "list_items_owner_insert" on public.list_items;
create policy "list_items_owner_insert" on public.list_items
  for insert with check (
    exists (select 1 from public.lists where lists.id = list_items.list_id and lists.user_id = auth.uid())
    and not public.is_suspended()
  );
drop policy if exists "list_items_owner_update" on public.list_items;
create policy "list_items_owner_update" on public.list_items
  for update using (
    exists (select 1 from public.lists where lists.id = list_items.list_id and lists.user_id = auth.uid())
    and not public.is_suspended()
  );

-- --- favorite_games -------------------------------------------------
drop policy if exists "favorite_games_owner_insert" on public.favorite_games;
create policy "favorite_games_owner_insert" on public.favorite_games
  for insert with check (auth.uid() = user_id and not public.is_suspended());
drop policy if exists "favorite_games_owner_update" on public.favorite_games;
create policy "favorite_games_owner_update" on public.favorite_games
  for update using (auth.uid() = user_id and not public.is_suspended());

-- --- games (catalogue entries the app adds/enriches) ----------------
drop policy if exists "games_authenticated_insert" on public.games;
create policy "games_authenticated_insert" on public.games
  for insert with check (auth.uid() is not null and added_by = auth.uid() and not public.is_suspended());

-- --- reports --------------------------------------------------------
drop policy if exists "reports_owner_insert" on public.reports;
create policy "reports_owner_insert" on public.reports
  for insert with check (auth.uid() = reporter_id and not public.is_suspended());

-- --- profiles (block edits; changing username/bio while banned is a
--     common evasion, so the profile freezes too) ---------------------
drop policy if exists "profiles_owner_update" on public.profiles;
create policy "profiles_owner_update" on public.profiles
  for update using (auth.uid() = id and not public.is_suspended());

notify pgrst, 'reload schema';
