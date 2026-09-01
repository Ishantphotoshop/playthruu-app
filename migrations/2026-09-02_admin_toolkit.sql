-- ============================================================
-- ADMIN TOOLKIT — run once in the Supabase SQL Editor.
-- Safe to run more than once.
-- ============================================================
--
-- Everything the "PlayThruu Admin" build needs in order to curate the
-- app by hand instead of leaving every surface on autopilot:
--
--   curated_trending  — hand-picked games for "Trending now", which
--                       otherwise comes straight off IGDB's live
--                       popularity feed with no say in it.
--   custom_news       — your own posts in the News tab, which is
--                       otherwise a passthrough of five RSS feeds.
--   announcements     — a banner across the top of everyone's feed.
--   app_settings      — small key/value knobs (e.g. whether curated
--                       trending replaces the IGDB list or just leads it).
--
-- The security model is the same one the rest of the app already uses:
-- nothing here trusts the client. The admin app ships the ordinary
-- public anon key and every table below is protected by RLS that checks
-- profiles.is_admin for the CALLING user, so a non-admin who finds the
-- admin URL can load the page and still not write a single row.
--
-- profiles.is_admin and profiles.is_suspended already existed (see
-- 2026-08-14_security_hardening.sql and 2026-08-17_ban_enforcement.sql)
-- — this migration doesn't invent the admin concept, it just gives it
-- something to control.

-- ------------------------------------------------------------
-- Admin check helper
-- ------------------------------------------------------------
-- The existing reports policy inlines this same EXISTS clause. It's
-- repeated a dozen more times below, so it becomes a function here.
-- SECURITY DEFINER is safe in this shape specifically: it takes no
-- arguments and only ever reports on auth.uid() — the caller's own row
-- — so there's no way to ask it about somebody else. search_path is
-- pinned so the function can't be redirected at a shadowed table.
create or replace function public.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_admin
  );
$$;

revoke all on function public.is_app_admin() from public;
grant execute on function public.is_app_admin() to authenticated, anon;

-- ------------------------------------------------------------
-- Curated "Trending now"
-- ------------------------------------------------------------
create table if not exists public.curated_trending (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  unique (game_id)
);

create index if not exists curated_trending_position_idx
  on public.curated_trending (position);

alter table public.curated_trending enable row level security;

drop policy if exists curated_trending_public_read on public.curated_trending;
create policy curated_trending_public_read
  on public.curated_trending for select
  using (true);

drop policy if exists curated_trending_admin_write on public.curated_trending;
create policy curated_trending_admin_write
  on public.curated_trending for all
  using (public.is_app_admin())
  with check (public.is_app_admin());

-- ------------------------------------------------------------
-- Custom news posts
-- ------------------------------------------------------------
create table if not exists public.custom_news (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  summary text,
  image_url text,
  -- Shown where an RSS article shows its outlet name, so it reads as a
  -- real byline rather than an untitled post.
  source text not null default 'PlayThruu',
  link text,
  published_at timestamptz not null default now(),
  is_published boolean not null default true,
  -- Pinned posts sort above the RSS feed; unpinned ones merge into it
  -- by date like any other article.
  pinned boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null
);

create index if not exists custom_news_published_idx
  on public.custom_news (is_published, published_at desc);

alter table public.custom_news enable row level security;

-- Drafts (is_published = false) stay invisible to everyone but admins,
-- so a half-written post can be saved without going live.
drop policy if exists custom_news_public_read on public.custom_news;
create policy custom_news_public_read
  on public.custom_news for select
  using (is_published or public.is_app_admin());

drop policy if exists custom_news_admin_write on public.custom_news;
create policy custom_news_admin_write
  on public.custom_news for all
  using (public.is_app_admin())
  with check (public.is_app_admin());

drop trigger if exists custom_news_set_updated_at on public.custom_news;
create trigger custom_news_set_updated_at
  before update on public.custom_news
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- Feed announcement banner
-- ------------------------------------------------------------
create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  message text not null,
  link text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null
);

alter table public.announcements enable row level security;

drop policy if exists announcements_public_read on public.announcements;
create policy announcements_public_read
  on public.announcements for select
  using (is_active or public.is_app_admin());

drop policy if exists announcements_admin_write on public.announcements;
create policy announcements_admin_write
  on public.announcements for all
  using (public.is_app_admin())
  with check (public.is_app_admin());

-- ------------------------------------------------------------
-- App settings (key/value knobs)
-- ------------------------------------------------------------
create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

alter table public.app_settings enable row level security;

drop policy if exists app_settings_public_read on public.app_settings;
create policy app_settings_public_read
  on public.app_settings for select
  using (true);

drop policy if exists app_settings_admin_write on public.app_settings;
create policy app_settings_admin_write
  on public.app_settings for all
  using (public.is_app_admin())
  with check (public.is_app_admin());

-- 'replace' = the curated list IS Trending now (IGDB only fills any
-- remaining slots). 'lead' = curated games sit in front of the live
-- IGDB list. Default 'lead' so adding one game doesn't blank the row.
insert into public.app_settings (key, value)
values ('trending_mode', '"lead"'::jsonb)
on conflict (key) do nothing;

-- ------------------------------------------------------------
-- Let admins moderate people and reports
-- ------------------------------------------------------------
-- profiles already had an owner-only update policy, which is what an
-- admin panel runs into the moment it tries to suspend somebody else.
-- This is additive: the existing profiles_owner_update still covers
-- everyone editing their own profile.
drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update
  on public.profiles for update
  using (public.is_app_admin())
  with check (public.is_app_admin());

-- reports could already be READ by admins; resolving one needs update.
drop policy if exists reports_admin_update on public.reports;
create policy reports_admin_update
  on public.reports for update
  using (public.is_app_admin())
  with check (public.is_app_admin());

-- games.is_hidden has existed since the IGDB migration but nothing ever
-- set it. The admin app uses it to pull a game out of search/trending
-- without deleting the row (and everyone's existing logs of it).
drop policy if exists games_admin_delete on public.games;
create policy games_admin_delete
  on public.games for delete
  using (public.is_app_admin());

notify pgrst, 'reload schema';
