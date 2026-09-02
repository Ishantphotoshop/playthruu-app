-- ============================================================
-- PLAYTHRUU MESSAGE KINDS — run once in the Supabase SQL Editor.
-- Safe to run more than once.
-- ============================================================
--
-- The Messenger redesign makes Playthruu content first-class inside a
-- conversation. The first of those is the Game Card: a message whose
-- kind is 'game' and whose body holds a game id (rendered as a rich card
-- that taps through to the game, instead of a dead URL).
--
-- messages.kind was locked by a CHECK to text/gif/sticker/image/video.
-- This widens it to also allow 'game' now, plus 'review' and 'list' so
-- the follow-up card types don't each need their own migration. The body
-- column already accepts a 36-char uuid (its 1..2000 length check is
-- untouched), so nothing else changes.

alter table public.messages
  drop constraint if exists messages_kind_check;

alter table public.messages
  add constraint messages_kind_check
  check (kind = any (array['text','gif','sticker','image','video','game','review','list']));

notify pgrst, 'reload schema';
