-- Connected gaming accounts, and the libraries imported from them.
--
-- Deliberately platform-agnostic: Steam is the only platform with a real
-- public API and a real OAuth flow, but PlayStation and Xbox should drop
-- into the same two tables rather than each growing their own, so the
-- import pipeline and the profile UI are written once.
--
-- Nothing here stores a platform credential. Steam's OpenID hands back
-- an id and nothing else, and any token the server needs lives in an
-- Edge Function secret (see supabase/functions/*), never in a row and
-- never in the client bundle.

-- ---------------------------------------------------------------- link
create table if not exists public.connected_accounts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  platform     text not null check (platform in ('steam', 'psn', 'xbox')),

  -- The platform's own stable identifier: a 64-bit SteamID, a PSN
  -- accountId, an Xbox XUID. Stored as text because SteamIDs exceed
  -- what a JS number can hold safely and get mangled the moment
  -- anything treats them as numeric.
  platform_id  text not null,

  -- What to show on the profile. Separate from platform_id because
  -- handles are renameable and ids are not.
  handle       text,
  avatar_url   text,

  -- Set when the platform refuses to share a library. Steam users can
  -- mark game details private, and PSN/Xbox have their own switches, so
  -- "connected but empty" is a real state that needs explaining in the
  -- UI rather than looking like a broken import.
  library_visibility text not null default 'unknown'
    check (library_visibility in ('unknown', 'public', 'private')),

  last_synced_at timestamptz,
  last_sync_error text,

  created_at   timestamptz not null default now(),

  -- One account per platform per user, and one platform account can't be
  -- claimed by two people — otherwise two profiles could both assert the
  -- same Steam library.
  unique (user_id, platform),
  unique (platform, platform_id)
);

create index if not exists connected_accounts_user_idx
  on public.connected_accounts (user_id);

-- ------------------------------------------------------------- library
-- One row per game per connected account. Kept separate from `logs`
-- on purpose: a log is something a person wrote, an owned game is
-- something a platform reported. Merging them would mean an import
-- silently manufacturing hundreds of diary entries nobody wrote.
create table if not exists public.imported_games (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.connected_accounts(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,

  -- The platform's own title id, and its own name for the game. Both
  -- kept even after matching, so a re-match later doesn't need a
  -- re-import and so unmatched rows are still displayable.
  platform_game_id text not null,
  name             text not null,

  -- Minutes, because that is what Steam returns and rounding at import
  -- would throw away detail we can never get back. Display converts.
  playtime_minutes integer not null default 0,
  last_played_at   timestamptz,

  -- Resolved against our own games table where we can manage it. Null
  -- means "imported but not matched yet" — a normal, non-error state:
  -- platform names carry edition suffixes and regional variants that
  -- do not resolve cleanly, and a library is still worth showing with
  -- some rows unmatched.
  game_id       uuid references public.games(id) on delete set null,
  match_state   text not null default 'pending'
    check (match_state in ('pending', 'matched', 'ambiguous', 'unmatched')),

  imported_at   timestamptz not null default now(),

  unique (account_id, platform_game_id)
);

create index if not exists imported_games_user_idx on public.imported_games (user_id);
create index if not exists imported_games_account_idx on public.imported_games (account_id);
create index if not exists imported_games_game_idx on public.imported_games (game_id);
-- The profile library sorts by time played, and that is the only sort
-- anyone asks for first.
create index if not exists imported_games_playtime_idx
  on public.imported_games (user_id, playtime_minutes desc);

-- ----------------------------------------------------------------- RLS
alter table public.connected_accounts enable row level security;
alter table public.imported_games enable row level security;

-- Libraries are public the way logs are — the whole point is that they
-- show up on a profile other people can look at.
create policy "connected accounts are readable by everyone"
  on public.connected_accounts for select using (true);

create policy "imported games are readable by everyone"
  on public.imported_games for select using (true);

-- Writes are yours alone. Imports run as the signed-in user rather than
-- with elevated rights, so a bug in the importer can only ever damage
-- the library of whoever is running it.
create policy "you manage your own connected accounts"
  on public.connected_accounts for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "you manage your own imported games"
  on public.imported_games for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
