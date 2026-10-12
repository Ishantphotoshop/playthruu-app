-- Reports: the admin panel marks a report 'resolved', but the status check
-- only allowed open / reviewed / dismissed, so Resolve failed with
-- "violates check constraint reports_status_check". Allow 'resolved' too
-- (the old values stay valid, nothing existing changes).
alter table public.reports drop constraint if exists reports_status_check;
alter table public.reports add constraint reports_status_check
  check (status = any (array['open', 'reviewed', 'dismissed', 'resolved']));

-- Acting on a report: admins can already delete lists, games and comments,
-- but not someone's log/review. Let them, so "Delete review" on a reported
-- review works. Same rule as the others: is_app_admin().
drop policy if exists logs_admin_delete on public.logs;
create policy logs_admin_delete on public.logs
  for delete to authenticated
  using (public.is_app_admin());
