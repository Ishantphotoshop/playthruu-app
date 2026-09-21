-- ============================================================
-- COMMENT MODERATION — run once in the Supabase SQL Editor.
-- Safe to run more than once.
-- ============================================================
--
-- Three things a comment thread needs once more than two people are in
-- it, and one the app was missing entirely:
--
--   deleted_at    A deleted comment leaves a tombstone instead of
--                 vanishing. A comment that simply disappears makes the
--                 replies under it read as non-sequiturs, and leaves
--                 whoever was talking to it wondering whether they
--                 imagined it. Deleting is now an UPDATE, not a DELETE.
--
--   pinned_at     The person whose review it is can pin one comment to
--                 the top of their own thread.
--
--   restricted_at The review's owner can hide a comment from everyone
--                 except its author. Per COMMENT rather than per person
--                 on purpose: a restrict list that every reader can see
--                 would tell the restricted person they had been
--                 restricted, which is the one thing the feature exists
--                 to avoid.
--
-- Plus mention notifications: writing "@someone" in a comment now tells
-- them, the same way a like or a follow does.

-- ---- the columns ----------------------------------------------------

alter table public.comments
  add column if not exists deleted_at    timestamptz,
  add column if not exists pinned_at     timestamptz,
  add column if not exists restricted_at timestamptz;

-- One pinned comment per review, not several.
create unique index if not exists comments_one_pin_per_log
  on public.comments(log_id)
  where pinned_at is not null;

-- ---- who may change what --------------------------------------------
-- The author, and the person whose review it is. The author to take
-- their own words back; the review's owner because it is their thread
-- and moderating it is the whole point.
--
-- Deliberately one policy over the three columns rather than three
-- column-level ones: every one of them is the same question — "is this
-- your comment, or your review?" — and splitting it three ways makes it
-- three places to get that answer wrong.

drop policy if exists comments_moderate_update on public.comments;
create policy comments_moderate_update on public.comments
  for update
  using (
    auth.uid() = user_id
    or auth.uid() = (select l.user_id from public.logs l where l.id = comments.log_id)
  )
  with check (
    auth.uid() = user_id
    or auth.uid() = (select l.user_id from public.logs l where l.id = comments.log_id)
  );

-- ---- mentions --------------------------------------------------------

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('follow', 'like', 'comment', 'message', 'mention'));

-- SECURITY DEFINER for the same reason every other notification trigger
-- is: the row it writes belongs to somebody ELSE (the person mentioned),
-- which is exactly what RLS forbids a client to do, and exactly why
-- notifications have no insert policy at all.
create or replace function public.notify_mentions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  handle    text;
  target    uuid;
  log_owner uuid;
begin
  select l.user_id into log_owner from public.logs l where l.id = new.log_id;

  for handle in
    select distinct lower(m[1])
    from regexp_matches(new.body, '@([A-Za-z0-9._]{1,20})', 'g') as m
  loop
    select p.id into target from public.profiles p where lower(p.username) = handle;

    -- Never tell you that you mentioned yourself, and never tell the
    -- review's owner twice — they already get a 'comment' notification
    -- for this very comment.
    if target is not null
       and target <> new.user_id
       and target is distinct from log_owner then
      insert into public.notifications (user_id, actor_id, kind, log_id, comment_id)
      values (target, new.user_id, 'mention', new.log_id, new.id);
    end if;
  end loop;

  return new;
end
$$;

drop trigger if exists comments_notify_mentions on public.comments;
create trigger comments_notify_mentions
  after insert on public.comments
  for each row execute function public.notify_mentions();

notify pgrst, 'reload schema';
