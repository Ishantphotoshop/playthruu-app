-- ============================================================
-- HOURS PLAYED — run once in the Supabase SQL Editor.
-- Safe to run more than once.
-- ============================================================
--
-- The log sheet now asks how long a game took to beat, but there was
-- nowhere to put the answer: `logs` had no hours column, and
-- `games.playtime_hours` is a single catalogue-wide figure, not
-- something each player can contribute to.
--
-- With this column the "Typical" figure on a game page can be derived
-- from what people actually recorded, instead of only ever showing the
-- static value that came from the games catalogue.

alter table public.logs
  add column if not exists hours_played numeric(6,1);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'logs_hours_played_range') then
    alter table public.logs add constraint logs_hours_played_range
      check (hours_played is null or (hours_played >= 0 and hours_played <= 10000));
  end if;
end $$;

-- Existing RLS on `logs` already restricts writes to the row's owner,
-- so the new column inherits the correct protection with no policy
-- change needed.

notify pgrst, 'reload schema';
