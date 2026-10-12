-- Admin log: a record of what each admin did in the control room (suspending
-- someone, resolving a report, deleting a review, hiding a game...). Written
-- by the admin app after each action. Admins can read it and add to it, but
-- nobody can edit or delete an entry, so it can be trusted afterwards.
create table if not exists public.admin_audit (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  actor_name text,
  action text not null,
  target_type text,
  target_id text,
  summary text not null,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_created_idx on public.admin_audit (created_at desc);

alter table public.admin_audit enable row level security;

drop policy if exists admin_audit_read on public.admin_audit;
create policy admin_audit_read on public.admin_audit
  for select to authenticated
  using (public.is_app_admin());

drop policy if exists admin_audit_insert on public.admin_audit;
create policy admin_audit_insert on public.admin_audit
  for insert to authenticated
  with check (public.is_app_admin() and actor_id = auth.uid());

-- Deliberately no update or delete policy: entries are permanent.
