-- M9 hardening.
--   1. save_rubric_version(): atomic rubric save (insert version N+1 + retire the old one in ONE
--      transaction). SECURITY INVOKER, so the caller's RLS applies to every statement; it also
--      checks the role itself so a hiring manager gets a clear 42501 instead of a partial write.
--   2. Scoring retries: calls.score_status / score_attempts / score_next_at / score_error and
--      claim_score_retries() (service role only) so a scoring failure after a completed call is
--      retried with backoff (max 3 attempts) by the every-minute dispatcher.
--   3. Least privilege for client roles: no TRUNCATE/TRIGGER/REFERENCES, no writes through the
--      candidate_ranking view, and AI scores are written by the server (service role) only.
--   4. Drop an index made redundant by webhook_events_exec_status_uidx (performance advisor).

-- ---------- 1. atomic rubric save ----------
create or replace function public.save_rubric_version(
  p_job_id uuid,
  p_must_haves jsonb,
  p_nice_to_haves jsonb,
  p_weights jsonb,
  p_custom_traits jsonb
)
returns setof public.rubrics
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_company uuid;
  v_next int;
begin
  -- RLS: a job of another company is invisible -> "not found".
  select j.company_id into v_company from public.jobs j where j.id = p_job_id;
  if v_company is null then
    raise exception 'job not found' using errcode = 'P0002';
  end if;
  if not private.can_write(v_company) then
    raise exception 'only admins and recruiters can change the rubric' using errcode = '42501';
  end if;

  -- Serialise concurrent saves for this job (no table privilege needed for an advisory lock).
  perform pg_advisory_xact_lock(hashtextextended('pingo_rubric:' || p_job_id::text, 0));

  select coalesce(max(r.version), 0) + 1 into v_next from public.rubrics r where r.job_id = p_job_id;

  update public.rubrics r set is_current = false where r.job_id = p_job_id and r.is_current;

  return query
  insert into public.rubrics (job_id, company_id, version, must_haves, nice_to_haves, weights, custom_traits, is_current)
  values (
    p_job_id, v_company, v_next,
    coalesce(p_must_haves, '[]'::jsonb), coalesce(p_nice_to_haves, '[]'::jsonb),
    p_weights, coalesce(p_custom_traits, '[]'::jsonb), true
  )
  returning *;
end;
$$;
revoke all on function public.save_rubric_version(uuid, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.save_rubric_version(uuid, jsonb, jsonb, jsonb, jsonb) to authenticated, service_role;

-- ---------- 2. scoring retries ----------
alter table public.calls
  add column if not exists score_status text
    check (score_status in ('pending','scoring','done','failed','gave_up')),
  add column if not exists score_attempts int not null default 0,
  add column if not exists score_next_at timestamptz,
  add column if not exists score_error text;

create index if not exists calls_score_retry_idx
  on public.calls(score_next_at) where score_status in ('pending','failed','scoring');

-- Claims calls whose scoring should run now: pending/failed and due, or stuck in 'scoring'
-- for 10+ minutes (the worker died mid-way). Each claim counts as one attempt.
create or replace function public.claim_score_retries(p_limit int default 3, p_max_attempts int default 3, p_job_id uuid default null)
returns table (call_id uuid, attempt int)
language sql
security definer
set search_path = ''
as $$
  with picked as (
    select c.id
      from public.calls c
     where c.state = 'finished'
       and (p_job_id is null or c.job_id = p_job_id)
       and c.score_attempts < p_max_attempts
       and (
         (c.score_status in ('pending','failed') and coalesce(c.score_next_at, now()) <= now())
         or (c.score_status = 'scoring' and c.score_next_at < now() - interval '10 minutes')
       )
     order by c.score_next_at nulls first
     for update skip locked
     limit greatest(coalesce(p_limit, 3), 0)
  )
  update public.calls c
     set score_status = 'scoring',
         score_attempts = c.score_attempts + 1,
         score_next_at = now()
    from picked
   where c.id = picked.id
  returning c.id, c.score_attempts;
$$;
revoke all on function public.claim_score_retries(int, int, uuid) from public, anon, authenticated;
grant execute on function public.claim_score_retries(int, int, uuid) to service_role;

-- ---------- 3. least privilege for client roles ----------
revoke truncate, trigger, references on all tables in schema public from authenticated;
alter default privileges in schema public revoke truncate, trigger, references on tables from authenticated;

revoke insert, update, delete, truncate, trigger, references on public.candidate_ranking from authenticated;

-- Scores are produced by the AI pipeline (service role). Humans change outcomes through
-- actions (override/shortlist/reject), which are audited; they never edit the AI's record.
revoke insert, update, delete on public.scores from authenticated;
drop policy if exists scores_insert on public.scores;
drop policy if exists scores_update on public.scores;
drop policy if exists scores_delete on public.scores;

-- ---------- 4. redundant index ----------
drop index if exists public.webhook_events_execution_idx;
