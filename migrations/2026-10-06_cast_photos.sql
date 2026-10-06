-- ============================================================
-- CAST — a photo for each person
-- ============================================================
-- Run after 2026-10-06_cast.sql. Safe to run more than once.
--
-- The URL of a photo, not the photo: still text, still bytes rather
-- than megabytes, and the picture itself stays on Wikimedia's servers
-- where it is already being served to the world. Portraits come from
-- the Wikipedia page summary API — free, public, no key, and the same
-- Commons photos the app already showed next to a director.
--
-- image_checked records that a person has been LOOKED UP, which is not
-- the same as having a photo. Plenty of voice actors have no Wikipedia
-- article at all; without this flag every one of them would be looked
-- up again on every lookup, forever, for an answer that will not change.

alter table public.people add column if not exists image_url text;
alter table public.people add column if not exists image_checked boolean not null default false;
