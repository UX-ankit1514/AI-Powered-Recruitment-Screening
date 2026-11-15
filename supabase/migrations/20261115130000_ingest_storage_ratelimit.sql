-- M2 ingestion: private 'resumes' bucket with company-scoped storage RLS, and a
-- service-only rate-limit table for the public apply form.
--
-- Object path convention: <company_id>/<job_id>/<candidate_id>/<file name>
-- The first folder decides which company may see the object.

-- ---------- bucket ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'resumes', 'resumes', false, 10485760,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'text/plain'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- First path segment as a company uuid, or null when it isn't one (never raises).
create or replace function private.resume_company(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when split_part(p_name, '/', 1) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then split_part(p_name, '/', 1)::uuid
  end;
$$;
revoke all on function private.resume_company(text) from public, anon;
grant execute on function private.resume_company(text) to authenticated, service_role;

-- ---------- storage RLS: members read, admin/recruiter write, no anon ----------
drop policy if exists resumes_select on storage.objects;
drop policy if exists resumes_insert on storage.objects;
drop policy if exists resumes_update on storage.objects;
drop policy if exists resumes_delete on storage.objects;

create policy resumes_select on storage.objects
  for select to authenticated
  using (bucket_id = 'resumes' and (select private.is_member(private.resume_company(name))));

create policy resumes_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'resumes' and (select private.can_write(private.resume_company(name))));

create policy resumes_update on storage.objects
  for update to authenticated
  using (bucket_id = 'resumes' and (select private.can_write(private.resume_company(name))))
  with check (bucket_id = 'resumes' and (select private.can_write(private.resume_company(name))));

create policy resumes_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'resumes' and (select private.can_write(private.resume_company(name))));

-- ---------- public apply rate limit (service role only) ----------
-- Stores a salted hash of the caller IP, never the IP itself.
create table if not exists public.apply_rate_limits (
  id bigserial primary key,
  ip_hash text not null,
  at timestamptz not null default now()
);
create index if not exists apply_rate_limits_ip_at_idx on public.apply_rate_limits(ip_hash, at desc);

alter table public.apply_rate_limits enable row level security;
revoke all on public.apply_rate_limits from anon, authenticated;
revoke all on sequence public.apply_rate_limits_id_seq from anon, authenticated;
drop policy if exists apply_rate_limits_no_client_access on public.apply_rate_limits;
create policy apply_rate_limits_no_client_access on public.apply_rate_limits
  as restrictive
  for all to anon, authenticated
  using (false)
  with check (false);
