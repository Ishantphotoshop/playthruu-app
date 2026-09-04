-- ============================================================
-- FIX: the group creator counts as a member.
-- Run once in the Supabase SQL Editor. Safe to re-run.
-- ============================================================
-- createGroup does insert().select() — but right after the insert the
-- creator isn't in conversation_participants yet and a group has no
-- user_one/two, so the SELECT policy hid the returned row and Supabase
-- surfaced it as "new row violates row-level security policy". Treating
-- created_by as membership fixes reading the just-created group (and is
-- correct anyway: the creator IS in the group).
create or replace function public.is_convo_member(p_cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.conversations c
    where c.id = p_cid and (c.user_one_id = auth.uid() or c.user_two_id = auth.uid() or c.created_by = auth.uid())
  ) or exists (
    select 1 from public.conversation_participants p
    where p.conversation_id = p_cid and p.user_id = auth.uid()
  );
$$;
notify pgrst, 'reload schema';
