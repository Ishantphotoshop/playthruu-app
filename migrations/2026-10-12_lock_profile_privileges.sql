-- Closes a privilege-escalation hole on public.profiles.
--
-- The hole: profiles_owner_delete let any signed-in user delete their own profile row, and
-- profiles_owner_insert only checked auth.uid() = id. The existing BEFORE UPDATE guard
-- (guard_profile_privileges) never runs on INSERT, so a user could delete their row and
-- immediately re-insert it with is_admin = true (or is_suspended = false to dodge a ban).
--
-- The fix, in two parts:
--   1. A BEFORE INSERT guard: only an admin (or a trusted server path with no end-user JWT:
--      the signup trigger handle_new_user, the service role, the SQL editor) may create a profile
--      row with is_admin or is_suspended set.
--   2. Remove the client-side delete permission. The app never deletes profile rows directly;
--      "Delete my account" goes through the delete-account edge function (service role).
--
-- Safe to re-run.

create or replace function public.guard_profile_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if (new.is_admin or new.is_suspended) then
    -- auth.uid() is null for the signup trigger, the service role and the SQL editor.
    if auth.uid() is not null and not public.is_app_admin() then
      raise exception 'Only an admin can create a profile with is_admin or is_suspended set'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_insert on public.profiles;
create trigger profiles_guard_insert
  before insert on public.profiles
  for each row execute function public.guard_profile_insert();

drop policy if exists profiles_owner_delete on public.profiles;
