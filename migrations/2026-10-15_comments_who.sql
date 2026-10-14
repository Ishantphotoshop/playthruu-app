-- Who can comment on a review: everyone, people the author follows, the author's
-- followers, or either of those. "No one" is the existing comments_disabled switch.

alter table public.logs add column if not exists comments_disabled boolean not null default false;
alter table public.logs add column if not exists comments_who text not null default 'everyone';
alter table public.logs drop constraint if exists logs_comments_who_check;
alter table public.logs add constraint logs_comments_who_check
  check (comments_who in ('everyone', 'following', 'followers', 'both'));

drop policy if exists "comments_owner_insert" on public.comments;
create policy "comments_owner_insert" on public.comments
  for insert with check (
    auth.uid() = user_id
    and not public.is_suspended()
    and exists (
      select 1 from public.logs l
      where l.id = log_id
        and not l.comments_disabled
        and (
          l.user_id = auth.uid()
          or l.comments_who = 'everyone'
          or (l.comments_who in ('following', 'both')
              and exists (select 1 from public.follows f where f.follower_id = l.user_id and f.following_id = auth.uid()))
          or (l.comments_who in ('followers', 'both')
              and exists (select 1 from public.follows f where f.follower_id = auth.uid() and f.following_id = l.user_id))
        )
    )
  );

notify pgrst, 'reload schema';
