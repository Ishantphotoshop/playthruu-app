-- ============================================================
-- CHAT UPGRADES — group admin, voice notes
-- ============================================================
-- Three of the four things this migration supports need no schema at
-- all, which is worth saying out loud so nobody goes looking:
--
--   * Read receipts already have their data. conversation_participants
--     .last_read_at (groups) and conversations.user_*_last_read_at (DMs)
--     are written by mark_conversation_read() on every open, so "who has
--     seen this" is a comparison between that marker and a message's
--     created_at. It was only ever missing from the UI.
--
--   * Typing indicators are Realtime BROADCAST, not rows. A keystroke is
--     worthless three seconds later, so writing one to a table would be
--     a durable record of something inherently disposable — and a write
--     per keystroke per person besides.
--
--   * Searching inside a chat is an ilike over messages the reader can
--     already select.
--
-- What is left is a group photo, a way for the group's creator to change
-- the title and that photo, and a message kind for voice notes.

-- ---- group photo -------------------------------------------------------
alter table public.conversations add column if not exists avatar_url text;

-- ---- group admin -------------------------------------------------------
-- A SECURITY DEFINER function rather than an UPDATE policy on
-- conversations. An update policy is all-or-nothing about columns, so
-- it would also hand the creator last_message_body, the read markers and
-- the participant ids — none of which anyone should be able to write
-- directly. This can only ever touch the two fields it names.
create or replace function public.update_group_details(
  p_conversation_id uuid,
  p_title text default null,
  p_avatar_url text default null,
  p_clear_avatar boolean default false
)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_convo_creator(p_conversation_id) then
    raise exception 'Only the group admin can change this';
  end if;
  if public.is_suspended() then
    raise exception 'Account suspended';
  end if;

  update public.conversations
     set title = case
           when p_title is null then title
           -- An all-whitespace name is a way to end up with an unnamed
           -- group by accident, so it reads as "no change" instead.
           when length(btrim(p_title)) = 0 then title
           else left(btrim(p_title), 60)
         end,
         avatar_url = case
           when p_clear_avatar then null
           when p_avatar_url is null then avatar_url
           else p_avatar_url
         end
   where id = p_conversation_id and is_group;
end;
$$;
revoke all on function public.update_group_details(uuid, text, text, boolean) from public;
grant execute on function public.update_group_details(uuid, text, text, boolean) to authenticated;

-- Removing a member already works: convo_participants_delete lets the
-- creator delete anyone's row and lets anyone delete their own (leave).
-- Nothing to add here — noted so the absence doesn't look like an
-- oversight.

-- ---- voice notes -------------------------------------------------------
alter table public.messages drop constraint if exists messages_kind_check;
alter table public.messages add constraint messages_kind_check
  check (kind in ('text','gif','sticker','image','video','game','review','list','voice'));

-- Recorded length, so the bubble can draw a real waveform and a running
-- time before the audio has been fetched. Nullable because every other
-- kind has no duration, and unknown is a legitimate answer for an older
-- row or a recording whose metadata never resolved.
alter table public.messages add column if not exists duration_ms integer
  check (duration_ms is null or (duration_ms >= 0 and duration_ms <= 600000));

-- Searching a conversation is an ilike scan over one conversation's
-- messages. This makes that an index lookup rather than a sequential
-- read of the whole thread, which matters on the long ones.
create index if not exists messages_body_search_idx
  on public.messages using gin (to_tsvector('simple', body));

notify pgrst, 'reload schema';
