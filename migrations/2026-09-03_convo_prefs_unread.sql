-- ============================================================
-- CONVERSATION_PREFS: manual "mark as unread" flag.
-- Run once in the Supabase SQL Editor. Safe to run more than once.
-- ============================================================
--
-- The computed unread state (in api.shapeConversation) is only ever true
-- when the LAST message was from the other person — so "mark as unread"
-- did nothing on a chat where you sent last. This adds a manual override
-- the inbox ORs in, cleared when you open the chat. Purely additive.

alter table public.conversation_prefs
  add column if not exists unread boolean not null default false;

notify pgrst, 'reload schema';
