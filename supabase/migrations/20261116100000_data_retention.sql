-- Data retention (PRD §11): recordings 90 days, transcripts + scores 12 months, delete on request,
-- configurable per company.
--
--   1. companies.retention_recording_days (7-365, default 90) and retention_transcript_days
--      (30-730, default 365). Only a company ADMIN may change them (trigger below; recruiters can
--      otherwise update their company row through companies_update).
--   2. retention_runs: anonymised audit log, one row per company per purge run and one per erasure.
--      Counts only, never names/phones/ids of candidates. Company admins read their own rows.
--   3. private.retention_file_queue: storage files whose DB reference was removed. Files are deleted
--      through the Storage API (direct DELETE on storage.objects would orphan the stored bytes), sent
--      with pg_net by purge_expired_data() using two Vault secrets inserted at apply time
--      (never commit the values):
--        select vault.create_secret('<SUPABASE_URL>', 'pingo_supabase_url', 'Storage API base for retention');
--        select vault.create_secret('<SERVICE_ROLE_KEY>', 'pingo_service_role_key', 'Storage deletes for retention');
--      Without them, files stay queued (and are reported as queued) until the secrets exist.
--   4. purge_expired_data(): SECURITY DEFINER, service role / postgres only. Same rules for every
--      company, demo-seeded or not.
--   5. erase_candidate(): delete-on-request, admin only (checked inside), atomic.
--   6. pg_cron: daily 02:30 IST = 21:00 UTC.

-- ---------- 1. per-company settings ----------
alter table public.companies
  add column if not exists retention_recording_days int not null default 90,
  add column if not exists retention_transcript_days int not null default 365;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'companies_retention_recording_days_check') then
    alter table public.companies add constraint companies_retention_recording_days_check
      check (retention_recording_days between 7 and 365);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'companies_retention_transcript_days_check') then
    alter table public.companies add constraint companies_retention_transcript_days_check
      check (retention_transcript_days between 30 and 730);
  end if;
end $$;

-- Only admins change retention. Service role / postgres (no auth.uid()) are not restricted.
create or replace function private.guard_retention_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.retention_recording_days is distinct from old.retention_recording_days
      or new.retention_transcript_days is distinct from old.retention_transcript_days)
     and (select auth.uid()) is not null
     and not private.has_role(old.id, array['admin']::public.member_role[]) then
    raise exception 'only admins can change data retention' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_retention_settings() from public, anon, authenticated;

drop trigger if exists companies_guard_retention on public.companies;
create trigger companies_guard_retention
  before update on public.companies
  for each row execute function private.guard_retention_settings();

-- ---------- 2. audit ----------
create table if not exists public.retention_runs (
  id bigserial primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  kind text not null check (kind in ('purge','erase')),
  ran_at timestamptz not null default now(),
  recording_days int,
  transcript_days int,
  counts jsonb not null default '{}',
  actor_id uuid references auth.users(id) on delete set null   -- the admin who erased; null for the cron
);
create index if not exists retention_runs_company_ran_idx on public.retention_runs(company_id, ran_at desc);
create index if not exists retention_runs_actor_idx on public.retention_runs(actor_id);

alter table public.retention_runs enable row level security;
revoke all on public.retention_runs from anon, authenticated;
revoke all on sequence public.retention_runs_id_seq from anon, authenticated;
grant select on public.retention_runs to authenticated;
drop policy if exists retention_runs_admin_select on public.retention_runs;
create policy retention_runs_admin_select on public.retention_runs
  for select to authenticated
  using ((select private.has_role(company_id, array['admin']::public.member_role[])));

-- ---------- 3. storage deletion queue (service only) ----------
create table if not exists private.retention_file_queue (
  id bigserial primary key,
  bucket text not null,
  path text not null,
  queued_at timestamptz not null default now(),
  attempts int not null default 0,
  request_id bigint,
  sent_at timestamptz,
  done_at timestamptz,
  last_error text
);
create index if not exists retention_file_queue_pending_idx on private.retention_file_queue(id) where done_at is null;
revoke all on private.retention_file_queue from public, anon, authenticated;
revoke all on sequence private.retention_file_queue_id_seq from public, anon, authenticated;

-- "bucket/path" storage reference -> (bucket, path); null for https:// (Bolna-hosted) or junk.
create or replace function private.storage_ref(p_raw text, out bucket text, out path text)
language sql
immutable
set search_path = ''
as $$
  select case when ok then split_part(clean, '/', 1) end,
         case when ok then substr(clean, strpos(clean, '/') + 1) end
    from (
      select clean, (clean ~ '^[A-Za-z0-9_-]+/.+' and clean !~* '^[a-z]+:') as ok
        from (select ltrim(coalesce(p_raw, ''), '/') as clean) c
    ) s;
$$;
revoke all on function private.storage_ref(text) from public, anon, authenticated;

-- Sends queued deletes to the Storage API and settles earlier requests. Returns files confirmed deleted.
create or replace function private.flush_retention_files()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_key text;
  v_done int := 0;
  r record;
  v_req bigint;
begin
  -- settle requests sent on earlier runs
  with settled as (
    update private.retention_file_queue q
       set done_at = now(), last_error = null
      from net._http_response h
     where q.request_id = h.id and q.done_at is null and h.status_code between 200 and 299
    returning q.id
  )
  select count(*) into v_done from settled;

  update private.retention_file_queue q
     set request_id = null, last_error = left(coalesce(h.error_msg, 'HTTP ' || h.status_code::text), 300)
    from net._http_response h
   where q.request_id = h.id and q.done_at is null
     and (h.timed_out or h.status_code is null or h.status_code not between 200 and 299);

  -- responses expire from net._http_response after a few hours: resend anything unanswered for a day
  update private.retention_file_queue
     set request_id = null
   where done_at is null and request_id is not null and sent_at < now() - interval '1 day';

  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'pingo_supabase_url' limit 1;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'pingo_service_role_key' limit 1;
  if v_url is null or v_key is null then
    return v_done; -- not configured: files stay queued
  end if;

  for r in
    select bucket, array_agg(id) as ids, jsonb_agg(path) as paths
      from (
        select id, bucket, path, row_number() over (partition by bucket order by id) as rn
          from private.retention_file_queue
         where done_at is null and request_id is null and attempts < 10
      ) x
     group by bucket, (rn - 1) / 100
  loop
    v_req := net.http_delete(
      url := rtrim(v_url, '/') || '/storage/v1/object/' || r.bucket,
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key, 'apikey', v_key),
      body := jsonb_build_object('prefixes', r.paths),
      timeout_milliseconds := 30000
    );
    update private.retention_file_queue
       set request_id = v_req, sent_at = now(), attempts = attempts + 1
     where id = any (r.ids);
  end loop;
  return v_done;
end;
$$;
revoke all on function private.flush_retention_files() from public, anon, authenticated;
grant execute on function private.flush_retention_files() to postgres, service_role;

-- ---------- 4. purge ----------
create or replace function public.purge_expired_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  co record;
  v_rec_cut timestamptz;
  v_tr_cut timestamptz;
  v_recordings int;
  v_rec_files int;
  v_transcripts int;
  v_scores int;
  v_resumes int;
  v_events int;
  v_total jsonb := '{}';
  v_orphans int;
  v_files_done int;
begin
  for co in select id, retention_recording_days as rd, retention_transcript_days as td from public.companies order by id loop
    v_rec_cut := now() - make_interval(days => co.rd);
    v_tr_cut := now() - make_interval(days => co.td);

    -- recordings: drop the link, queue our own stored file (Bolna-hosted https links are just unlinked)
    with old as (
      select c.id, c.recording_url
        from public.calls c
       where c.company_id = co.id and c.recording_url is not null
         and coalesce(c.started_at, c.created_at) < v_rec_cut
       for update
    ), upd as (
      update public.calls c set recording_url = null from old where c.id = old.id returning old.recording_url
    ), q as (
      insert into private.retention_file_queue (bucket, path)
      select (private.storage_ref(u.recording_url)).bucket, (private.storage_ref(u.recording_url)).path
        from upd u
       where (private.storage_ref(u.recording_url)).bucket is not null
      returning 1
    )
    select (select count(*) from upd), (select count(*) from q) into v_recordings, v_rec_files;

    -- transcripts
    update public.calls c set transcript = null
     where c.company_id = co.id and c.transcript is not null
       and coalesce(c.started_at, c.created_at) < v_tr_cut;
    get diagnostics v_transcripts = row_count;

    -- scores (quotes live inside scores.qualities / must_have_results)
    delete from public.scores s where s.company_id = co.id and s.created_at < v_tr_cut;
    get diagnostics v_scores = row_count;

    -- resume files: follow the transcript window, counted from the candidate's last call (or import)
    with old as (
      select cd.id, cd.resume_path
        from public.candidates cd
       where cd.company_id = co.id and cd.resume_path is not null
         and greatest(cd.created_at, coalesce((select max(c.created_at) from public.calls c
                                                where c.candidate_id = cd.id and c.company_id = co.id), cd.created_at)) < v_tr_cut
       for update
    ), upd as (
      update public.candidates cd set resume_path = null from old where cd.id = old.id returning old.resume_path
    ), q as (
      insert into private.retention_file_queue (bucket, path)
      select 'resumes', ltrim(u.resume_path, '/') from upd u
      returning 1
    )
    select count(*) into v_resumes from q;

    -- raw webhook payloads carry the transcript and recording link: keep them no longer than the recording window
    delete from public.webhook_events w
     using public.calls c
     where c.company_id = co.id and c.bolna_execution_id = w.bolna_execution_id
       and w.received_at < v_rec_cut;
    get diagnostics v_events = row_count;

    insert into public.retention_runs (company_id, kind, recording_days, transcript_days, counts)
    values (co.id, 'purge', co.rd, co.td, jsonb_build_object(
      'recordings_cleared', v_recordings,
      'recording_files_queued', v_rec_files,
      'transcripts_cleared', v_transcripts,
      'scores_deleted', v_scores,
      'resume_files_queued', v_resumes,
      'webhook_events_deleted', v_events
    ));

    v_total := jsonb_build_object(
      'companies', coalesce((v_total->>'companies')::int, 0) + 1,
      'recordings_cleared', coalesce((v_total->>'recordings_cleared')::int, 0) + v_recordings,
      'transcripts_cleared', coalesce((v_total->>'transcripts_cleared')::int, 0) + v_transcripts,
      'scores_deleted', coalesce((v_total->>'scores_deleted')::int, 0) + v_scores,
      'files_queued', coalesce((v_total->>'files_queued')::int, 0) + v_rec_files + v_resumes,
      'webhook_events_deleted', coalesce((v_total->>'webhook_events_deleted')::int, 0) + v_events
    );
  end loop;

  -- webhook payloads that match no call (no company to read a setting from): shortest default window
  delete from public.webhook_events w
   where w.received_at < now() - interval '90 days'
     and not exists (select 1 from public.calls c where c.bolna_execution_id = w.bolna_execution_id);
  get diagnostics v_orphans = row_count;

  v_files_done := private.flush_retention_files();

  return v_total || jsonb_build_object('orphan_webhook_events_deleted', v_orphans, 'files_deleted_confirmed', v_files_done);
end;
$$;
revoke all on function public.purge_expired_data() from public, anon, authenticated;
grant execute on function public.purge_expired_data() to postgres, service_role;

-- ---------- 5. delete on request ----------
-- Hard-deletes one candidate and everything about them. Admin of the candidate's company only
-- (or the service role). Storage files are removed by the caller through the Storage API first.
-- A candidate the caller cannot see is reported as "not found" (no existence hint).
create or replace function public.erase_candidate(p_candidate_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
  v_calls int := 0;
  v_scores int := 0;
  v_actions int := 0;
  v_messages int := 0;
  v_events int := 0;
  v_counts jsonb;
begin
  select cd.company_id into v_company from public.candidates cd where cd.id = p_candidate_id for update;
  if v_company is null then
    raise exception 'candidate not found' using errcode = 'P0002';
  end if;
  if coalesce((select auth.role()), '') <> 'service_role' then
    if not private.is_member(v_company) then
      raise exception 'candidate not found' using errcode = 'P0002';
    end if;
    if not private.has_role(v_company, array['admin']::public.member_role[]) then
      raise exception 'only admins can erase candidate data' using errcode = '42501';
    end if;
  end if;

  delete from public.webhook_events w
   using public.calls c
   where c.candidate_id = p_candidate_id and c.company_id = v_company
     and c.bolna_execution_id is not null and w.bolna_execution_id = c.bolna_execution_id;
  get diagnostics v_events = row_count;

  -- messages table is optional (messaging may not be deployed yet)
  if to_regclass('public.messages') is not null and exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'messages' and column_name = 'candidate_id'
  ) then
    execute 'delete from public.messages where candidate_id = $1' using p_candidate_id;
    get diagnostics v_messages = row_count;
  end if;

  delete from public.scores where candidate_id = p_candidate_id and company_id = v_company;
  get diagnostics v_scores = row_count;
  delete from public.actions where candidate_id = p_candidate_id and company_id = v_company;
  get diagnostics v_actions = row_count;
  delete from public.calls where candidate_id = p_candidate_id and company_id = v_company;
  get diagnostics v_calls = row_count;
  delete from public.candidates where id = p_candidate_id and company_id = v_company;

  v_counts := jsonb_build_object(
    'candidates_deleted', 1,
    'calls_deleted', v_calls,
    'scores_deleted', v_scores,
    'actions_deleted', v_actions,
    'messages_deleted', v_messages,
    'webhook_events_deleted', v_events
  );
  insert into public.retention_runs (company_id, kind, counts, actor_id)
  values (v_company, 'erase', v_counts, (select auth.uid()));
  return v_counts;
end;
$$;
revoke all on function public.erase_candidate(uuid) from public, anon;
grant execute on function public.erase_candidate(uuid) to authenticated, service_role;

-- ---------- 6. schedule: daily 02:30 IST (21:00 UTC) ----------
do $$
begin
  if exists (select 1 from cron.job where jobname = 'pingo-retention-purge') then
    perform cron.unschedule('pingo-retention-purge');
  end if;
  perform cron.schedule('pingo-retention-purge', '0 21 * * *', 'select public.purge_expired_data();');
end $$;
