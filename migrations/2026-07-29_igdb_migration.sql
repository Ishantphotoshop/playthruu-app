-- IGDB MIGRATION — run this once in Supabase SQL Editor against your
-- existing Questlog project. Safe to run more than once.
--
-- This switches the game catalog's data source from RAWG to IGDB. It's
-- purely additive: every RAWG-era column (rawg_id, steam_cover_url,
-- director_name, director_rawg_id, director_image_url, rawg_enriched)
-- is left in place untouched, so any game already in your catalog keeps
-- working exactly as before. New games added from this point on will
-- populate the columns below instead.
--
-- You'll also need to deploy the igdb-proxy Edge Function and set your
-- Twitch Client ID/Secret as Supabase secrets — see README.md.

alter table public.games add column if not exists background_url text;
alter table public.games add column if not exists igdb_id integer;
alter table public.games add column if not exists studio_id integer;
alter table public.games add column if not exists studio_name text;
alter table public.games add column if not exists studio_logo_url text;
alter table public.games add column if not exists igdb_enriched boolean default false not null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'games_igdb_id_key') then
    alter table public.games add constraint games_igdb_id_key unique (igdb_id);
  end if;
end $$;

-- PostgREST can retain an old schema cache after a column migration.
notify pgrst, 'reload schema';
