-- Likes on comments (the heart on each comment under a review).
-- Same shape as log_likes: one row per person per comment, anyone can read,
-- you can only add or remove your own, and a suspended account cannot add.

create table if not exists public.comment_likes (
  user_id uuid not null references public.profiles(id) on delete cascade,
  comment_id uuid not null references public.comments(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, comment_id)
);

create index if not exists comment_likes_comment_idx on public.comment_likes(comment_id);

alter table public.comment_likes enable row level security;

drop policy if exists "comment_likes_public_read" on public.comment_likes;
create policy "comment_likes_public_read" on public.comment_likes for select using (true);

drop policy if exists "comment_likes_owner_insert" on public.comment_likes;
create policy "comment_likes_owner_insert" on public.comment_likes
  for insert with check (auth.uid() = user_id and not public.is_suspended());

drop policy if exists "comment_likes_owner_delete" on public.comment_likes;
create policy "comment_likes_owner_delete" on public.comment_likes
  for delete using (auth.uid() = user_id);

notify pgrst, 'reload schema';
