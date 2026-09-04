-- ============================================================
-- GROUP CHATS — run once in the Supabase SQL Editor. Safe to re-run.
-- ============================================================
--
-- Extends the existing 1:1 conversations to also support group chats,
-- WITHOUT changing how DMs work. A DM is still a row with user_one_id /
-- user_two_id set (and all its existing policies/triggers unchanged); a
-- group is a row with is_group = true, those two columns NULL, a title and
-- created_by, and its members living in a new conversation_participants
-- table (which also carries each member's own read marker).
--
-- Every membership test used by a policy goes through a SECURITY DEFINER
-- helper (is_convo_member / is_convo_creator). That is deliberate: a policy
-- on conversations that queried conversation_participants, while a policy on
-- conversation_participants queried conversations, would recurse — the
-- definer helpers bypass RLS and break that cycle.

-- ---- columns -------------------------------------------------------------
alter table public.conversations add column if not exists is_group    boolean not null default false;
alter table public.conversations add column if not exists title       text;
alter table public.conversations add column if not exists created_by  uuid references public.profiles(id) on delete set null;

-- Groups have no canonical pair, so the pair columns must be nullable and
-- the "smaller id first" check only applies to DMs.
alter table public.conversations alter column user_one_id drop not null;
alter table public.conversations alter column user_two_id drop not null;
alter table public.conversations drop constraint if exists conversations_check;
alter table public.conversations drop constraint if exists conversations_pair_ck;
alter table public.conversations add constraint conversations_pair_ck check (
  is_group or (user_one_id is not null and user_two_id is not null and user_one_id < user_two_id)
);

-- ---- participants (group membership + per-member read marker) -----------
create table if not exists public.conversation_participants (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  last_read_at    timestamptz,
  joined_at       timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index if not exists convo_participants_user_idx on public.conversation_participants(user_id);
alter table public.conversation_participants enable row level security;

-- ---- membership helpers (definer → no policy recursion) -----------------
create or replace function public.is_convo_member(p_cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.conversations c
    where c.id = p_cid and (c.user_one_id = auth.uid() or c.user_two_id = auth.uid())
  ) or exists (
    select 1 from public.conversation_participants p
    where p.conversation_id = p_cid and p.user_id = auth.uid()
  );
$$;
revoke all on function public.is_convo_member(uuid) from public;
grant execute on function public.is_convo_member(uuid) to authenticated;

create or replace function public.is_convo_creator(p_cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.conversations c where c.id = p_cid and c.created_by = auth.uid());
$$;
revoke all on function public.is_convo_creator(uuid) from public;
grant execute on function public.is_convo_creator(uuid) to authenticated;

-- ---- conversations RLS (participant access ADDED, DM access kept) -------
drop policy if exists "conversations_read_participant" on public.conversations;
create policy "conversations_read_participant" on public.conversations
  for select using (public.is_convo_member(id));

drop policy if exists "conversations_owner_insert" on public.conversations;
create policy "conversations_owner_insert" on public.conversations
  for insert with check (
    requested_by = auth.uid() and not public.is_suspended() and (
      -- a DM: exactly as before
      (not is_group
        and (auth.uid() = user_one_id or auth.uid() = user_two_id)
        and not public.is_blocked(case when user_one_id = auth.uid() then user_two_id else user_one_id end))
      -- a group: creator opens it, members are added into participants after
      or (is_group and created_by = auth.uid())
    )
  );

drop policy if exists "conversations_participant_delete" on public.conversations;
create policy "conversations_participant_delete" on public.conversations
  for delete using (
    (not is_group and (auth.uid() = user_one_id or auth.uid() = user_two_id))
    or (is_group and created_by = auth.uid())
  );

-- ---- conversation_participants RLS --------------------------------------
drop policy if exists "convo_participants_read" on public.conversation_participants;
create policy "convo_participants_read" on public.conversation_participants
  for select using (public.is_convo_member(conversation_id));

-- The creator seeds the member list; anyone may add themselves (join).
drop policy if exists "convo_participants_insert" on public.conversation_participants;
create policy "convo_participants_insert" on public.conversation_participants
  for insert with check (public.is_convo_creator(conversation_id) or user_id = auth.uid());

-- Leave (remove yourself), or the creator removes a member.
drop policy if exists "convo_participants_delete" on public.conversation_participants;
create policy "convo_participants_delete" on public.conversation_participants
  for delete using (user_id = auth.uid() or public.is_convo_creator(conversation_id));

-- ---- messages RLS (groups via membership; DM path unchanged) ------------
drop policy if exists "messages_read_participant" on public.messages;
create policy "messages_read_participant" on public.messages
  for select using (public.is_convo_member(conversation_id));

create or replace function public.can_message_in(p_conversation_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.conversations c
    where c.id = p_conversation_id and (
      (c.is_group and public.is_convo_member(c.id))
      or (not c.is_group and (c.user_one_id = auth.uid() or c.user_two_id = auth.uid())
          and not public.is_blocked(case when c.user_one_id = auth.uid() then c.user_two_id else c.user_one_id end))
    )
  );
$$;
revoke all on function public.can_message_in(uuid) from public;
grant execute on function public.can_message_in(uuid) to authenticated;

-- ---- read marker: DM columns AND the group participant row --------------
create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.conversations
    set user_one_last_read_at = case when user_one_id = auth.uid() then now() else user_one_last_read_at end,
        user_two_last_read_at = case when user_two_id = auth.uid() then now() else user_two_last_read_at end
    where id = p_conversation_id and (user_one_id = auth.uid() or user_two_id = auth.uid());
  update public.conversation_participants
    set last_read_at = now()
    where conversation_id = p_conversation_id and user_id = auth.uid();
end;
$$;
revoke all on function public.mark_conversation_read(uuid) from public;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

-- ---- status trigger: a group is 'accepted' from the start ---------------
create or replace function public.set_conversation_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.is_group then
    new.status := 'accepted';
    return new;
  end if;
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

-- ---- realtime for participants (new group / member changes) -------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversation_participants'
  ) then
    alter publication supabase_realtime add table public.conversation_participants;
  end if;
end $$;

notify pgrst, 'reload schema';
