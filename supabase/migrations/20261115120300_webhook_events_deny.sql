-- webhook_events is service-role only. Make that explicit (and satisfy the
-- "RLS enabled, no policy" advisor) with a deny-all policy for client roles.
create policy webhook_events_no_client_access on public.webhook_events
  as restrictive
  for all to anon, authenticated
  using (false)
  with check (false);
