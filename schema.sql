-- ============================================================
-- QUESTLOG — Database schema for Supabase (Postgres)
-- ============================================================
-- HOW TO USE:
-- 1. Open your Supabase project → SQL Editor → New query
-- 2. Paste this entire file and click "Run"
-- 3. That's it — tables, security rules, and triggers are all set up.
-- Safe to re-run on a fresh project. Do not run twice on the same
-- project without dropping tables first (it will error on the
-- second run because things already exist — that's fine, it means
-- it worked the first time).
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- TABLES
-- ------------------------------------------------------------

-- One row per user, mirrors auth.users, holds public profile info
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  username text unique not null,
  display_name text,
  avatar_url text,
  bio text,
  pronouns text,
  pronouns_custom text,
  comment_permission text check (comment_permission in ('anyone','friends','no_one','only_me')) default 'anyone' not null,
  created_at timestamptz default now()
);

-- NOTE: if you already have a games table from before, run the
-- migration block near the bottom of this file instead of this CREATE.
-- Shared catalog of games. Anyone can add a game; everyone reads the same list.
create table public.games (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  cover_url text,
  platform text,
  release_year int,
  release_date date,
  genre text,
  developer text,
  publisher text,
  description text,
  background_url text,
  rawg_id integer unique,          -- legacy, from before the IGDB migration; kept so old rows still resolve
  steam_cover_url text,            -- legacy, unused since the IGDB migration (cover_url is now the IGDB cover)
  director_name text,              -- legacy, unused since the IGDB migration (see studio_name)
  director_rawg_id integer,        -- legacy, unused since the IGDB migration
  director_image_url text,         -- legacy, unused since the IGDB migration
  igdb_id integer unique,
  studio_id integer,
  studio_name text,
  studio_logo_url text,
  playtime_hours numeric(5,1),
  trailer_url text,
  players_count integer,
  rawg_enriched boolean default false not null,  -- legacy flag, unused since the IGDB migration
  igdb_enriched boolean default false not null,
  added_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now()
);

-- The core "diary entry": a user's relationship to a game at a point in time.
-- A user can have multiple logs for the same game (replays).
create table public.logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  game_id uuid references public.games(id) on delete cascade not null,
  rating numeric(2,1) check (rating is null or (rating >= 0.5 and rating <= 5)),
  review text,
  status text check (status in ('played','playing','backlog','dropped')) default 'played' not null,
  played_date date,
  is_replay boolean default false,
  contains_spoilers boolean default false,
  is_public boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Follow graph
create table public.follows (
  follower_id uuid references public.profiles(id) on delete cascade,
  following_id uuid references public.profiles(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (follower_id, following_id),
  constraint no_self_follow check (follower_id <> following_id)
);

-- Custom lists ("Best Roguelikes", "Cozy Games", etc.)
create table public.lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  name text not null,
  description text,
  is_public boolean default true,
  created_at timestamptz default now()
);

create table public.list_items (
  list_id uuid references public.lists(id) on delete cascade,
  game_id uuid references public.games(id) on delete cascade,
  position int default 0,
  note text,
  added_at timestamptz default now(),
  primary key (list_id, game_id)
);

-- Likes on a log/review
create table public.log_likes (
  user_id uuid references public.profiles(id) on delete cascade,
  log_id uuid references public.logs(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (user_id, log_id)
);

-- A user's Top 5 favorite games, in order. position 0-4, drag-reordered
-- in Settings. Deliberately separate from `lists` since it's a single
-- fixed-size, always-public showcase rather than an arbitrary list.
create table public.favorite_games (
  user_id uuid references public.profiles(id) on delete cascade,
  game_id uuid references public.games(id) on delete cascade,
  position int not null check (position >= 0 and position <= 4),
  created_at timestamptz default now(),
  primary key (user_id, position)
);

-- ------------------------------------------------------------
-- INDEXES (keep the feed/search snappy as data grows)
-- ------------------------------------------------------------
create index logs_user_id_idx on public.logs(user_id);
create index logs_game_id_idx on public.logs(game_id);
create index logs_created_at_idx on public.logs(created_at desc);
create index follows_follower_idx on public.follows(follower_id);
create index follows_following_idx on public.follows(following_id);
create index games_title_idx on public.games using gin (to_tsvector('english', title));
create index profiles_username_idx on public.profiles(username);

-- ------------------------------------------------------------
-- ROW LEVEL SECURITY
-- Everything defaults to "public can read public stuff, only the
-- owner can write their own stuff" — same trust model Letterboxd uses.
-- ------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.games enable row level security;
alter table public.logs enable row level security;
alter table public.follows enable row level security;
alter table public.lists enable row level security;
alter table public.list_items enable row level security;
alter table public.log_likes enable row level security;
alter table public.favorite_games enable row level security;

-- profiles
create policy "profiles_public_read" on public.profiles for select using (true);
create policy "profiles_owner_insert" on public.profiles for insert with check (auth.uid() = id);
create policy "profiles_owner_update" on public.profiles for update using (auth.uid() = id);

-- games (shared catalog — anyone logged in can add, nobody can delete from the client)
create policy "games_public_read" on public.games for select using (true);
create policy "games_authenticated_insert" on public.games for insert with check (auth.uid() is not null);
-- Lets enrichGameDetails() (js/api.js) cache a game's fetched IGDB
-- details (description, studio, trailer, igdb_enriched flag) onto its
-- row instead of re-fetching them from IGDB on every single visit —
-- see migrations/2026-08-21_games_enrichment_update.sql for the story.
create policy "games_authenticated_update" on public.games
  for update using (auth.uid() is not null)
  with check (auth.uid() is not null);

-- logs
create policy "logs_read_public_or_own" on public.logs for select using (is_public = true or auth.uid() = user_id);
create policy "logs_owner_insert" on public.logs for insert with check (auth.uid() = user_id);
create policy "logs_owner_update" on public.logs for update using (auth.uid() = user_id);
create policy "logs_owner_delete" on public.logs for delete using (auth.uid() = user_id);

-- follows
create policy "follows_public_read" on public.follows for select using (true);
create policy "follows_owner_insert" on public.follows for insert with check (auth.uid() = follower_id);
create policy "follows_owner_delete" on public.follows for delete using (auth.uid() = follower_id);

-- lists
create policy "lists_read_public_or_own" on public.lists for select using (is_public = true or auth.uid() = user_id);
create policy "lists_owner_insert" on public.lists for insert with check (auth.uid() = user_id);
create policy "lists_owner_update" on public.lists for update using (auth.uid() = user_id);
create policy "lists_owner_delete" on public.lists for delete using (auth.uid() = user_id);

-- list_items (permission flows from the parent list)
create policy "list_items_read_via_list" on public.list_items for select using (
  exists (select 1 from public.lists where lists.id = list_items.list_id and (lists.is_public = true or lists.user_id = auth.uid()))
);
create policy "list_items_owner_insert" on public.list_items for insert with check (
  exists (select 1 from public.lists where lists.id = list_items.list_id and lists.user_id = auth.uid())
);
create policy "list_items_owner_update" on public.list_items for update using (
  exists (select 1 from public.lists where lists.id = list_items.list_id and lists.user_id = auth.uid())
);
create policy "list_items_owner_delete" on public.list_items for delete using (
  exists (select 1 from public.lists where lists.id = list_items.list_id and lists.user_id = auth.uid())
);

-- log_likes
create policy "log_likes_public_read" on public.log_likes for select using (true);
create policy "log_likes_owner_insert" on public.log_likes for insert with check (auth.uid() = user_id);
create policy "log_likes_owner_delete" on public.log_likes for delete using (auth.uid() = user_id);

-- favorite_games
create policy "favorite_games_public_read" on public.favorite_games for select using (true);
create policy "favorite_games_owner_insert" on public.favorite_games for insert with check (auth.uid() = user_id);
create policy "favorite_games_owner_update" on public.favorite_games for update using (auth.uid() = user_id);
create policy "favorite_games_owner_delete" on public.favorite_games for delete using (auth.uid() = user_id);

-- ------------------------------------------------------------
-- AUTO-CREATE PROFILE ON SIGNUP
-- The signup form collects a username and passes it as metadata;
-- this trigger turns that into a profiles row automatically.
-- ------------------------------------------------------------
create function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', 'player_' || substr(new.id::text, 1, 8)),
    coalesce(new.raw_user_meta_data->>'username', 'Player')
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- keep updated_at current on logs
create function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger logs_set_updated_at
  before update on public.logs
  for each row execute procedure public.set_updated_at();

-- ------------------------------------------------------------
-- Done. Next: Project Settings → API → copy your Project URL
-- and anon/public key into js/config.js in the app files.
-- ------------------------------------------------------------

-- ============================================================
-- MIGRATION FOR EXISTING PROJECTS — if you already ran the script
-- above once before, DON'T re-run the whole file (it'll error on
-- tables that already exist). Instead run just this block once.
-- Safe to run more than once.
-- ============================================================

alter table public.games add column if not exists developer text;
alter table public.games add column if not exists release_date date;
alter table public.games add column if not exists publisher text;
alter table public.games add column if not exists description text;
alter table public.games add column if not exists rawg_id integer;
alter table public.games add column if not exists steam_cover_url text;
alter table public.games add column if not exists director_name text;
alter table public.games add column if not exists director_rawg_id integer;
alter table public.games add column if not exists director_image_url text;
alter table public.games add column if not exists playtime_hours numeric(5,1);
alter table public.games add column if not exists trailer_url text;
alter table public.games add column if not exists players_count integer;
alter table public.games add column if not exists rawg_enriched boolean default false not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'games_rawg_id_key') then
    alter table public.games add constraint games_rawg_id_key unique (rawg_id);
  end if;
end $$;

-- IGDB migration (additive — old RAWG columns above are left in place
-- so games added before the migration still resolve fine).
alter table public.games add column if not exists background_url text;
alter table public.games add column if not exists igdb_id integer;
alter table public.games add column if not exists studio_id integer;
alter table public.games add column if not exists studio_name text;
alter table public.games add column if not exists studio_logo_url text;
alter table public.games add column if not exists igdb_enriched boolean default false not null;
-- Caches getGameCastAndDirector()'s result (js/api.js) — see
-- migrations/2026-08-21_credits_cache.sql for why.
alter table public.games add column if not exists credits_json jsonb;
alter table public.games add column if not exists credits_fetched boolean default false not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'games_igdb_id_key') then
    alter table public.games add constraint games_igdb_id_key unique (igdb_id);
  end if;
end $$;

alter table public.profiles add column if not exists pronouns text;
alter table public.profiles add column if not exists pronouns_custom text;
alter table public.profiles add column if not exists comment_permission text
  check (comment_permission in ('anyone','friends','no_one','only_me')) default 'anyone' not null;

create table if not exists public.favorite_games (
  user_id uuid references public.profiles(id) on delete cascade,
  game_id uuid references public.games(id) on delete cascade,
  position int not null check (position >= 0 and position <= 4),
  created_at timestamptz default now(),
  primary key (user_id, position)
);
alter table public.favorite_games enable row level security;
drop policy if exists "favorite_games_public_read" on public.favorite_games;
drop policy if exists "favorite_games_owner_insert" on public.favorite_games;
drop policy if exists "favorite_games_owner_update" on public.favorite_games;
drop policy if exists "favorite_games_owner_delete" on public.favorite_games;
create policy "favorite_games_public_read" on public.favorite_games for select using (true);
create policy "favorite_games_owner_insert" on public.favorite_games for insert with check (auth.uid() = user_id);
create policy "favorite_games_owner_update" on public.favorite_games for update using (auth.uid() = user_id);
create policy "favorite_games_owner_delete" on public.favorite_games for delete using (auth.uid() = user_id);

-- Avatar photo storage — a public bucket (avatars are meant to be seen),
-- but only the owner (folder named after their own user id) can upload
-- or replace their file.
insert into storage.buckets (id, name, public)
  values ('avatars', 'avatars', true)
  on conflict (id) do nothing;

drop policy if exists "avatar_public_read" on storage.objects;
drop policy if exists "avatar_owner_write" on storage.objects;
drop policy if exists "avatar_owner_update" on storage.objects;
drop policy if exists "avatar_owner_delete" on storage.objects;
create policy "avatar_public_read" on storage.objects for select using (bucket_id = 'avatars');
create policy "avatar_owner_write" on storage.objects for insert with check (
  bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
);
create policy "avatar_owner_update" on storage.objects for update using (
  bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
);
create policy "avatar_owner_delete" on storage.objects for delete using (
  bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
);

-- Forces PostgREST to pick up every column/table above immediately —
-- this is also the fix if search was failing with "Could not find the
-- 'developer' column of 'games' in the schema cache".
NOTIFY pgrst, 'reload schema';
