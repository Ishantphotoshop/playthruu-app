-- QUESTLOG UPGRADE — run this once in Supabase SQL Editor.
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
