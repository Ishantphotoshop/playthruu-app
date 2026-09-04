-- ============================================================
-- CONVERSATION_PREFS: "restrict" flag (Instagram-style soft block).
-- Run once in the Supabase SQL Editor. Safe to run more than once.
-- ============================================================
-- A restricted chat is hidden from the main Chats list (their messages
-- still arrive silently); you un-restrict it from Settings. Purely additive.
alter table public.conversation_prefs
  add column if not exists restricted boolean not null default false;
notify pgrst, 'reload schema';
