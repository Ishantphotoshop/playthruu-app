-- ============================================================
-- GAMES TABLE — cache the transparent title-logo PNG per game.
-- Run once in the Supabase SQL Editor. Safe to run more than once.
-- ============================================================
--
-- getGameLogo() (js/api.js) looks up a transparent-background title
-- logo for a game from SteamGridDB (via the steamgriddb-proxy Edge
-- Function) the first time its page is opened, so the game page can
-- show that instead of the plain text title. Same caching pattern as
-- credits_json/credits_fetched (2026-08-21_credits_cache.sql): save the
-- result on the row after the first real lookup so every later visit —
-- by anyone — is instant instead of re-querying SteamGridDB every time,
-- and `logo_fetched` records that a lookup was already tried even when
-- no logo exists for that game, so a miss doesn't get retried forever.
-- Covered by the existing games_authenticated_update policy — no new
-- RLS needed.

alter table public.games add column if not exists logo_url text;
alter table public.games add column if not exists logo_fetched boolean default false not null;
