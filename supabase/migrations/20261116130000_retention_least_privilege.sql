-- M9 review of data retention (20261116100000): remove the service-role key from the database.
--
-- Before: purge_expired_data() (pg_cron, SECURITY DEFINER) also sent storage deletes over HTTP with
-- pg_net, authenticated by a copy of the SERVICE ROLE key kept in Vault ('pingo_service_role_key').
-- That put the master key (bypasses all RLS, full Storage/Auth admin) in a second place, and in
-- pg_net request rows while they are queued.
--
-- After:
--   * The purge stays a SECURITY DEFINER function run directly by pg_cron: it clears database
--     fields and QUEUES storage files. No HTTP, no key.
--   * Queued files are deleted by the app server (which already holds the service key in its env)
--     on the every-minute dispatcher run: claim_retention_files() hands out a batch,
--     settle_retention_files() records the result. Both are service-role only.
--   * The Vault secrets 'pingo_service_role_key' and 'pingo_supabase_url' are deleted.

-- ---------- flush no longer sends anything: settle legacy pg_net requests only ----------
create or replace function private.flush_retention_files()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_done int := 0;
begin
  -- requests sent by the old version (before this migration) are settled once, then never again
  with settled as (
    update private.retention_file_queue q
       set done_at = now(), last_error = null
      from net._http_response h
     where q.request_id = h.id and q.done_at is null and h.status_code between 200 and 299
    returning q.id
  )
  select count(*) into v_done from settled;
  update private.retention_file_queue
     set request_id = null
   where done_at is null and request_id is not null;
  return v_done;
end;
$$;
revoke all on function private.flush_retention_files() from public, anon, authenticated;
grant execute on function private.flush_retention_files() to postgres, service_role;

-- ---------- app-side deletion: claim + settle (service role only) ----------
-- A claim is a lease: rows claimed but not settled are handed out again after 10 minutes.
create or replace function public.claim_retention_files(p_limit int default 100)
returns table (id bigint, bucket text, path text)
language sql
security definer
set search_path = ''
as $$
  with picked as (
    select q.id
      from private.retention_file_queue q
     where q.done_at is null
       and q.attempts < 10
       and (q.sent_at is null or q.sent_at < now() - interval '10 minutes')
     order by q.id
     for update skip locked
     limit greatest(least(coalesce(p_limit, 100), 1000), 0)
  )
  update private.retention_file_queue q
     set attempts = q.attempts + 1, sent_at = now(), request_id = null
    from picked
   where q.id = picked.id
  returning q.id, q.bucket, q.path;
$$;
revoke all on function public.claim_retention_files(int) from public, anon, authenticated;
grant execute on function public.claim_retention_files(int) to service_role;

create or replace function public.settle_retention_files(p_ids bigint[], p_error text default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  if p_error is null then
    update private.retention_file_queue set done_at = now(), last_error = null
     where id = any (p_ids) and done_at is null;
  else
    update private.retention_file_queue set last_error = left(p_error, 300), sent_at = null
     where id = any (p_ids) and done_at is null;
  end if;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.settle_retention_files(bigint[], text) from public, anon, authenticated;
grant execute on function public.settle_retention_files(bigint[], text) to service_role;

-- ---------- remove the copied keys ----------
delete from vault.secrets where name in ('pingo_service_role_key', 'pingo_supabase_url');
