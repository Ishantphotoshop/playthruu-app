-- ============================================================
-- Notifications
-- ============================================================
-- One table for everything that happens TO you: somebody followed you,
-- liked one of your reviews, commented on one, or sent you a message.
-- The app's notification hub reads this one table instead of stitching
-- four separate queries together on every open, and Supabase realtime
-- on it is what makes the bell badge move live.
--
-- Rows are written by triggers, never by the client. The triggers are
-- SECURITY DEFINER so they can insert a row whose user_id is somebody
-- ELSE's (the recipient's) — which is exactly what RLS would otherwise
-- forbid, and exactly why there is no insert policy below. A client can
-- read, mark read, and delete its own rows; that is all.

-- ---- the table ------------------------------------------------------

create table if not exists public.notifications (
  id              uuid primary key default gen_random_uuid(),
  -- who is being notified
  user_id         uuid not null references public.profiles(id) on delete cascade,
  -- who caused it (null once that account is gone — the row survives as
  -- "someone", rather than vanishing out of your history)
  actor_id        uuid references public.profiles(id) on delete set null,
  kind            text not null check (kind in ('follow', 'like', 'comment', 'message')),
  -- the thing it happened to. Each is null for the kinds it makes no
  -- sense for: a follow has no log, a message has no comment.
  log_id          uuid references public.logs(id) on delete cascade,
  comment_id      uuid references public.comments(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade,
  read_at         timestamptz,
  created_at      timestamptz not null default now()
);

-- The hub's own query: newest first, for one person.
create index if not exists notifications_user_idx
  on public.notifications(user_id, created_at desc);

-- The badge's query. Partial, because the unread set is tiny next to the
-- table and this keeps the count a read of a few index pages rather than
-- a scan of everything that person was ever told about.
create index if not exists notifications_unread_idx
  on public.notifications(user_id)
  where read_at is null;

-- Follows and likes are toggles: unfollow and refollow, or unlike and
-- relike, and without these you would collect a fresh notification each
-- time. One standing row per (recipient, actor) for a follow, and per
-- (recipient, actor, log) for a like — the triggers below lean on these
-- with `on conflict do nothing`. Comments and messages are deliberately
-- NOT deduped: each one is its own event.
create unique index if not exists notifications_follow_uniq
  on public.notifications(user_id, actor_id)
  where kind = 'follow';

create unique index if not exists notifications_like_uniq
  on public.notifications(user_id, actor_id, log_id)
  where kind = 'like';

alter table public.notifications enable row level security;

drop policy if exists "notifications_own_read"   on public.notifications;
drop policy if exists "notifications_own_update" on public.notifications;
drop policy if exists "notifications_own_delete" on public.notifications;

create policy "notifications_own_read"
  on public.notifications for select
  using (user_id = auth.uid());

-- Marking read is the only field a client ever changes. The using/with
-- check pair both pin user_id, so a row cannot be updated INTO or OUT OF
-- somebody else's inbox.
create policy "notifications_own_update"
  on public.notifications for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "notifications_own_delete"
  on public.notifications for delete
  using (user_id = auth.uid());

-- No insert policy, on purpose: see the header. Everything is written by
-- the SECURITY DEFINER triggers below.

-- ---- per-person preferences ----------------------------------------

-- A jsonb blob rather than four boolean columns: the set of things worth
-- muting will keep growing, and this way adding one is a client change
-- and a default here, not a migration per switch. Anything missing from
-- a person's own object falls back to the default below, so a row
-- written before a new key existed still behaves sensibly.
alter table public.profiles
  add column if not exists notification_prefs jsonb not null default
    '{"follow":true,"like":true,"comment":true,"message":true,"sound":true,"push":false}'::jsonb;

-- ---- web push subscriptions ----------------------------------------

-- One row per browser/device that opted in. endpoint is the primary key
-- because that IS the identity of a push subscription as far as the push
-- service is concerned — the same person on a phone and a laptop is two
-- rows, and re-subscribing on the same device replaces rather than
-- duplicates.
create table if not exists public.push_subscriptions (
  endpoint   text primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists "push_subs_own_read"   on public.push_subscriptions;
drop policy if exists "push_subs_own_write"  on public.push_subscriptions;
drop policy if exists "push_subs_own_delete" on public.push_subscriptions;

create policy "push_subs_own_read"
  on public.push_subscriptions for select using (user_id = auth.uid());
create policy "push_subs_own_write"
  on public.push_subscriptions for insert with check (user_id = auth.uid());
create policy "push_subs_own_delete"
  on public.push_subscriptions for delete using (user_id = auth.uid());

-- ============================================================
-- Triggers
-- ============================================================

-- Shared gate. Returns true only when this notification should exist at
-- all: there is a recipient, it is not you notifying yourself, and the
-- recipient has not switched this kind off. Reading the preference here
-- rather than at render time means a muted kind never becomes a row —
-- so muting genuinely stops the badge moving and the push firing, not
-- just the list showing it.
create or replace function public.notify_wanted(recipient uuid, actor uuid, k text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select recipient is not null
     and actor is not null
     and recipient <> actor
     and coalesce((select (notification_prefs ->> k)::boolean from public.profiles where id = recipient), true);
$$;

-- ---- follow ---------------------------------------------------------

create or replace function public.notify_on_follow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.notify_wanted(new.following_id, new.follower_id, 'follow') then
    insert into public.notifications (user_id, actor_id, kind)
    values (new.following_id, new.follower_id, 'follow')
    on conflict do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_on_follow on public.follows;
create trigger trg_notify_on_follow
  after insert on public.follows
  for each row execute function public.notify_on_follow();

-- Unfollowing takes the notification with it. Otherwise your hub keeps
-- claiming somebody follows you who does not, with no way to tell.
create or replace function public.unnotify_on_unfollow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.notifications
   where kind = 'follow'
     and user_id = old.following_id
     and actor_id = old.follower_id;
  return old;
end;
$$;

drop trigger if exists trg_unnotify_on_unfollow on public.follows;
create trigger trg_unnotify_on_unfollow
  after delete on public.follows
  for each row execute function public.unnotify_on_unfollow();

-- ---- like -----------------------------------------------------------

create or replace function public.notify_on_like()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid;
begin
  select user_id into owner from public.logs where id = new.log_id;
  if public.notify_wanted(owner, new.user_id, 'like') then
    insert into public.notifications (user_id, actor_id, kind, log_id)
    values (owner, new.user_id, 'like', new.log_id)
    on conflict do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_on_like on public.log_likes;
create trigger trg_notify_on_like
  after insert on public.log_likes
  for each row execute function public.notify_on_like();

create or replace function public.unnotify_on_unlike()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.notifications
   where kind = 'like'
     and actor_id = old.user_id
     and log_id = old.log_id;
  return old;
end;
$$;

drop trigger if exists trg_unnotify_on_unlike on public.log_likes;
create trigger trg_unnotify_on_unlike
  after delete on public.log_likes
  for each row execute function public.unnotify_on_unlike();

-- ---- comment --------------------------------------------------------

create or replace function public.notify_on_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid;
begin
  select user_id into owner from public.logs where id = new.log_id;
  if public.notify_wanted(owner, new.user_id, 'comment') then
    insert into public.notifications (user_id, actor_id, kind, log_id, comment_id)
    values (owner, new.user_id, 'comment', new.log_id, new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_on_comment on public.comments;
create trigger trg_notify_on_comment
  after insert on public.comments
  for each row execute function public.notify_on_comment();

-- ---- message --------------------------------------------------------

-- Every member of the conversation except the sender. Groups keep their
-- membership in conversation_participants; one-to-one conversations
-- predate that table and keep theirs in the two pair columns, so this
-- unions both rather than assuming either.
--
-- Note this is a SECOND, independent signal from the existing per-
-- conversation unread marker in conversation_prefs — that one still
-- drives the Messages tab's own badge. This exists so the hub can show
-- messages in the same stream as everything else, which is the whole
-- point of a single hub.
create or replace function public.notify_on_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recipient uuid;
begin
  for recipient in
    select p.user_id
      from public.conversation_participants p
     where p.conversation_id = new.conversation_id
    union
    select c.user_one_id from public.conversations c where c.id = new.conversation_id and c.user_one_id is not null
    union
    select c.user_two_id from public.conversations c where c.id = new.conversation_id and c.user_two_id is not null
  loop
    if public.notify_wanted(recipient, new.sender_id, 'message') then
      insert into public.notifications (user_id, actor_id, kind, conversation_id)
      values (recipient, new.sender_id, 'message', new.conversation_id);
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists trg_notify_on_message on public.messages;
create trigger trg_notify_on_message
  after insert on public.messages
  for each row execute function public.notify_on_message();

-- ---- housekeeping ---------------------------------------------------

-- Realtime has to be told explicitly which tables it may stream.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end
$$;
