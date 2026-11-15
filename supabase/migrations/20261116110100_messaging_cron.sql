-- pg_cron + pg_net call POST /api/messaging/sweep every minute (heads-up messages for queued calls).
--
-- Same pattern and the SAME Vault secrets as the dispatcher cron (20261115140100_dispatch_cron.sql):
--   'pingo_app_url'          base URL of the app
--   'pingo_dispatch_secret'  sent as x-dispatch-secret (the sweeper accepts the dispatcher's secret)
-- No secret value is in this file. Only this SECURITY DEFINER function reads them.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create or replace function private.kick_messaging_sweep()
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
    url := rtrim(v_url, '/') || '/api/messaging/sweep',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-dispatch-secret', v_secret),
    timeout_milliseconds := 30000
  );
end;
$$;
revoke all on function private.kick_messaging_sweep() from public, anon, authenticated;
grant execute on function private.kick_messaging_sweep() to postgres, service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'pingo-messaging-sweep') then
    perform cron.unschedule('pingo-messaging-sweep');
  end if;
  perform cron.schedule('pingo-messaging-sweep', '* * * * *', 'select private.kick_messaging_sweep();');
end $$;
