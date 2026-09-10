-- ============================================================
-- PLATFORM ON IMPORTED GAMES — run once in the Supabase SQL Editor.
-- Safe to run more than once.
-- ============================================================
--
-- Which console a game was played on is the difference between two rows
-- that otherwise read identically: "The Last of Us Part II" on PS4 and
-- "The Last of Us Part II Remastered" on PS5 are separate games, and a
-- list that doesn't say so looks like it is repeating itself.
--
-- Stored as a short display label ("PS5", "PS4", or "PS4 · PS5" when the
-- same game was played on both and the two imports were folded into one)
-- rather than PSN's raw category strings, because that is what gets
-- shown and nothing needs to query on it.

alter table public.imported_games
  add column if not exists platform_label text;

-- Existing RLS on `imported_games` already restricts writes to the row's
-- owner, so the new column inherits the correct protection with no
-- policy change needed.

notify pgrst, 'reload schema';
