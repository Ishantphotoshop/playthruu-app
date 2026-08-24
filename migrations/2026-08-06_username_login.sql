-- Lets people log in with their username instead of their email.
--
-- Supabase Auth only knows email/password, not usernames, so this
-- function looks up the email for a given username server-side (using
-- elevated privileges via SECURITY DEFINER) and hands back just that
-- one email string. It never exposes the full profiles/auth tables,
-- and it's the only thing the anon key is allowed to call it for.
--
-- Run this once in Supabase dashboard -> SQL Editor -> New query -> Run.

create or replace function public.get_email_for_username(uname text)
returns text
language sql
security definer
set search_path = public
as $$
  select au.email
  from auth.users au
  join public.profiles p on p.id = au.id
  where lower(p.username) = lower(uname)
  limit 1;
$$;

-- Only let it be called, not read as a table; and only by people
-- hitting the login form (anon) or already logged in (authenticated).
revoke all on function public.get_email_for_username(text) from public;
grant execute on function public.get_email_for_username(text) to anon, authenticated;
