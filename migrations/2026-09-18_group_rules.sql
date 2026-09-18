-- ============================================================
-- GROUP RULES / DESCRIPTION
-- ============================================================
-- The remaining piece of "group admin control like rules, remove member,
-- rename, photos": a line (or several) the admin sets for the group,
-- shown in its info sheet. Rename, photo and member removal all landed
-- in 2026-09-18_chat_upgrades.sql.

alter table public.conversations add column if not exists description text;

-- Folded into the same function rather than a second one, for the same
-- reason it exists at all: an UPDATE policy on conversations is
-- all-or-nothing about columns, and this way the only columns any client
-- can write are the three named here.
create or replace function public.update_group_details(
  p_conversation_id uuid,
  p_title text default null,
  p_avatar_url text default null,
  p_clear_avatar boolean default false,
  p_description text default null
)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_convo_creator(p_conversation_id) then
    raise exception 'Only the group admin can change this';
  end if;
  if public.is_suspended() then
    raise exception 'Account suspended';
  end if;

  update public.conversations
     set title = case
           when p_title is null then title
           -- An all-whitespace name is a way to end up with an unnamed
           -- group by accident, so it reads as "no change" instead.
           when length(btrim(p_title)) = 0 then title
           else left(btrim(p_title), 60)
         end,
         avatar_url = case
           when p_clear_avatar then null
           when p_avatar_url is null then avatar_url
           else p_avatar_url
         end,
         description = case
           when p_description is null then description
           -- Unlike the title, empty here is a real instruction: it is
           -- how an admin removes the rules again.
           when length(btrim(p_description)) = 0 then null
           else left(btrim(p_description), 500)
         end
   where id = p_conversation_id and is_group;
end;
$$;

-- The old four-argument signature would otherwise still exist alongside
-- the new five-argument one, and PostgREST would have two overloads to
-- choose between for the same call.
drop function if exists public.update_group_details(uuid, text, text, boolean);

revoke all on function public.update_group_details(uuid, text, text, boolean, text) from public;
grant execute on function public.update_group_details(uuid, text, text, boolean, text) to authenticated;

notify pgrst, 'reload schema';
