-- Row-level security for every table (build-spec §2).
--   * A row is visible only to members of its company.
--   * admin / recruiter write; hiring_manager reads everything in its company and may add notes.
--   * webhook_events: service role only.
--   * No anon access anywhere (grants revoked as well as RLS).
-- Helper functions live in a non-exposed schema, are SECURITY DEFINER (so policies on
-- members don't recurse) and pin search_path to ''.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

create or replace function private.is_member(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.members m
    where m.company_id = p_company_id
      and m.user_id = (select auth.uid())
  );
$$;

create or replace function private.has_role(p_company_id uuid, p_roles public.member_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.members m
    where m.company_id = p_company_id
      and m.user_id = (select auth.uid())
      and m.role = any (p_roles)
  );
$$;

create or replace function private.can_write(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_role(p_company_id, array['admin','recruiter']::public.member_role[]);
$$;

revoke all on function private.is_member(uuid) from public, anon;
revoke all on function private.has_role(uuid, public.member_role[]) from public, anon;
revoke all on function private.can_write(uuid) from public, anon;
grant execute on function private.is_member(uuid) to authenticated, service_role;
grant execute on function private.has_role(uuid, public.member_role[]) to authenticated, service_role;
grant execute on function private.can_write(uuid) to authenticated, service_role;

-- ---------- enable RLS everywhere ----------
alter table public.companies      enable row level security;
alter table public.members        enable row level security;
alter table public.jobs           enable row level security;
alter table public.rubrics        enable row level security;
alter table public.batches        enable row level security;
alter table public.candidates     enable row level security;
alter table public.calls          enable row level security;
alter table public.scores         enable row level security;
alter table public.actions        enable row level security;
alter table public.webhook_events enable row level security;

-- ---------- grants: no anon, webhook_events service-only ----------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;

revoke all on public.webhook_events from authenticated;
revoke all on sequence public.webhook_events_id_seq from authenticated;

-- actions is an append-only audit log for clients
revoke update, delete on public.actions from authenticated;
-- tables only the service role (or admins via policies below) should mutate
revoke delete on public.companies from authenticated;
revoke insert on public.companies from authenticated;

-- ---------- companies ----------
create policy companies_select on public.companies
  for select to authenticated using ((select private.is_member(id)));
create policy companies_update on public.companies
  for update to authenticated
  using ((select private.can_write(id)))
  with check ((select private.can_write(id)));

-- ---------- members ----------
create policy members_select on public.members
  for select to authenticated using ((select private.is_member(company_id)));
create policy members_insert on public.members
  for insert to authenticated
  with check ((select private.has_role(company_id, array['admin']::public.member_role[])));
create policy members_update on public.members
  for update to authenticated
  using ((select private.has_role(company_id, array['admin']::public.member_role[])))
  with check ((select private.has_role(company_id, array['admin']::public.member_role[])));
create policy members_delete on public.members
  for delete to authenticated
  using ((select private.has_role(company_id, array['admin']::public.member_role[])));

-- ---------- company-scoped tables: member read, admin/recruiter write ----------
do $$
declare t text;
begin
  foreach t in array array['jobs','rubrics','batches','candidates','calls','scores'] loop
    execute format('create policy %1$s_select on public.%1$I for select to authenticated using ((select private.is_member(company_id)))', t);
    execute format('create policy %1$s_insert on public.%1$I for insert to authenticated with check ((select private.can_write(company_id)))', t);
    execute format('create policy %1$s_update on public.%1$I for update to authenticated using ((select private.can_write(company_id))) with check ((select private.can_write(company_id)))', t);
    execute format('create policy %1$s_delete on public.%1$I for delete to authenticated using ((select private.can_write(company_id)))', t);
  end loop;
end $$;

-- ---------- actions: member read; insert own rows; hiring_manager only notes ----------
create policy actions_select on public.actions
  for select to authenticated using ((select private.is_member(company_id)));
create policy actions_insert on public.actions
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (
      (select private.can_write(company_id))
      or (type = 'note' and (select private.is_member(company_id)))
    )
  );

-- webhook_events: RLS on, no policies => only service_role (bypasses RLS).

-- ---------- realtime for live status board / ranking ----------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.calls, public.scores, public.candidates, public.batches;
  end if;
end $$;
