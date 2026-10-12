-- Stops ordinary users from rewriting the shared game catalogue.
--
-- Before: the games UPDATE policy only checked "is logged in", so any signed-up user could change the
-- title, cover, description and so on of ANY game, for everyone.
--
-- After: a BEFORE UPDATE trigger decides, per column, what an ordinary signed-in user may change.
-- It quietly keeps the old value for anything not allowed, so the rest of the update (for example the
-- "already enriched" flag) still goes through and the app's own background enrichment never breaks.
--
--   locked        never changed by an ordinary user: identity and moderation fields
--   fill-only     may be set only while empty (the app's one-time enrichment from IGDB); never overwritten
--   free          caches the app writes itself: enrichment flag, cast, logo-fetch flag
--
-- Admins and trusted server paths (no end-user JWT: the service role, edge functions, the SQL editor)
-- are not restricted. Safe to re-run.

create or replace function public.guard_game_update()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  o jsonb;
  n jsonb;
  k text;
  locked text[] := array[
    'id', 'title', 'added_by', 'created_at', 'is_hidden', 'platform', 'release_year', 'release_date',
    'genre', 'developer', 'igdb_id', 'rawg_id', 'rawg_enriched', 'steam_cover_url', 'director_name',
    'director_rawg_id', 'director_image_url', 'playtime_hours', 'players_count'
  ];
  fill_only text[] := array[
    'description', 'cover_url', 'background_url', 'publisher', 'studio_id', 'studio_name',
    'studio_logo_url', 'trailer_url', 'logo_url', 'grid_url'
  ];
begin
  -- admins, and anything with no end-user identity (service role, edge functions, SQL editor)
  if auth.uid() is null or public.is_app_admin() then
    return new;
  end if;

  o := to_jsonb(old);
  n := to_jsonb(new);

  foreach k in array locked loop
    n := jsonb_set(n, array[k], o -> k);
  end loop;

  foreach k in array fill_only loop
    if (o ->> k) is not null and (o ->> k) <> '' then
      n := jsonb_set(n, array[k], o -> k);
    end if;
  end loop;

  new := jsonb_populate_record(new, n);
  return new;
end;
$$;

drop trigger if exists games_guard_update on public.games;
create trigger games_guard_update
  before update on public.games
  for each row execute function public.guard_game_update();
