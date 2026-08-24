-- ============================================================
-- COMMENTS ON REVIEWS — run once in the Supabase SQL Editor.
-- Safe to run more than once.
-- ============================================================
--
-- Backs the comment thread on a review's own page. A comment belongs to a
-- log (the review) and a user (the author). Reads are public (reviews are
-- public content); writing requires being signed in and NOT suspended, so
-- it inherits the same ban enforcement as everything else. People can
-- delete their own comments.

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  log_id uuid not null references public.logs(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists comments_log_id_idx on public.comments(log_id, created_at);

alter table public.comments enable row level security;

drop policy if exists "comments_public_read" on public.comments;
create policy "comments_public_read" on public.comments for select using (true);

drop policy if exists "comments_owner_insert" on public.comments;
create policy "comments_owner_insert" on public.comments
  for insert with check (auth.uid() = user_id and not public.is_suspended());

drop policy if exists "comments_owner_delete" on public.comments;
create policy "comments_owner_delete" on public.comments
  for delete using (auth.uid() = user_id);

notify pgrst, 'reload schema';
