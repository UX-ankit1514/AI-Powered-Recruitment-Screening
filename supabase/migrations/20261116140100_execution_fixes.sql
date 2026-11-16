-- Execution-review fixes (docs/execution-review.md #2, #4, #11, #14, #17 + heads-up timing).
--
--   1. companies.concurrency_limit: call lines for the WHOLE company (Bolna's limit is per account).
--      NULL = use the server default (env DEFAULT_CONCURRENCY, else 2), passed in by the dispatcher.
--      Only a company ADMIN may change it (trigger; recruiters can otherwise update their company row).
--   2. calls.heads_up: false for "call now" single phone calls, which skip the heads-up message.
--   3. scheduler_ticks: the dispatcher records each every-minute run, so Settings can say
--      "Scheduler not running". Service role only.
--   4. scheduler_health(): booleans + last tick for signed-in members. Never returns a secret.
--   5. claim_due_calls(): in-flight cap counted per COMPANY across all jobs (company advisory lock),
--      never claims calls of a stopped batch (booked callbacks excepted), callbacks of a closed job
--      still go out, rejected candidates are never dialled.

-- ---------- 1. company lines ----------
alter table public.companies add column if not exists concurrency_limit int;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'companies_concurrency_limit_check') then
    alter table public.companies add constraint companies_concurrency_limit_check
      check (concurrency_limit is null or concurrency_limit between 1 and 50);
  end if;
end $$;

create or replace function private.guard_company_lines()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.concurrency_limit is distinct from old.concurrency_limit
     and (select auth.uid()) is not null
     and not private.has_role(old.id, array['admin']::public.member_role[]) then
    raise exception 'only admins can change call lines' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_company_lines() from public, anon, authenticated;

drop trigger if exists companies_guard_lines on public.companies;
create trigger companies_guard_lines
  before update on public.companies
  for each row execute function private.guard_company_lines();

-- ---------- 2. heads-up opt-out per call ----------
alter table public.calls add column if not exists heads_up boolean not null default true;

-- in-flight lookups per company
create index if not exists calls_company_inflight_idx
  on public.calls(company_id) where state in ('dialing','in_call') and call_kind = 'phone';

-- ---------- 3. scheduler ticks ----------
create table if not exists public.scheduler_ticks (
  name text primary key check (char_length(name) <= 40),
  at timestamptz not null default now()
);
alter table public.scheduler_ticks enable row level security;
revoke all on public.scheduler_ticks from anon, authenticated;
drop policy if exists scheduler_ticks_no_client_access on public.scheduler_ticks;
create policy scheduler_ticks_no_client_access on public.scheduler_ticks
  as restrictive for all to anon, authenticated using (false) with check (false);

-- ---------- 4. scheduler health ----------
create or replace function public.scheduler_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null
     and not exists (select 1 from public.members m where m.user_id = (select auth.uid())) then
    return null;
  end if;
  return jsonb_build_object(
    'cron_scheduled', exists (select 1 from cron.job where jobname = 'pingo-dispatch' and active),
    'secret_present', exists (select 1 from vault.secrets where name = 'pingo_dispatch_secret'),
    'url_present', exists (select 1 from vault.secrets where name = 'pingo_app_url'),
    'last_tick', (select t.at from public.scheduler_ticks t where t.name = 'dispatch')
  );
end;
$$;
revoke all on function public.scheduler_health() from public, anon;
grant execute on function public.scheduler_health() to authenticated, service_role;

-- ---------- 5. claim due calls: company-wide cap ----------
drop function if exists public.claim_due_calls(int, uuid);

create or replace function public.claim_due_calls(p_limit int default 10, p_job_id uuid default null, p_default_lines int default 2)
returns table (call_id uuid, job_id uuid, company_id uuid, candidate_id uuid, attempt int)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  co record;
  v_inflight int;
  v_slots int;
  v_left int := greatest(coalesce(p_limit, 10), 0);
  v_default int := least(greatest(coalesce(p_default_lines, 2), 1), 50);
  v_got int;
begin
  update public.calls c
     set state = 'queued', locked_at = null
   where c.state = 'dialing'
     and c.bolna_execution_id is null
     and c.call_kind = 'phone'
     and c.locked_at < now() - interval '5 minutes'
     and (p_job_id is null or c.job_id = p_job_id);

  for co in
    select q.company_id as id, min(q.due_at) as first_due
      from public.calls q
      join public.jobs jb on jb.id = q.job_id and jb.company_id = q.company_id
      left join public.batches b on b.id = q.batch_id
      join public.candidates cd on cd.id = q.candidate_id
     where q.state = 'queued' and q.call_kind = 'phone' and q.due_at <= now()
       and (p_job_id is null or q.job_id = p_job_id)
       and (jb.status = 'open' or q.scheduled)
       and (q.batch_id is null or q.scheduled or b.status is distinct from 'stopped')
       and cd.status <> 'rejected'
       and private.in_calling_hours(jb.calling_hours, now())
     group by q.company_id
     order by min(q.due_at)
  loop
    exit when v_left <= 0;
    perform pg_advisory_xact_lock(hashtextextended('pingo_dispatch_company:' || co.id::text, 0));

    select count(*) into v_inflight
      from public.calls f
     where f.company_id = co.id and f.state in ('dialing','in_call') and f.call_kind = 'phone';

    select least(coalesce(cp.concurrency_limit, v_default) - v_inflight, v_left) into v_slots
      from public.companies cp where cp.id = co.id;
    continue when coalesce(v_slots, 0) <= 0;

    return query
    with picked as (
      select q.id
        from public.calls q
        join public.jobs jb on jb.id = q.job_id and jb.company_id = q.company_id
        left join public.batches b on b.id = q.batch_id
        join public.candidates cd on cd.id = q.candidate_id
       where q.company_id = co.id and q.state = 'queued' and q.call_kind = 'phone' and q.due_at <= now()
         and (p_job_id is null or q.job_id = p_job_id)
         and (jb.status = 'open' or q.scheduled)
         and (q.batch_id is null or q.scheduled or b.status is distinct from 'stopped')
         and cd.status <> 'rejected'
         and private.in_calling_hours(jb.calling_hours, now())
       order by q.due_at, q.created_at
       for update of q skip locked
       limit v_slots
    )
    update public.calls c
       set state = 'dialing', locked_at = now()
      from picked
     where c.id = picked.id
    returning c.id, c.job_id, c.company_id, c.candidate_id, c.attempt;

    get diagnostics v_got = row_count;
    v_left := v_left - v_got;
  end loop;
end;
$$;
revoke all on function public.claim_due_calls(int, uuid, int) from public, anon, authenticated;
grant execute on function public.claim_due_calls(int, uuid, int) to service_role;
