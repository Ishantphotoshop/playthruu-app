-- ============================================================
-- PSN AUTO-LOGGING — run once in the Supabase SQL Editor.
-- Safe to run more than once.
-- ============================================================
--
-- Connecting a PlayStation account now reads trophies to work out which
-- games were actually FINISHED (platinum, every trophy, or a "complete
-- the story" trophy) and writes those into the diary as `played` logs,
-- dated by when the trophy was earned.
--
-- This column is what stops that from happening twice. Without it, a
-- re-sync would re-create an entry the user had deliberately deleted,
-- and there'd be no way to tell "never auto-logged" apart from "logged
-- once and then removed". Set the moment a row's log is written; the
-- sync only ever considers rows where it is still null.
--
-- It deliberately survives re-syncs: connectPsnAccount() upserts
-- imported_games without naming this column, so ON CONFLICT DO UPDATE
-- leaves whatever is already there untouched.

alter table public.imported_games
  add column if not exists auto_logged_at timestamptz;

-- Existing RLS on `imported_games` already restricts writes to the row's
-- owner, so the new column inherits the correct protection with no
-- policy change needed.

notify pgrst, 'reload schema';
