-- A review's owner can turn comments off (three dots on their review page).
-- The switch lives on the log; the database also refuses new comments on a
-- log that has comments turned off, so it cannot be skipped from the app.

alter table public.logs add column if not exists comments_disabled boolean not null default false;

drop policy if exists "comments_owner_insert" on public.comments;
create policy "comments_owner_insert" on public.comments
  for insert with check (
    auth.uid() = user_id
    and not public.is_suspended()
    and not exists (select 1 from public.logs l where l.id = log_id and l.comments_disabled)
  );

notify pgrst, 'reload schema';
