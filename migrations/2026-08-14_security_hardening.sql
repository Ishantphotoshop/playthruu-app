-- ============================================================
-- SECURITY HARDENING — run this ONCE in the Supabase SQL Editor
-- before letting anyone outside your friend group sign up.
--
-- Safe to run more than once: every statement is guarded.
-- ============================================================


-- ------------------------------------------------------------
-- 1. CLOSE THE EMAIL HARVESTING HOLE  (most urgent)
-- ------------------------------------------------------------
-- get_email_for_username() turns a username into that account's real
-- email address, and it was granted to `anon` — callable with no login
-- at all. Since profiles_public_read exposes every username to anyone,
-- the two together let a stranger dump the email address of every user
-- on the app with two requests in a loop.
--
-- Username login now runs through the `username-login` Edge Function,
-- which does this lookup with the service-role key on the server and
-- returns only a session, never the email. So nothing in the browser
-- needs this function any more.

revoke execute on function public.get_email_for_username(text) from anon;
revoke execute on function public.get_email_for_username(text) from authenticated;
revoke execute on function public.get_email_for_username(text) from public;


-- ------------------------------------------------------------
-- 2. STOP ONE USER FROM FORGING ANOTHER USER'S NAME ON A GAME
-- ------------------------------------------------------------
-- games_authenticated_insert only checked "is this person logged in",
-- so `added_by` could be set to anyone's id. That column is the only
-- audit trail for who added a game, so it needs to be truthful.

drop policy if exists "games_authenticated_insert" on public.games;
create policy "games_authenticated_insert" on public.games
  for insert with check (auth.uid() is not null and added_by = auth.uid());


-- ------------------------------------------------------------
-- 3. LENGTH LIMITS ON EVERY USER-WRITABLE TEXT COLUMN
-- ------------------------------------------------------------
-- The app sets maxlength in HTML, but that is only a hint in the
-- browser — anyone can POST straight to the REST API and bypass it.
-- Without a database constraint a single user can store a multi-megabyte
-- review that then loads into every feed and game page for everyone.

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'logs_review_len') then
    alter table public.logs add constraint logs_review_len check (char_length(review) <= 5000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_bio_len') then
    alter table public.profiles add constraint profiles_bio_len check (char_length(bio) <= 200);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_display_name_len') then
    alter table public.profiles add constraint profiles_display_name_len check (char_length(display_name) <= 40);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_pronouns_custom_len') then
    alter table public.profiles add constraint profiles_pronouns_custom_len check (char_length(pronouns_custom) <= 30);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'lists_name_len') then
    alter table public.lists add constraint lists_name_len check (char_length(name) <= 80);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'lists_description_len') then
    alter table public.lists add constraint lists_description_len check (char_length(description) <= 500);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'list_items_note_len') then
    alter table public.list_items add constraint list_items_note_len check (char_length(note) <= 500);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'games_title_len') then
    alter table public.games add constraint games_title_len check (char_length(title) <= 200);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'games_description_len') then
    alter table public.games add constraint games_description_len check (char_length(description) <= 5000);
  end if;
end $$;


-- ------------------------------------------------------------
-- 4. ENFORCE THE USERNAME RULES ON THE SERVER
-- ------------------------------------------------------------
-- The signup regex lives in js/auth.js, which means it only applies to
-- people using the app normally. Anyone calling the API directly could
-- register a 500-character username, a slur, or a name impersonating
-- you. This applies the same rule the UI claims to enforce.

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_username_format') then
    alter table public.profiles add constraint profiles_username_format
      check (username ~ '^[a-z0-9._]{1,20}$' and username !~ '\.\.' and username !~ '^\.' and username !~ '\.$');
  end if;
end $$;

-- Usernames were case-sensitively unique, so `Alice` and `alice` could
-- both exist and then collide at login. This makes uniqueness
-- case-insensitive, matching how login actually looks them up.
create unique index if not exists profiles_username_lower_key on public.profiles (lower(username));


-- ------------------------------------------------------------
-- 5. LIMIT AVATAR UPLOADS
-- ------------------------------------------------------------
-- The bucket was created with no size cap and no MIME restriction, so
-- an authenticated stranger had an unlimited public file host on your
-- Supabase storage quota and bandwidth bill.

update storage.buckets
set file_size_limit = 4194304,  -- 4 MB
    allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif']
where id = 'avatars';


-- ------------------------------------------------------------
-- 6. MODERATION FOUNDATION
-- ------------------------------------------------------------
-- There was previously no way to report anything, no way to block
-- anyone, and no admin concept — and no columns to build any of that
-- on. These are the minimum tables/flags needed before strangers can
-- post publicly visible content.

alter table public.profiles add column if not exists is_admin boolean default false not null;
alter table public.profiles add column if not exists is_suspended boolean default false not null;

-- Soft-hide, so removing abusive content never has to mean deleting a
-- games row (deleting one cascades and destroys every user's reviews,
-- list entries and favourites attached to that game).
alter table public.games add column if not exists is_hidden boolean default false not null;
alter table public.logs  add column if not exists is_hidden boolean default false not null;

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.profiles(id) on delete cascade not null,
  target_type text not null check (target_type in ('log','game','profile','list')),
  target_id uuid not null,
  reason text not null check (char_length(reason) <= 500),
  status text not null default 'open' check (status in ('open','reviewed','dismissed')),
  created_at timestamptz default now()
);
alter table public.reports enable row level security;

drop policy if exists "reports_owner_insert" on public.reports;
create policy "reports_owner_insert" on public.reports
  for insert with check (auth.uid() = reporter_id);

-- Reports are deliberately NOT publicly readable: only the reporter and
-- admins can see them, so a harasser can't watch who reported them.
drop policy if exists "reports_read_own_or_admin" on public.reports;
create policy "reports_read_own_or_admin" on public.reports
  for select using (
    auth.uid() = reporter_id
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  );

create table if not exists public.blocks (
  blocker_id uuid references public.profiles(id) on delete cascade not null,
  blocked_id uuid references public.profiles(id) on delete cascade not null,
  created_at timestamptz default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
alter table public.blocks enable row level security;

drop policy if exists "blocks_owner_all" on public.blocks;
create policy "blocks_owner_all" on public.blocks
  for all using (auth.uid() = blocker_id) with check (auth.uid() = blocker_id);


-- ------------------------------------------------------------
-- 7. LET PEOPLE REMOVE A FOLLOWER, AND DELETE THEIR ACCOUNT
-- ------------------------------------------------------------
-- follows_owner_delete only allowed the follower to unfollow, so there
-- was no way to make someone stop following you. Allowing the person
-- being followed to delete the row is what "remove follower" needs.

drop policy if exists "follows_owner_delete" on public.follows;
create policy "follows_owner_delete" on public.follows
  for delete using (auth.uid() = follower_id or auth.uid() = following_id);

-- profiles had no DELETE policy at all, so nobody could delete their own
-- account from inside the app — a real problem once strangers with
-- privacy rights are signing up.
drop policy if exists "profiles_owner_delete" on public.profiles;
create policy "profiles_owner_delete" on public.profiles
  for delete using (auth.uid() = id);


-- Force PostgREST to notice the new columns/tables immediately rather
-- than waiting for its cache to expire.
notify pgrst, 'reload schema';
