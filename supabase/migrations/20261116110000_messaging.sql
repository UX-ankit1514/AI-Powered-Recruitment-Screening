-- Candidate messaging (PRD §8 step 4 heads-up, §11 privacy).
--   1. messages: every outbound SMS/WhatsApp (or a "logged" row when no provider is configured).
--      Written by the server only (service role). Readable by the company's ADMINS only
--      (phone numbers are personal data; recruiters / hiring managers do not need the log).
--      OTP message bodies are stored redacted; the code itself is never stored in clear text.
--   2. phone_otps: apply-form phone verification codes (HMAC hash only, 10-min expiry,
--      5 attempts). Service role only.
--   3. messaging_rate_limits: generic per-bucket rate limit (salted key hashes, never raw IPs
--      or phone numbers). Service role only.
--   4. messaging_rate_hit() / verify_phone_otp(): atomic helpers, service role only.

-- ---------- 1. messages ----------
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  candidate_id uuid,
  call_id uuid,
  kind text not null default 'other' check (kind in ('heads_up','otp','other')),
  channel text not null check (channel in ('sms','whatsapp')),
  "to" text not null check ("to" ~ '^\+[1-9][0-9]{6,14}$'),
  body text not null check (char_length(body) <= 1600),
  status text not null default 'queued' check (status in ('queued','sent','failed','logged')),
  provider text not null,
  provider_ref text,
  error text,
  created_at timestamptz not null default now(),
  foreign key (candidate_id, company_id) references public.candidates(id, company_id) on delete cascade,
  foreign key (call_id, company_id) references public.calls(id, company_id) on delete set null (call_id)
);
create index if not exists messages_company_created_idx on public.messages(company_id, created_at desc);
create index if not exists messages_candidate_company_idx on public.messages(candidate_id, company_id);
create index if not exists messages_call_company_idx on public.messages(call_id, company_id);
-- One heads-up per call, enforced by the database (the sweeper claims by inserting).
create unique index if not exists messages_one_heads_up_per_call on public.messages(call_id) where kind = 'heads_up';

alter table public.messages enable row level security;
revoke all on public.messages from anon;
revoke insert, update, delete, truncate, trigger, references on public.messages from authenticated;
grant select on public.messages to authenticated;

drop policy if exists messages_select_admin on public.messages;
create policy messages_select_admin on public.messages
  for select to authenticated
  using ((select private.has_role(company_id, array['admin']::public.member_role[])));

-- ---------- 2. phone_otps ----------
create table if not exists public.phone_otps (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  phone_hash text not null,
  code_hash text not null,
  attempts int not null default 0 check (attempts >= 0),
  expires_at timestamptz not null,
  verified_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists phone_otps_lookup_idx on public.phone_otps(phone_hash, job_id, created_at desc);
create index if not exists phone_otps_job_idx on public.phone_otps(job_id);
create index if not exists phone_otps_expires_idx on public.phone_otps(expires_at);

alter table public.phone_otps enable row level security;
revoke all on public.phone_otps from anon, authenticated;
drop policy if exists phone_otps_no_client_access on public.phone_otps;
create policy phone_otps_no_client_access on public.phone_otps
  as restrictive for all to anon, authenticated using (false) with check (false);

-- ---------- 3. messaging_rate_limits ----------
create table if not exists public.messaging_rate_limits (
  id bigserial primary key,
  bucket text not null,
  key_hash text not null,
  at timestamptz not null default now()
);
create index if not exists messaging_rate_limits_lookup_idx on public.messaging_rate_limits(bucket, key_hash, at desc);
create index if not exists messaging_rate_limits_at_idx on public.messaging_rate_limits(at);

alter table public.messaging_rate_limits enable row level security;
revoke all on public.messaging_rate_limits from anon, authenticated;
revoke all on sequence public.messaging_rate_limits_id_seq from anon, authenticated;
drop policy if exists messaging_rate_limits_no_client_access on public.messaging_rate_limits;
create policy messaging_rate_limits_no_client_access on public.messaging_rate_limits
  as restrictive for all to anon, authenticated using (false) with check (false);

-- ---------- 4a. rate limit hit: records the attempt, returns true when OVER the limit ----------
create or replace function public.messaging_rate_hit(p_bucket text, p_key_hash text, p_limit int, p_window_s int)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  -- serialise hits for one key so two parallel requests cannot both slip under the limit
  perform pg_advisory_xact_lock(hashtextextended('pingo_rl:' || p_bucket || ':' || p_key_hash, 0));
  insert into public.messaging_rate_limits(bucket, key_hash) values (p_bucket, p_key_hash);
  select count(*) into v_count
    from public.messaging_rate_limits r
   where r.bucket = p_bucket and r.key_hash = p_key_hash
     and r.at > now() - make_interval(secs => greatest(p_window_s, 1));
  if random() < 0.02 then
    delete from public.messaging_rate_limits where at < now() - interval '2 days';
    delete from public.phone_otps where expires_at < now() - interval '1 day';
  end if;
  return v_count > p_limit;
end;
$$;
revoke all on function public.messaging_rate_hit(text, text, int, int) from public, anon, authenticated;
grant execute on function public.messaging_rate_hit(text, text, int, int) to service_role;

-- ---------- 4b. verify an OTP atomically ----------
-- Returns 'ok' | 'none' | 'expired' | 'locked' | 'wrong:<tries left>'.
-- Every check counts as an attempt; the code hash is compared inside the row lock.
create or replace function public.verify_phone_otp(p_phone_hash text, p_job_id uuid, p_code_hash text, p_max int default 5)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.phone_otps%rowtype;
begin
  select * into r
    from public.phone_otps o
   where o.phone_hash = p_phone_hash and o.job_id = p_job_id
     and o.verified_at is null and o.consumed_at is null
   order by o.created_at desc
   limit 1
   for update;
  if not found then return 'none'; end if;
  if r.expires_at <= now() then return 'expired'; end if;
  if r.attempts >= p_max then return 'locked'; end if;

  update public.phone_otps set attempts = attempts + 1 where id = r.id;
  if r.code_hash = p_code_hash then
    update public.phone_otps set verified_at = now() where id = r.id;
    return 'ok';
  end if;
  if r.attempts + 1 >= p_max then return 'locked'; end if;
  return 'wrong:' || (p_max - r.attempts - 1)::text;
end;
$$;
revoke all on function public.verify_phone_otp(text, uuid, text, int) from public, anon, authenticated;
grant execute on function public.verify_phone_otp(text, uuid, text, int) to service_role;
