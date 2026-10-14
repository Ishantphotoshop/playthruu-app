1. Kill the gap between tabs like Trending Now and Friend's Activity / Currently Playing — make the spacing even everywhere. 2. Fix the Trending Now page — it's slow, with a slow-loading history of trending games. 3. Remove "Because you said..." and the game's name from "Picked For You." Make "Picked For You" show similar games to play based on what the player has recently logged. Make sure it doesn't show a game they've already logged or marked as played. 4. Remove the category names from "Bored? Try These" (like Story, Masterpieces, etc.) — just keep it as "Bored? Try These." 5. The keyboard should auto-close after tapping search. Also: a game shouldn't still show after its name is removed from the search bar — it should only appear in search after typing the game's name (e.g. Alan Wake 2010, directed by ___) — remove the (+Add) button. Tapping Filter should open the Filters tab directly, not the games list. When filters are selected and Apply is tapped, it should show games based on those filters — fix the filter feature, it's not working properly. The Player's tab should be empty — remove "Popular on PlayThruu" from it. 6. Tapping the + icon in the nav bar should open the "Log a Game" popup directly. Right now it takes you to the home screen first, then opens the popup. After typing a game's name, it should show results just like the normal game search (as a list). Also, tapping + should pull up recent searches — but only game-related recent searches — shown in that list. The search bar in the + popup should say "Name of Game." 7. In the Notifications tab, scrolling to the bottom should auto-load more instead of showing a "Load more" button — use our app's loading icon, styled nicely/optimized. Remove the filter icon from the Notifications tab. Add a back (‹) icon there, styled like the search bar. Keep the bar's position consistent across tabs (Feed/News, Games/Player, Friends/You, etc.) — and remove the separate "Activity" links. Also: the notification/activity text is currently in a very thin font — make it all one regular/medium size, with only game names slightly bolder. Add pull-to-refresh on the Home and Notification tabs (pulling down refreshes and loads the latest results). Make everything in the Notifications tab a bit smaller (profile pic, text, etc.) — but not the tab bar itself, only the content below it.-- QUESTLOG UPGRADE — run this once in Supabase SQL Editor.
-- It is safe to run on an existing Questlog project.

-- Fix the blocking RAWG import error and retain precise release dates.
alter table public.games add column if not exists developer text;
alter table public.games add column if not exists release_date date;

-- New profile preferences.
alter table public.profiles add column if not exists pronouns text;
alter table public.profiles add column if not exists comment_privacy text not null default 'anyone';

-- Five ordered, optional favourites for every profile.
create table if not exists public.profile_favorites (
  user_id uuid references public.profiles(id) on delete cascade not null,
  game_id uuid references public.games(id) on delete cascade not null,
  position smallint not null check (position between 0 and 4),
  created_at timestamptz default now(),
  primary key (user_id, game_id),
  unique (user_id, position)
);
create index if not exists profile_favorites_user_position_idx
  on public.profile_favorites (user_id, position);

alter table public.profile_favorites enable row level security;
drop policy if exists "profile_favorites_public_read" on public.profile_favorites;
create policy "profile_favorites_public_read" on public.profile_favorites
  for select using (true);
drop policy if exists "profile_favorites_owner_insert" on public.profile_favorites;
create policy "profile_favorites_owner_insert" on public.profile_favorites
  for insert with check (auth.uid() = user_id);
drop policy if exists "profile_favorites_owner_update" on public.profile_favorites;
create policy "profile_favorites_owner_update" on public.profile_favorites
  for update using (auth.uid() = user_id);
drop policy if exists "profile_favorites_owner_delete" on public.profile_favorites;
create policy "profile_favorites_owner_delete" on public.profile_favorites
  for delete using (auth.uid() = user_id);

-- Public avatar files, with each member allowed to change only their folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 4194304, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update set public = true, file_size_limit = 4194304,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read" on storage.objects for select using (bucket_id = 'avatars');
drop policy if exists "avatars_owner_insert" on storage.objects;
create policy "avatars_owner_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "avatars_owner_update" on storage.objects;
create policy "avatars_owner_update" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "avatars_owner_delete" on storage.objects;
create policy "avatars_owner_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- PostgREST can retain an old schema cache after a column migration.
notify pgrst, 'reload schema';
