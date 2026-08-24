-- ============================================================
-- GAMES TABLE — allow caching enriched details. Run once in the
-- Supabase SQL Editor. Safe to run more than once.
-- ============================================================
--
-- enrichGameDetails() (js/api.js) fetches a game's full description,
-- credited studio, trailer, and a real portrait cover from IGDB the
-- first time its page is opened, then tries to save that onto the
-- game's row (igdb_enriched = true) so it never has to be fetched
-- again. The games table has never had an UPDATE policy, though — with
-- row level security on and no matching policy, Postgres denies every
-- update by default. The save has been silently failing ever since,
-- so igdb_enriched never actually persists: EVERY visit to an
-- unenriched game's page re-fetches the same details from IGDB, fails
-- to save them again, and leaves the exact same work for the next
-- visitor. This is what made those pages slow to open.
--
-- Mirrors games_authenticated_insert's own reasoning: any signed-in
-- user is trusted to add a new game to the shared catalogue, so the
-- same trust level covers filling in details on one that already
-- exists. Not owner-scoped like a personal record (logs, reviews) —
-- games are shared catalogue data everyone reads the same copy of.

drop policy if exists "games_authenticated_update" on public.games;
create policy "games_authenticated_update" on public.games
  for update using (auth.uid() is not null)
  with check (auth.uid() is not null);
