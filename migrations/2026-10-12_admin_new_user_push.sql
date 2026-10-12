-- A phone notification to every admin when someone signs up. The profile
-- row is created by the signup trigger (handle_new_user); this fires after
-- it and hands the new user's id to send-push, which looks up the admins'
-- devices. Uses the same Vault secrets as notify_push_on_insert, and like
-- it never blocks a signup: anything going wrong here is swallowed.
create or replace function public.notify_admins_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  hook_url text;
  hook_secret text;
begin
  select decrypted_secret into hook_url from vault.decrypted_secrets where name = 'push_hook_url';
  select decrypted_secret into hook_secret from vault.decrypted_secrets where name = 'push_hook_secret';
  if hook_url is null or hook_secret is null then
    return new;
  end if;
  begin
    perform net.http_post(
      url := hook_url,
      body := jsonb_build_object('new_user_id', new.id),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', hook_secret),
      timeout_milliseconds := 5000
    );
  exception when others then
    null;
  end;
  return new;
end;
$$;

revoke all on function public.notify_admins_new_user() from public, anon, authenticated;

drop trigger if exists trg_notify_admins_new_user on public.profiles;
create trigger trg_notify_admins_new_user
  after insert on public.profiles
  for each row execute function public.notify_admins_new_user();
