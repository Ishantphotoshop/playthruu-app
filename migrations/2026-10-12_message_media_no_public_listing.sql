-- Stops strangers from listing the message-media bucket.
--
-- message_media_public_read let anyone, with no login, list every conversation folder and file
-- in the bucket through the storage API. Images inside chats were therefore findable by anyone.
--
-- Images still load the way they do now: the app shows them through public URLs
-- (getPublicUrl), and a public bucket serves a file to anyone who has its exact URL without
-- needing a policy. What changes is that nobody can *list* the bucket any more, except the
-- people in that conversation.
--
-- (A stronger version, for later: make the bucket private and show images through short-lived
-- signed URLs, so that even a copied link stops working.)
--
-- Safe to re-run.

drop policy if exists message_media_public_read on storage.objects;
drop policy if exists message_media_participant_read on storage.objects;

create policy message_media_participant_read
  on storage.objects
  for select
  using (
    bucket_id = 'message-media'
    and exists (
      select 1
      from public.conversations c
      where c.id::text = (storage.foldername(objects.name))[1]
        and (
          c.user_one_id = auth.uid()
          or c.user_two_id = auth.uid()
          or public.is_convo_member(c.id)
        )
    )
  );
