-- ============================================================
-- RAISE HOURS CAP TO 20,000 — run once in the Supabase SQL Editor.
-- Safe to run more than once.
-- ============================================================
--
-- The log sheet's hours ruler now scrolls all the way to 20,000 hours
-- (live-service and MMO playtimes really do reach that). The original
-- check constraint capped hours_played at 10,000, so any value above
-- that would be rejected on save. This swaps the constraint for the new
-- ceiling. The numeric(6,1) column type already allows up to 99,999.9,
-- so no type change is needed.

alter table public.logs drop constraint if exists logs_hours_played_range;

alter table public.logs add constraint logs_hours_played_range
  check (hours_played is null or (hours_played >= 0 and hours_played <= 20000));

notify pgrst, 'reload schema';
