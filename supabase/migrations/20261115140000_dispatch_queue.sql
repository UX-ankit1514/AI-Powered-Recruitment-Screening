-- M6: call queue claiming, calling hours, webhook idempotency, batch progress.
-- All functions are SECURITY DEFINER with search_path pinned to '' and are callable by
-- service_role only (the dispatcher / webhook run server-side with the service key).

-- ---------- webhook idempotency: one stored row per (execution, status) ----------
create unique index if not exists webhook_events_exec_status_uidx
  on public.webhook_events(bolna_execution_id, status);

-- in-flight lookups per job
create index if not exists calls_inflight_idx
  on public.calls(job_id, state) where state in ('dialing','in_call');

-- ---------- calling hours (Asia/Kolkata) ----------
-- hours = {"start":"10:00","end":"19:00","days":[1..6]}; days use 0/7 = Sunday, 1 = Monday.
create or replace function private.in_calling_hours(p_hours jsonb, p_at timestamptz)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_local timestamp := p_at at time zone 'Asia/Kolkata';
  v_dow int := extract(dow from v_local)::int;
  v_start time;
  v_end time;
  v_days jsonb := coalesce(p_hours->'days', '[0,1,2,3,4,5,6]'::jsonb);
begin
  begin
    v_start := coalesce(p_hours->>'start', '10:00')::time;
    v_end := coalesce(p_hours->>'end', '19:00')::time;
  exception when others then
    return false;
  end;
  if not (v_days @> to_jsonb(v_dow) or (v_dow = 0 and v_days @> '7'::jsonb)) then
    return false;
  end if;
  return v_local::time >= v_start and v_local::time < v_end;
end;
$$;
revoke all on function private.in_calling_hours(jsonb, timestamptz) from public, anon, authenticated;
grant execute on function private.in_calling_hours(jsonb, timestamptz) to service_role;

-- ---------- claim due calls ----------
-- Picks queued calls whose due_at has passed, only for open jobs inside their calling hours,
-- never letting a job's phone calls in flight exceed jobs.concurrency_limit.
-- A per-job advisory lock serialises concurrent dispatchers so the in-flight count is exact;
-- `for update skip locked` keeps two dispatchers from claiming the same row.
-- Claimed rows move to state 'dialing' (locked_at = now()).
-- Also returns stale claims (dialing, no execution id, > 5 min) to the queue first.
create or replace function public.claim_due_calls(p_limit int default 10, p_job_id uuid default null)
returns table (call_id uuid, job_id uuid, company_id uuid, candidate_id uuid, attempt int)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  j record;
  v_inflight int;
  v_slots int;
  v_left int := greatest(coalesce(p_limit, 10), 0);
  v_got int;
begin
  update public.calls c
     set state = 'queued', locked_at = null
   where c.state = 'dialing'
     and c.bolna_execution_id is null
     and c.call_kind = 'phone'
     and c.locked_at < now() - interval '5 minutes'
     and (p_job_id is null or c.job_id = p_job_id);

  for j in
    select jb.id, jb.concurrency_limit
      from public.jobs jb
     where jb.status = 'open'
       and (p_job_id is null or jb.id = p_job_id)
       and private.in_calling_hours(jb.calling_hours, now())
       and exists (select 1 from public.calls q
                    where q.job_id = jb.id and q.state = 'queued' and q.due_at <= now())
     order by (select min(q.due_at) from public.calls q
                where q.job_id = jb.id and q.state = 'queued')
  loop
    exit when v_left <= 0;
    perform pg_advisory_xact_lock(hashtextextended('pingo_dispatch:' || j.id::text, 0));

    select count(*) into v_inflight
      from public.calls f
     where f.job_id = j.id and f.state in ('dialing','in_call') and f.call_kind = 'phone';

    v_slots := least(j.concurrency_limit - v_inflight, v_left);
    continue when v_slots <= 0;

    return query
    with picked as (
      select q.id
        from public.calls q
       where q.job_id = j.id and q.state = 'queued' and q.due_at <= now() and q.call_kind = 'phone'
       order by q.due_at, q.created_at
       for update skip locked
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
revoke all on function public.claim_due_calls(int, uuid) from public, anon, authenticated;
grant execute on function public.claim_due_calls(int, uuid) to service_role;

-- ---------- batch progress counter (atomic) ----------
create or replace function public.bump_batch_done(p_batch_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.batches b
     set done = least(b.done + 1, b.total),
         status = case when b.done + 1 >= b.total then 'done'
                       when b.status = 'queued' then 'running'
                       else b.status end
   where b.id = p_batch_id and b.status <> 'stopped';
$$;
revoke all on function public.bump_batch_done(uuid) from public, anon, authenticated;
grant execute on function public.bump_batch_done(uuid) to service_role;
