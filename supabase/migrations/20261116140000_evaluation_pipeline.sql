-- Evaluation pipeline v2 (role profiles, multi-pass scoring, webhook reprocessing).
--   1. role_profiles: per-job, versioned "what good looks like" (requirements with job-specific
--      1-5 anchors, checkable must-haves, per-quality anchors, requirement -> quality mapping).
--      RLS by company: members read, admin/recruiter write. Saved atomically through
--      save_role_profile_version() (SECURITY INVOKER, so the caller's RLS applies).
--   2. scores: new jsonb columns for the multi-pass evaluation (requirement_scores, coverage,
--      agreement, jd_fit), confidence 0-1, needs_review, call_class, role_profile_version.
--      Existing columns stay populated for compatibility. Still server-written only.
--   3. webhook_events: processed_at / process_attempts / last_error + a claim function so the
--      dispatcher's stale sweep reprocesses events whose processing failed (execution review #8).

-- ---------- 1. role_profiles ----------
create table if not exists public.role_profiles (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null,
  company_id uuid not null references public.companies(id) on delete cascade,
  version int not null check (version >= 1),
  requirements jsonb not null default '[]'
    check (jsonb_typeof(requirements) = 'array' and jsonb_array_length(requirements) <= 30),
  must_have_checks jsonb not null default '[]'
    check (jsonb_typeof(must_have_checks) = 'array' and jsonb_array_length(must_have_checks) <= 20),
  quality_anchors jsonb not null default '{}' check (jsonb_typeof(quality_anchors) = 'object'),
  source text not null default 'edited' check (source in ('generated', 'edited', 'fallback')),
  model_version text,
  prompt_version text,
  is_current boolean not null default true,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (job_id, version),
  foreign key (job_id, company_id) references public.jobs(id, company_id) on delete cascade
);
create index if not exists role_profiles_company_id_idx on public.role_profiles(company_id);
create index if not exists role_profiles_job_company_idx on public.role_profiles(job_id, company_id);
create index if not exists role_profiles_created_by_idx on public.role_profiles(created_by);
create unique index if not exists role_profiles_one_current_per_job on public.role_profiles(job_id) where is_current;

alter table public.role_profiles enable row level security;
revoke all on public.role_profiles from anon;
revoke truncate, trigger, references on public.role_profiles from authenticated;
-- versions are append-only for clients: a change is a new version
revoke delete on public.role_profiles from authenticated;

create policy role_profiles_select on public.role_profiles
  for select to authenticated using ((select private.is_member(company_id)));
create policy role_profiles_insert on public.role_profiles
  for insert to authenticated with check ((select private.can_write(company_id)));
create policy role_profiles_update on public.role_profiles
  for update to authenticated
  using ((select private.can_write(company_id)))
  with check ((select private.can_write(company_id)));

create or replace function public.save_role_profile_version(
  p_job_id uuid,
  p_requirements jsonb,
  p_must_have_checks jsonb,
  p_quality_anchors jsonb,
  p_source text default 'edited',
  p_model_version text default null,
  p_prompt_version text default null
)
returns setof public.role_profiles
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_company uuid;
  v_next int;
begin
  select j.company_id into v_company from public.jobs j where j.id = p_job_id;
  if v_company is null then
    raise exception 'job not found' using errcode = 'P0002';
  end if;
  if not private.can_write(v_company) then
    raise exception 'only admins and recruiters can change the role profile' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('pingo_role_profile:' || p_job_id::text, 0));

  select coalesce(max(r.version), 0) + 1 into v_next from public.role_profiles r where r.job_id = p_job_id;
  update public.role_profiles r set is_current = false where r.job_id = p_job_id and r.is_current;

  return query
  insert into public.role_profiles (job_id, company_id, version, requirements, must_have_checks, quality_anchors,
                                    source, model_version, prompt_version, is_current)
  values (
    p_job_id, v_company, v_next,
    coalesce(p_requirements, '[]'::jsonb), coalesce(p_must_have_checks, '[]'::jsonb), coalesce(p_quality_anchors, '{}'::jsonb),
    coalesce(p_source, 'edited'), p_model_version, p_prompt_version, true
  )
  returning *;
end;
$$;
revoke all on function public.save_role_profile_version(uuid, jsonb, jsonb, jsonb, text, text, text) from public, anon;
grant execute on function public.save_role_profile_version(uuid, jsonb, jsonb, jsonb, text, text, text) to authenticated, service_role;

-- ---------- 2. scores: multi-pass evaluation ----------
alter table public.scores
  add column if not exists requirement_scores jsonb,
  add column if not exists coverage jsonb,
  add column if not exists agreement jsonb,
  add column if not exists jd_fit jsonb,
  add column if not exists confidence numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  add column if not exists needs_review boolean not null default false,
  add column if not exists call_class text
    check (call_class is null or call_class in ('conversation', 'voicemail', 'wrong_person', 'no_speech', 'dropped')),
  add column if not exists role_profile_version int;

comment on column public.scores.requirement_scores is
  '{"<requirement id>": {"score": 1-5|null, "pass_scores": [a,b], "justification", "quotes": [{text,ts}], "status": met|partial|not_met|not_covered}}';
comment on column public.scores.coverage is
  '{"<requirement id | quality key>": "asked_answered" | "asked_weak" | "not_asked"}';
comment on column public.scores.agreement is
  '{"max_diff": n, "disagreements": [{id, a, b, note}], "agreement_rate": 0-1}';
comment on column public.scores.jd_fit is
  '{fit_pct, requirements: [{id,text,importance,status,quote}], strengths[], gaps[], hidden_fits[{job_id,title,reason}], rationale, not_covered[]}';

-- ---------- 3. webhook_events reprocessing ----------
alter table public.webhook_events
  add column if not exists processed_at timestamptz,
  add column if not exists process_attempts int not null default 0,
  add column if not exists last_error text;

-- Everything received before this migration was handled by the old code path.
update public.webhook_events set processed_at = received_at where processed_at is null;

create index if not exists webhook_events_unprocessed_idx
  on public.webhook_events(received_at) where processed_at is null;

-- Claims unprocessed events older than p_min_age (the first attempt runs right after receipt),
-- skip-locked so parallel sweeps never double-process. Each claim counts as an attempt.
create or replace function public.claim_unprocessed_webhook_events(
  p_limit int default 5,
  p_max_attempts int default 5,
  p_min_age interval default interval '3 minutes'
)
returns table (event_id bigint, payload jsonb)
language sql
security definer
set search_path = ''
as $$
  with picked as (
    select w.id
      from public.webhook_events w
     where w.processed_at is null
       and w.process_attempts < p_max_attempts
       and w.received_at < now() - p_min_age
       and w.bolna_execution_id is not null
     order by w.received_at
     for update skip locked
     limit greatest(coalesce(p_limit, 5), 0)
  )
  update public.webhook_events w
     set process_attempts = w.process_attempts + 1
    from picked
   where w.id = picked.id
  returning w.id, w.payload;
$$;
revoke all on function public.claim_unprocessed_webhook_events(int, int, interval) from public, anon, authenticated;
grant execute on function public.claim_unprocessed_webhook_events(int, int, interval) to service_role;
