-- ============================================================
-- CAST — who voiced and performed the characters in a game
-- ============================================================
-- Run once in the Supabase SQL Editor (or via the CLI, see README).
-- Safe to run more than once.
--
-- The game page's Cast tab used to read Wikidata live on every visit.
-- These three tables make it OUR data instead: the first person to open
-- a game's Cast tab triggers one web lookup in the fetch-cast Edge
-- Function, and everybody after that — on any device — reads the saved
-- rows straight from Postgres.
--
-- Text only, deliberately. No photos, no blobs: the free tier is 500 MB
-- and a cast list is a few hundred bytes. Portraits, if they ever
-- happen, belong behind a URL to someone else's storage.
--
-- Nothing here is writable from the browser. The app's anon key can
-- read all three and write none of them; every insert goes through the
-- Edge Function, which holds the service-role key. That is what keeps a
-- public catalogue of names from being an open text field on the
-- internet.

-- One row per human, shared across every game they are in.
create table if not exists public.people (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now()
);

-- One row per (game, person, character). The same actor voicing two
-- characters in one game is two rows, which is correct — that is how
-- the credit actually reads.
create table if not exists public.game_cast (
  id uuid primary key default gen_random_uuid(),
  igdb_game_id integer not null,
  person_id uuid not null references public.people(id) on delete cascade,
  character_name text check (character_name is null or char_length(character_name) <= 80),
  -- What they actually did. 'unknown' is honest and common: plenty of
  -- sources say "cast" without saying whether it was voice, body, or both.
  role_type text not null default 'unknown'
    check (role_type in ('voice', 'mocap', 'voice_and_mocap', 'unknown')),
  -- True only when two or more different sites agreed (see fetch-cast).
  -- The app shows an "unverified" tag on the rest rather than hiding
  -- them: a single good source is still worth showing, as long as the
  -- page says that is what it is.
  verified boolean not null default false,
  source_urls text[] not null default '{}',
  created_at timestamptz not null default now()
);

-- A null character_name is not equal to another null in Postgres, so the
-- plain unique constraint would let the same person be inserted over and
-- over with no character. coalesce in a unique INDEX closes that.
create unique index if not exists game_cast_unique_idx
  on public.game_cast(igdb_game_id, person_id, coalesce(character_name, ''));
create index if not exists game_cast_game_idx on public.game_cast(igdb_game_id);
create index if not exists game_cast_person_idx on public.game_cast(person_id);

-- Whether we have already looked, and when. 'none' is a real answer and
-- is kept for 30 days (see fetch-cast): a game with no cast on the web
-- must not cost a search every time its page is opened.
create table if not exists public.cast_lookups (
  igdb_game_id integer primary key,
  status text not null default 'pending' check (status in ('pending', 'done', 'none')),
  checked_at timestamptz not null default now()
);

alter table public.people enable row level security;
alter table public.game_cast enable row level security;
alter table public.cast_lookups enable row level security;

-- ---- RLS: everyone reads, nobody writes -------------------------------
-- `to public` covers signed-out visitors too — game pages are readable
-- without an account everywhere else in the app, and the cast is part of
-- the page. The service-role key used by the Edge Function bypasses RLS
-- entirely, so it needs no policy of its own; the absence of any insert,
-- update or delete policy is what makes these tables append-only from
-- the server and read-only from everywhere else.
drop policy if exists people_public_read on public.people;
create policy people_public_read on public.people
  for select to public using (true);

drop policy if exists game_cast_public_read on public.game_cast;
create policy game_cast_public_read on public.game_cast
  for select to public using (true);

drop policy if exists cast_lookups_public_read on public.cast_lookups;
create policy cast_lookups_public_read on public.cast_lookups
  for select to public using (true);
