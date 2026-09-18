-- ============================================================
-- WEB PUSH — hand every new notification to the push sender
-- ============================================================
-- The last gap in notifications: until now they only ever arrived while
-- the app was alive, because the realtime subscription is a WebSocket
-- inside the page. An app swiped out of recents has no WebSocket, so it
-- had no way to hear about anything.
--
-- A Web Push subscription belongs to the browser's push service rather
-- than to the page, so it outlives the tab. This trigger is what tells
-- the sender there is something to deliver.
--
-- pg_net, not a synchronous HTTP call: net.http_post QUEUES the request
-- and returns immediately, so a slow or unreachable push service cannot
-- make somebody's "follow" button hang, and cannot roll back the
-- notification row either. Delivery is genuinely best-effort, which is
-- the right trade — the row is already written, the badge already works,
-- and the in-app hub is already correct whether or not a push lands.

create extension if not exists pg_net with schema extensions;

-- The shared secret and the function URL live in Vault, NOT in this
-- file, because this file is in git. Both are set out of band, once:
--
--   select vault.create_secret('<the PUSH_HOOK_SECRET value>', 'push_hook_secret');
--   select vault.create_secret('https://<ref>.supabase.co/functions/v1/send-push', 'push_hook_url');
--
-- The function checks that secret before it does anything else, so a
-- leaked copy of this migration gives nobody the ability to send a push.

create or replace function public.notify_push_on_insert()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare
  hook_url text;
  hook_secret text;
begin
  select decrypted_secret into hook_url from vault.decrypted_secrets where name = 'push_hook_url';
  select decrypted_secret into hook_secret from vault.decrypted_secrets where name = 'push_hook_secret';
  -- Not configured is a normal state, not an error: the app works
  -- perfectly well with no push at all, and failing the insert would
  -- break following somebody over an optional delivery channel.
  if hook_url is null or hook_secret is null then
    return new;
  end if;

  begin
    perform net.http_post(
      url := hook_url,
      body := jsonb_build_object('notification_id', new.id),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-push-secret', hook_secret
      ),
      timeout_milliseconds := 5000
    );
  exception when others then
    -- Same reasoning as above, one level down: whatever went wrong in
    -- the queueing itself, the notification row still stands.
    null;
  end;

  return new;
end;
$$;

revoke all on function public.notify_push_on_insert() from public;

drop trigger if exists trg_notify_push on public.notifications;
create trigger trg_notify_push
  after insert on public.notifications
  for each row execute function public.notify_push_on_insert();

notify pgrst, 'reload schema';
