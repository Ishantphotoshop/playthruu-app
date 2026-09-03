-- ============================================================
-- PRESENCE FOR CONVERSATIONS — run once in the Supabase SQL Editor.
-- Safe to run more than once.
-- ============================================================
--
-- Depends on 2026-09-02_presence_and_moderation.sql (user_presence).
--
-- The Messenger shows "Active now / Active 4m ago" and an online dot for
-- the person you're talking to. user_presence was previously readable
-- only by its owner (and admins), for privacy. This adds a narrow third
-- path: you can read the presence of someone you already have a
-- conversation with — nobody else. It does NOT expose presence app-wide;
-- a stranger's online status stays private.

drop policy if exists user_presence_convo_read on public.user_presence;
create policy user_presence_convo_read
  on public.user_presence for select
  using (
    exists (
      select 1 from public.conversations c
      where (c.user_one_id = auth.uid() and c.user_two_id = user_presence.user_id)
         or (c.user_two_id = auth.uid() and c.user_one_id = user_presence.user_id)
    )
  );

notify pgrst, 'reload schema';
