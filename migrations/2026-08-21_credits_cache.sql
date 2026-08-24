-- ============================================================
-- GAMES TABLE — cache cast/director lookups. Run once in the
-- Supabase SQL Editor. Safe to run more than once.
-- ============================================================
--
-- getGameCastAndDirector() (js/api.js) chains up to 5 external
-- requests (a RAWG search + team lookup, a Wikidata entity search +
-- SPARQL query) every time a game page loads, and never saved the
-- result anywhere — so the exact same 2-3+ second lookup reran on
-- EVERY visit to EVERY game, forever, for everyone, even the same
-- person opening the same game twice in a row. Confirmed by direct
-- measurement: on a repeat visit to the same already-enriched game,
-- every other step resolved in ~500ms while this one alone took
-- 2.1s the first time and 3.3s (timeout) the second.
--
-- Same fix as igdb_enriched/enrichGameDetails: cache the result on
-- the row after the first real fetch, so every visit after that is
-- instant instead of repeating the same slow external chain. Covered
-- by the existing games_authenticated_update policy (see
-- 2026-08-21_games_enrichment_update.sql) — no new RLS needed.

alter table public.games add column if not exists credits_json jsonb;
alter table public.games add column if not exists credits_fetched boolean default false not null;
