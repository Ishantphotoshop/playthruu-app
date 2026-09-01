-- ============================================================
-- LOVED TOGGLE — run once in the Supabase SQL Editor.
-- Safe to run more than once.
-- ============================================================
--
-- Independent of the star rating (a Letterboxd-style ❤️, not a
-- replacement for it) — someone can rate a game 3 stars and still mark
-- it loved, or love it with no rating at all. The log sheet already
-- had a "Love" quick-action button with its own icon, haptic buzz and
-- pop animation, but nothing on `logs` to actually persist the tap to
-- — the button toggled a local variable that was never included in
-- what got saved.

alter table public.logs
  add column if not exists loved boolean not null default false;

-- Existing RLS on `logs` already restricts writes to the row's owner,
-- so the new column inherits the correct protection with no policy
-- change needed.

notify pgrst, 'reload schema';
