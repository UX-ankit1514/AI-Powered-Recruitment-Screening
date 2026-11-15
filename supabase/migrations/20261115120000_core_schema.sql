-- Pingo core schema (build-spec §2 + build-spec-delta).
-- Additive changes vs build-spec §2 (documented here, see M1 report):
--   * rubrics gains company_id (RLS without joins).
--   * company_id columns are tied to their parent rows with composite foreign keys,
--     so a row can never claim one company while pointing at another company's job/candidate/call.
--   * created_by / user_id columns default to auth.uid().

create extension if not exists pgcrypto with schema extensions;

-- ---------- enums ----------
create type public.member_role  as enum ('admin','recruiter','hiring_manager');
create type public.call_state   as enum ('queued','dialing','in_call','finished');
create type public.call_outcome as enum ('completed','short_exit','no_answer','busy','voicemail',
  'wrong_person','declined','rescheduled','dropped','failed');
create type public.pick         as enum ('amazing','good','maybe','no');
create type public.action_type  as enum ('shortlist','reject','override','note','recall','move_to_job');

-- ---------- companies / members ----------
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  culture_values jsonb not null default '[]',   -- [{name, description}] 3-5
  faq jsonb not null default '[]',              -- [{question, answer}]
  created_at timestamptz not null default now()
);

create table public.members (
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  role public.member_role not null,
  created_at timestamptz not null default now(),
  primary key (user_id, company_id)
);
create index members_company_id_idx on public.members(company_id);

-- ---------- jobs ----------
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  title text not null,
  jd_text text not null default '',
  status text not null default 'open' check (status in ('open','closed')),
  calling_hours jsonb not null default '{"start":"10:00","end":"19:00","days":[1,2,3,4,5,6]}',
  concurrency_limit int not null default 2 check (concurrency_limit between 1 and 50),
  screening_started_at timestamptz,
  -- delta
  ats_mode text not null default 'call_everyone' check (ats_mode in ('call_everyone','ats_filter')),
  ats_top_pct int not null default 60 check (ats_top_pct between 10 and 100),
  ats_rescue boolean not null default true,
  languages text[] not null default '{en,hinglish}',
  culture_values jsonb not null default '[]',   -- [{name, description}]
  faq jsonb not null default '[]',              -- [{question, answer}]
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (id, company_id)
);
create index jobs_company_id_idx on public.jobs(company_id);
create index jobs_created_by_idx on public.jobs(created_by);

-- ---------- rubrics ----------
create table public.rubrics (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null,
  company_id uuid not null references public.companies(id) on delete cascade,
  version int not null,
  must_haves jsonb not null default '[]',       -- [{text}]
  nice_to_haves jsonb not null default '[]',
  weights jsonb not null,                       -- {"skills":30,"experience":30,"culture_fit":25,"confidence":15,...}
  custom_traits jsonb not null default '[]',    -- [{key,name,description}]
  is_current boolean not null default true,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (job_id, version),
  foreign key (job_id, company_id) references public.jobs(id, company_id) on delete cascade
);
create index rubrics_company_id_idx on public.rubrics(company_id);
create index rubrics_job_company_idx on public.rubrics(job_id, company_id);
create index rubrics_created_by_idx on public.rubrics(created_by);
create unique index rubrics_one_current_per_job on public.rubrics(job_id) where is_current;

-- ---------- batches (delta) ----------
create table public.batches (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null,
  company_id uuid not null references public.companies(id) on delete cascade,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  status text not null default 'queued' check (status in ('queued','running','stopped','done')),
  total int not null default 0 check (total >= 0),
  done int not null default 0 check (done >= 0),
  unique (id, company_id),
  foreign key (job_id, company_id) references public.jobs(id, company_id) on delete cascade
);
create index batches_company_id_idx on public.batches(company_id);
create index batches_job_company_idx on public.batches(job_id, company_id);
create index batches_created_by_idx on public.batches(created_by);

-- ---------- candidates ----------
create table public.candidates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  job_id uuid not null,
  name text not null,
  phone text not null check (phone ~ '^\+[1-9][0-9]{6,14}$'),   -- E.164
  email text,
  source text not null,                         -- csv|form|portal_mock|...
  resume_path text,
  profile jsonb,
  resume_only_score numeric,
  consent_at timestamptz,
  consent_source text check (consent_source in ('form','employer_upload')),
  status text not null default 'imported'
    check (status in ('imported','ats_filtered','queued','calling','scored','shortlisted','rejected')),
  created_at timestamptz not null default now(),
  unique (job_id, phone),
  unique (id, company_id),
  foreign key (job_id, company_id) references public.jobs(id, company_id) on delete cascade
);
create index candidates_company_id_idx on public.candidates(company_id);
create index candidates_job_company_idx on public.candidates(job_id, company_id);

-- ---------- calls ----------
create table public.calls (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null,
  job_id uuid not null,
  company_id uuid not null references public.companies(id) on delete cascade,
  batch_id uuid,
  attempt int not null default 1,
  due_at timestamptz not null default now(),
  state public.call_state not null default 'queued',
  outcome public.call_outcome,
  bolna_execution_id text unique,
  started_at timestamptz,
  duration_s int,
  recording_url text,
  transcript text,
  cost numeric,
  termination_reason text,
  reschedule_count int not null default 0,
  locked_at timestamptz,
  -- delta
  callback_at timestamptz,
  scheduled boolean not null default false,
  call_kind text not null default 'phone' check (call_kind in ('phone','web')),
  created_at timestamptz not null default now(),
  unique (id, company_id),
  foreign key (candidate_id, company_id) references public.candidates(id, company_id) on delete cascade,
  foreign key (job_id, company_id) references public.jobs(id, company_id) on delete cascade,
  foreign key (batch_id, company_id) references public.batches(id, company_id) on delete set null (batch_id)
);
create index calls_company_id_idx on public.calls(company_id);
create index calls_candidate_company_idx on public.calls(candidate_id, company_id);
create index calls_job_company_idx on public.calls(job_id, company_id);
create index calls_batch_company_idx on public.calls(batch_id, company_id);
create index calls_queue_idx on public.calls(state, due_at) where state = 'queued';

-- ---------- scores ----------
create table public.scores (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null,
  candidate_id uuid not null,
  company_id uuid not null references public.companies(id) on delete cascade,
  rubric_version int not null,
  qualities jsonb not null,          -- {"<key>": {"score":1-5|null, "quotes":[{"text","ts"}], "reason"}}
  must_have_results jsonb not null,  -- [{text, met: true|false|unknown, quote}]
  flags jsonb not null,              -- {other_role, culture_standout, wants_internship, resume_mismatch, hr_review}
  summary text not null,
  profile_updates jsonb,
  short_exit boolean not null default false,
  model_version text,
  prompt_version text,
  created_at timestamptz not null default now(),
  foreign key (call_id, company_id) references public.calls(id, company_id) on delete cascade,
  foreign key (candidate_id, company_id) references public.candidates(id, company_id) on delete cascade
);
create index scores_company_id_idx on public.scores(company_id);
create index scores_call_company_idx on public.scores(call_id, company_id);
create index scores_candidate_company_idx on public.scores(candidate_id, company_id, created_at desc);

-- ---------- actions (audit log) ----------
create table public.actions (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null,
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid default auth.uid() references auth.users(id) on delete set null,
  type public.action_type not null,
  old_value jsonb,
  new_value jsonb,
  note text,
  at timestamptz not null default now(),
  foreign key (candidate_id, company_id) references public.candidates(id, company_id) on delete cascade
);
create index actions_company_id_idx on public.actions(company_id);
create index actions_candidate_company_idx on public.actions(candidate_id, company_id);
create index actions_user_id_idx on public.actions(user_id);

-- ---------- webhook_events (service-only) ----------
create table public.webhook_events (
  id bigserial primary key,
  bolna_execution_id text,
  status text,
  payload jsonb,
  received_at timestamptz not null default now()
);
create index webhook_events_execution_idx on public.webhook_events(bolna_execution_id);
