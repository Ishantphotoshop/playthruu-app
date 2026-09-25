-- ============================================================
-- USAGE TIME — run once in the Supabase SQL Editor.
-- Safe to run more than once.
-- ============================================================
--
-- Depends on 2026-09-02_admin_toolkit.sql (it uses is_app_admin()).
-- Run that one first if you haven't.
--
-- Adds one thing the admin build asked for: how many hours each
-- account has spent in the app, total, visible only to admins.
--
-- Same privacy shape as user_presence (2026-09-02_presence_and_
-- moderation.sql) and for the same reason: a running total lives in
-- its own table with a narrow read policy rather than as a column on
-- profiles, which has a blanket public-read policy. A column there
-- would publish everyone's usage to every other user, and to anyone
-- holding the anon key, whether or not any screen showed it.

create table if not exists public.user_usage (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  total_seconds bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.user_usage enable row level security;

drop policy if exists user_usage_read on public.user_usage;
create policy user_usage_read
  on public.user_usage for select
  using (auth.uid() = user_id or public.is_app_admin());

-- Insert and update are separate policies for the same reason
-- user_presence splits them: the app upserts (bump_usage does the
-- insert-or-update itself, below), and a FOR ALL policy would also
-- hand out DELETE for no reason.
drop policy if exists user_usage_own_insert on public.user_usage;
create policy user_usage_own_insert
  on public.user_usage for insert
  with check (auth.uid() = user_id);

drop policy if exists user_usage_own_update on public.user_usage;
create policy user_usage_own_update
  on public.user_usage for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- The client never writes total_seconds directly — it calls this with
-- however many seconds of foreground time it just banked, and the
-- increment happens here, atomically, server-side. A plain upsert from
-- the client would REPLACE the row instead of adding to it, which is
-- wrong the moment two tabs or two devices are both open; doing the
-- add in one UPDATE statement is what makes concurrent callers safe.
--
-- security invoker (the default, stated for clarity): this runs as
-- the calling user, so it rides the same own-row RLS policies above —
-- nobody can bump a total that isn't auth.uid()'s own. The 300s clamp
-- (5x the app's 60s heartbeat) is the one guard against a client
-- sending an inflated number in a single call; it silently drops
-- anything outside 1..300 rather than erroring, matching how
-- touchPresence treats a failed write as none of the user's business.
create or replace function public.bump_usage(p_seconds integer)
returns void
language plpgsql
security invoker
as $$
begin
  if p_seconds is null or p_seconds < 1 or p_seconds > 300 then
    return;
  end if;
  insert into public.user_usage (user_id, total_seconds, updated_at)
  values (auth.uid(), p_seconds, now())
  on conflict (user_id) do update
    set total_seconds = public.user_usage.total_seconds + excluded.total_seconds,
        updated_at = now();
end;
$$;

grant execute on function public.bump_usage(integer) to authenticated;

notify pgrst, 'reload schema';
