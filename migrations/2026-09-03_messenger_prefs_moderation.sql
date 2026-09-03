-- ============================================================
-- MESSENGER PREFS + MODERATION — run once in the Supabase SQL Editor.
-- Safe to run more than once.
-- ============================================================
--
-- Backs the per-chat 3-dot menu in the inbox: Pin, Mute, Mark-as-unread,
-- Nickname, Block, Report. Purely ADDITIVE — new tables + one new RPC,
-- with row-level security scoped to the owner. Nothing here alters the
-- conversations/messages tables or their existing policies, so current
-- 1:1 messaging is untouched.

-- ---- per-user, per-conversation preferences (pin / mute / nickname) ----
create table if not exists public.conversation_prefs (
  user_id         uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  pinned          boolean not null default false,
  muted           boolean not null default false,
  nickname        text,
  updated_at      timestamptz not null default now(),
  primary key (user_id, conversation_id)
);
alter table public.conversation_prefs enable row level security;
drop policy if exists conversation_prefs_own on public.conversation_prefs;
create policy conversation_prefs_own on public.conversation_prefs
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---- blocks (one direction: blocker hides/prevents the blocked) ----
create table if not exists public.user_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);
alter table public.user_blocks enable row level security;
-- You manage (and can see) only the blocks you created.
drop policy if exists user_blocks_own on public.user_blocks;
create policy user_blocks_own on public.user_blocks
  for all using (blocker_id = auth.uid()) with check (blocker_id = auth.uid());

-- ---- reports (insert-only for the reporter; admins read) ----
create table if not exists public.user_reports (
  id              uuid primary key default gen_random_uuid(),
  reporter_id     uuid not null references public.profiles(id) on delete cascade,
  reported_id     uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  reason          text,
  created_at      timestamptz not null default now()
);
alter table public.user_reports enable row level security;
drop policy if exists user_reports_insert on public.user_reports;
create policy user_reports_insert on public.user_reports
  for insert with check (reporter_id = auth.uid());
drop policy if exists user_reports_admin_read on public.user_reports;
create policy user_reports_admin_read on public.user_reports
  for select using (public.is_app_admin());

-- ---- mark a conversation UNREAD ----
-- The mirror of mark_conversation_read: pushes MY last-read marker back to
-- just before the last message so the row reads as unread again. Definer so
-- it can touch the read columns the same way the read RPC does.
create or replace function public.mark_conversation_unread(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversations
     set user_one_last_read_at = case
           when user_one_id = auth.uid()
           then coalesce(last_message_at, now()) - interval '1 second'
           else user_one_last_read_at end,
         user_two_last_read_at = case
           when user_two_id = auth.uid()
           then coalesce(last_message_at, now()) - interval '1 second'
           else user_two_last_read_at end
   where id = p_conversation_id
     and (user_one_id = auth.uid() or user_two_id = auth.uid());
end;
$$;
grant execute on function public.mark_conversation_unread(uuid) to authenticated;

notify pgrst, 'reload schema';
