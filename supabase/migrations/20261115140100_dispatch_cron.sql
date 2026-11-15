-- M6: pg_cron + pg_net call POST /api/dispatch every minute.
--
-- The dispatch secret is NOT in this file. It lives in Supabase Vault under the name
-- 'pingo_dispatch_secret' and is inserted once, at apply time, by running (never commit the value):
--   select vault.create_secret('<DISPATCH_SECRET>', 'pingo_dispatch_secret', 'x-dispatch-secret for /api/dispatch');
-- To rotate: select vault.update_secret(id, '<new>') from vault.secrets where name = 'pingo_dispatch_secret';
-- The app URL is not secret; it is stored in Vault too ('pingo_app_url') so it can be changed without a migration.
-- Only the SECURITY DEFINER function below reads the secrets; no client role can execute it.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'pingo_app_url') then
    perform vault.create_secret('https://pingo-app-nine.vercel.app', 'pingo_app_url', 'Base URL the dispatcher cron calls');
  end if;
end $$;

create or replace function private.kick_dispatch()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'pingo_app_url' limit 1;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'pingo_dispatch_secret' limit 1;
  if v_url is null or v_secret is null then
    return null; -- not configured yet: do nothing
  end if;
  return net.http_post(
    url := rtrim(v_url, '/') || '/api/dispatch',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-dispatch-secret', v_secret),
    timeout_milliseconds := 55000
  );
end;
$$;
revoke all on function private.kick_dispatch() from public, anon, authenticated;
grant execute on function private.kick_dispatch() to postgres, service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'pingo-dispatch') then
    perform cron.unschedule('pingo-dispatch');
  end if;
  perform cron.schedule('pingo-dispatch', '* * * * *', 'select private.kick_dispatch();');
end $$;
