-- ============================================================
-- IMAGE/VIDEO UPLOADS IN MESSAGES — run once in the Supabase SQL
-- Editor. Requires 2026-08-19_message-reactions-replies.sql to have
-- already been run. Safe to run more than once.
-- ============================================================

-- Public bucket, same trade-off as 'avatars' in schema.sql: a plain URL
-- rather than a signed one that expires, meaning anyone who somehow got
-- the URL could view the file without being a participant — but the
-- URL itself is never listed or guessable (a random id inside a
-- per-conversation folder), so this is "unlisted," the same privacy
-- model avatars already use, not a new one invented for this.
insert into storage.buckets (id, name, public)
  values ('message-media', 'message-media', true)
  on conflict (id) do nothing;

drop policy if exists "message_media_public_read" on storage.objects;
create policy "message_media_public_read" on storage.objects
  for select using (bucket_id = 'message-media');

-- Uploads ARE restricted, even though reads aren't — the path's first
-- folder segment is the conversation id, and only its two participants
-- can write into it. This is what stops a signed-in stranger uploading
-- into (or overwriting) a conversation they have nothing to do with.
drop policy if exists "message_media_participant_write" on storage.objects;
create policy "message_media_participant_write" on storage.objects
  for insert with check (
    bucket_id = 'message-media' and exists (
      select 1 from public.conversations c
      where c.id::text = (storage.foldername(name))[1]
        and (c.user_one_id = auth.uid() or c.user_two_id = auth.uid())
    )
  );

drop policy if exists "message_media_participant_delete" on storage.objects;
create policy "message_media_participant_delete" on storage.objects
  for delete using (
    bucket_id = 'message-media' and exists (
      select 1 from public.conversations c
      where c.id::text = (storage.foldername(name))[1]
        and (c.user_one_id = auth.uid() or c.user_two_id = auth.uid())
    )
  );

-- Widen messages.kind to allow 'image' and 'video' alongside the
-- text/gif/sticker set from the previous migration. Postgres names an
-- inline column CHECK "<table>_<column>_check" by default, which is
-- what's being dropped here before re-adding it with the wider list.
alter table public.messages drop constraint if exists messages_kind_check;
alter table public.messages add constraint messages_kind_check
  check (kind in ('text','gif','sticker','image','video'));

notify pgrst, 'reload schema';
