-- ============================================================
-- MESSAGE REACTIONS, REPLIES, GIFS/STICKERS, DELETE — run once in
-- the Supabase SQL Editor. Requires 2026-08-19_messaging.sql to have
-- already been run. Safe to run more than once.
-- ============================================================

-- 'kind' distinguishes what `body` actually holds: plain text, a GIF
-- URL, or a single emoji sent big (a "sticker"). One column instead of
-- three nullable ones — a message is always exactly one of these.
alter table public.messages add column if not exists kind text not null default 'text' check (kind in ('text','gif','sticker'));

-- Nullable, and set null (not cascaded) if the original is deleted — a
-- reply should survive its original message being removed, just
-- without anything left to quote.
alter table public.messages add column if not exists reply_to_id uuid references public.messages(id) on delete set null;

-- The inbox preview (conversations.last_message_body, set by
-- handle_new_message() in 2026-08-19_messaging.sql) has no way to say
-- "this is a GIF, don't render the raw URL as text" without also
-- knowing the message's kind — this is that, denormalized the same way.
alter table public.conversations add column if not exists last_message_kind text;

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
      last_message_kind = new.kind,
      last_message_sender_id = new.sender_id,
      status = case when status = 'pending' and new.sender_id <> requested_by then 'accepted' else status end
  where id = new.conversation_id;
  return new;
end;
$$;

-- ------------------------------------------------------------
-- Deleting your own message. There was no delete policy on messages at
-- all before this — only whole conversations could be removed.
-- ------------------------------------------------------------
drop policy if exists "messages_owner_delete" on public.messages;
create policy "messages_owner_delete" on public.messages
  for delete using (sender_id = auth.uid());

-- ------------------------------------------------------------
-- A reply pointing at a message from a DIFFERENT conversation isn't a
-- security hole (RLS still hides anything you're not part of) but is a
-- malformed row nobody should be able to construct — silently dropped
-- rather than failing the whole send over it.
-- ------------------------------------------------------------
create or replace function public.validate_reply_to()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.reply_to_id is not null and not exists (
    select 1 from public.messages where id = new.reply_to_id and conversation_id = new.conversation_id
  ) then
    new.reply_to_id := null;
  end if;
  return new;
end;
$$;

drop trigger if exists messages_before_insert_validate_reply on public.messages;
create trigger messages_before_insert_validate_reply
  before insert on public.messages
  for each row execute procedure public.validate_reply_to();

-- ------------------------------------------------------------
-- REACTIONS — one per person per message (tapping a different emoji
-- replaces yours, same as iMessage tapbacks, not Discord's stack of
-- many). The primary key IS that rule, not just an index for it.
-- ------------------------------------------------------------
create table if not exists public.message_reactions (
  message_id uuid references public.messages(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  emoji text not null check (char_length(emoji) between 1 and 8),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
create index if not exists message_reactions_message_idx on public.message_reactions(message_id);

alter table public.message_reactions enable row level security;

drop policy if exists "reactions_read_participant" on public.message_reactions;
create policy "reactions_read_participant" on public.message_reactions
  for select using (
    exists (
      select 1 from public.messages m
      join public.conversations c on c.id = m.conversation_id
      where m.id = message_id and (c.user_one_id = auth.uid() or c.user_two_id = auth.uid())
    )
  );

drop policy if exists "reactions_owner_insert" on public.message_reactions;
create policy "reactions_owner_insert" on public.message_reactions
  for insert with check (
    user_id = auth.uid() and not public.is_suspended()
    and exists (select 1 from public.messages m where m.id = message_id and public.can_message_in(m.conversation_id))
  );

drop policy if exists "reactions_owner_update" on public.message_reactions;
create policy "reactions_owner_update" on public.message_reactions
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "reactions_owner_delete" on public.message_reactions;
create policy "reactions_owner_delete" on public.message_reactions
  for delete using (user_id = auth.uid());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_reactions'
  ) then
    alter publication supabase_realtime add table public.message_reactions;
  end if;
end $$;

notify pgrst, 'reload schema';
