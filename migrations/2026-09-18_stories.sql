-- ============================================================
-- STORIES — short-lived "what I'm playing right now" posts
-- ============================================================
-- A story is a game plus an optional line about it, visible for 24
-- hours. Deliberately built on the games people are already logging
-- rather than as a free-form photo feed: this is a gaming diary, and
-- "Ishant is 20 hours into Silent Hill f" is the thing worth surfacing
-- for a day, not another place to post pictures.
--
-- Expiry is a read-time filter (expires_at > now()), not a scheduled
-- delete. No cron job to own, no window where a job is late and stale
-- stories are visible, and the row sticks around long enough for the
-- author to see who watched it after it has stopped being public.

create table if not exists public.stories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  -- What the story is ABOUT. A story with neither a game nor an image
  -- has nothing to show, which the check below refuses outright.
  game_id uuid references public.games(id) on delete cascade,
  log_id uuid references public.logs(id) on delete set null,
  caption text check (caption is null or char_length(caption) <= 200),
  image_url text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  constraint stories_has_content check (game_id is not null or image_url is not null)
);

create index if not exists stories_live_idx on public.stories(user_id, expires_at desc);
create index if not exists stories_expiry_idx on public.stories(expires_at desc);

-- Who watched. The author seeing this is half the point of posting one.
create table if not exists public.story_views (
  story_id uuid not null references public.stories(id) on delete cascade,
  viewer_id uuid not null references public.profiles(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (story_id, viewer_id)
);
create index if not exists story_views_viewer_idx on public.story_views(viewer_id);

alter table public.stories enable row level security;
alter table public.story_views enable row level security;

-- ---- stories RLS --------------------------------------------------------
-- Readable while live, by anyone signed in — the same shape as a public
-- log, which this is a short-lived version of. Who actually SEES one is
-- a question the feed answers by only asking for the people you follow;
-- making it a policy instead would mean a story could not be opened from
-- a profile or a shared link.
drop policy if exists "stories_read_live" on public.stories;
create policy "stories_read_live" on public.stories
  for select using (expires_at > now() or user_id = auth.uid());

drop policy if exists "stories_owner_insert" on public.stories;
create policy "stories_owner_insert" on public.stories
  for insert with check (auth.uid() = user_id and not public.is_suspended());

drop policy if exists "stories_owner_delete" on public.stories;
create policy "stories_owner_delete" on public.stories
  for delete using (auth.uid() = user_id);

-- ---- story_views RLS ----------------------------------------------------
-- You can see your own view rows, and an author can see every view of
-- their own stories. Nobody else can tell who watched what.
drop policy if exists "story_views_read" on public.story_views;
create policy "story_views_read" on public.story_views
  for select using (
    viewer_id = auth.uid()
    or exists (select 1 from public.stories s where s.id = story_id and s.user_id = auth.uid())
  );

drop policy if exists "story_views_own_insert" on public.story_views;
create policy "story_views_own_insert" on public.story_views
  for insert with check (
    viewer_id = auth.uid()
    -- Viewing your own story is not a view. Without this the author's
    -- own count is off by one from the moment they post.
    and not exists (select 1 from public.stories s where s.id = story_id and s.user_id = auth.uid())
  );

notify pgrst, 'reload schema';
