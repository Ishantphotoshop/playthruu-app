-- ============================================================
-- DIRECT MESSAGES — run once in the Supabase SQL Editor.
-- Safe to run more than once.
-- ============================================================
--
-- One conversation per pair of players (never duplicated — see the
-- canonical-ordering check below), each holding its own messages. A
-- conversation starts 'accepted' when the two players already follow
-- each other back, or 'pending' (a request) otherwise — mirroring the
-- rule the app was asked to enforce ("mutual follows message freely,
-- everyone else sends a request first"). Both the initial status and
-- the pending->accepted flip on reply are decided by triggers below,
-- not the client, so a client can't just claim 'accepted' to skip the
-- request step.

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  -- Always the smaller/larger of the pair (enforced by the check below)
  -- so the same two people can never end up with two separate rows,
  -- regardless of who started the conversation.
  user_one_id uuid references public.profiles(id) on delete cascade not null,
  user_two_id uuid references public.profiles(id) on delete cascade not null,
  requested_by uuid references public.profiles(id) on delete cascade not null,
  status text not null check (status in ('accepted','pending')) default 'pending',
  last_message_at timestamptz,
  last_message_body text,
  last_message_sender_id uuid references public.profiles(id) on delete set null,
  -- Each side's own "I've seen up to here" marker, so an unread badge
  -- doesn't need a per-message read receipt at all — see
  -- mark_conversation_read() below, the only way either column changes.
  user_one_last_read_at timestamptz,
  user_two_last_read_at timestamptz,
  created_at timestamptz not null default now(),
  check (user_one_id < user_two_id),
  unique (user_one_id, user_two_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.conversations(id) on delete cascade not null,
  sender_id uuid references public.profiles(id) on delete cascade not null,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists conversations_user_one_idx on public.conversations(user_one_id, last_message_at desc);
create index if not exists conversations_user_two_idx on public.conversations(user_two_id, last_message_at desc);
create index if not exists messages_conversation_idx on public.messages(conversation_id, created_at);

alter table public.conversations enable row level security;
alter table public.messages enable row level security;

-- ------------------------------------------------------------
-- HELPERS
-- ------------------------------------------------------------

-- Blocks are only ever readable by the blocker (see blocks_owner_all in
-- 2026-08-14_security_hardening.sql) so a plain policy subquery can't
-- see a block placed on the CURRENT user without bypassing that — same
-- reasoning as is_suspended() below, security definer to read across it
-- safely without exposing the blocks table itself more broadly.
create or replace function public.is_blocked(other_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.blocks
    where (blocker_id = auth.uid() and blocked_id = other_user)
       or (blocker_id = other_user and blocked_id = auth.uid())
  );
$$;
revoke all on function public.is_blocked(uuid) from public;
grant execute on function public.is_blocked(uuid) to authenticated;

-- Single source of truth for "can I post into this thread right now" —
-- used by the messages insert policy below. A named function here
-- (rather than inlining the same two checks into the policy) means
-- there's one place to change if the rule ever does.
create or replace function public.can_message_in(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.conversations c
    where c.id = p_conversation_id
      and (c.user_one_id = auth.uid() or c.user_two_id = auth.uid())
      and not public.is_blocked(case when c.user_one_id = auth.uid() then c.user_two_id else c.user_one_id end)
  );
$$;
revoke all on function public.can_message_in(uuid) from public;
grant execute on function public.can_message_in(uuid) to authenticated;

-- Marks MY side of a conversation as read. A generic UPDATE policy on
-- conversations would let either participant rewrite the other's
-- columns too (status, last_message_at, the other person's read marker)
-- since row-level security can't restrict which columns an UPDATE
-- touches — routing this through a function that only ever sets the
-- caller's own read column closes that off entirely, so no client-facing
-- UPDATE policy on conversations exists at all.
create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversations
  set user_one_last_read_at = case when user_one_id = auth.uid() then now() else user_one_last_read_at end,
      user_two_last_read_at = case when user_two_id = auth.uid() then now() else user_two_last_read_at end
  where id = p_conversation_id and (user_one_id = auth.uid() or user_two_id = auth.uid());
end;
$$;
revoke all on function public.mark_conversation_read(uuid) from public;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

-- ------------------------------------------------------------
-- TRIGGERS — the request/accepted rule is decided here, not by the
-- client, so there's no way to skip a request by just claiming one
-- isn't needed.
-- ------------------------------------------------------------

create or replace function public.set_conversation_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.follows where follower_id = new.user_one_id and following_id = new.user_two_id)
     and exists (select 1 from public.follows where follower_id = new.user_two_id and following_id = new.user_one_id)
  then
    new.status := 'accepted';
  else
    new.status := 'pending';
  end if;
  return new;
end;
$$;

drop trigger if exists conversations_before_insert on public.conversations;
create trigger conversations_before_insert
  before insert on public.conversations
  for each row execute procedure public.set_conversation_status();

-- Keeps the inbox preview (last_message_*) current with zero extra
-- queries from the client, and auto-accepts a pending request the
-- moment the recipient actually replies — exactly what "reply to
-- accept" means, enforced here rather than trusted from the client.
create or replace function public.handle_new_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversations
  set last_message_at = new.created_at,
      last_message_body = new.body,
      last_message_sender_id = new.sender_id,
      status = case when status = 'pending' and new.sender_id <> requested_by then 'accepted' else status end
  where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists messages_after_insert on public.messages;
create trigger messages_after_insert
  after insert on public.messages
  for each row execute procedure public.handle_new_message();

-- ------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ------------------------------------------------------------

drop policy if exists "conversations_read_participant" on public.conversations;
create policy "conversations_read_participant" on public.conversations
  for select using (auth.uid() = user_one_id or auth.uid() = user_two_id);

drop policy if exists "conversations_owner_insert" on public.conversations;
create policy "conversations_owner_insert" on public.conversations
  for insert with check (
    (auth.uid() = user_one_id or auth.uid() = user_two_id)
    and requested_by = auth.uid()
    and not public.is_suspended()
    and not public.is_blocked(case when user_one_id = auth.uid() then user_two_id else user_one_id end)
  );

-- Either side can delete the whole thread — leaving, or declining a
-- request without ever having to open it.
drop policy if exists "conversations_participant_delete" on public.conversations;
create policy "conversations_participant_delete" on public.conversations
  for delete using (auth.uid() = user_one_id or auth.uid() = user_two_id);

drop policy if exists "messages_read_participant" on public.messages;
create policy "messages_read_participant" on public.messages
  for select using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id and (c.user_one_id = auth.uid() or c.user_two_id = auth.uid())
    )
  );

drop policy if exists "messages_owner_insert" on public.messages;
create policy "messages_owner_insert" on public.messages
  for insert with check (
    sender_id = auth.uid() and not public.is_suspended() and public.can_message_in(conversation_id)
  );

-- ------------------------------------------------------------
-- REALTIME — so an open thread updates live and the inbox can refresh
-- itself the moment something changes, no polling. Guarded so re-running
-- this file doesn't error on "already a member of publication".
-- ------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversations'
  ) then
    alter publication supabase_realtime add table public.conversations;
  end if;
end $$;

notify pgrst, 'reload schema';
