# Security checklist (M9)

Reviewed 2026-11-16 against the code in `/web`, the migrations in `/supabase/migrations` and the live
Supabase project `voxxikktuiwejujlmwmy`. Status: **Pass** = done and tested · **Accepted** = known,
deliberate, low risk · **Open** = needs a decision.

Test files referenced below live in `/web/tests`. "Matrix" = `tests/security/route-matrix.test.ts`.

## 1. Authentication and authorization (server-side)

| # | Item | Status | Evidence |
|---|---|---|---|
| 1.1 | Every `/api` route checks the session (or a machine secret) before doing anything | Pass | Matrix: `anon -> 401` for all 21 non-public handlers |
| 1.2 | A new route cannot ship without role tests | Pass (also covers the retention, fairness and messaging routes) | Matrix: `coverage > every exported handler under app/api has a row in the role matrix` |
| 1.3 | Company scoping: another company's resources are invisible (404, never 403) | Pass | Matrix: `other -> 404` rows; `tests/rls.test.ts` "company isolation" |
| 1.4 | Admin/recruiter write; hiring manager read + notes only | Pass | Matrix: `hm -> 403` on every write, `hm -> 200` on reads; "hiring manager can still add a note"; `tests/rls.test.ts` "hiring manager (read + notes only)" |
| 1.5 | Refused writes leave no trace | Pass | Matrix: `writes refused above leave no trace` |
| 1.6 | Bulk export of candidate PII limited to admin/recruiter | Pass | Matrix: `GET /api/jobs/[id]/export` hm -> 403, recruiter -> 200 |
| 1.7 | Company id never taken from the request body | Pass | `tests/jobs-routes.test.ts` "ignores attempts to pick another company"; routes derive it from membership/RLS |
| 1.8 | Dashboard pages load data with the user's RLS client (no service role) | Pass | Review: every page under `app/(dashboard)` uses the cookie client; proxy redirects signed-out users |
| 1.9 | Session verified with signed JWT claims (`getClaims`), not unverified cookies | Pass | Review: all auth helpers use `auth.getClaims()` |
| 1.10 | Sign-up disabled (invite only), magic-link login, no user enumeration | Pass | Supabase auth config `disable_signup=true`; login action returns the same message either way |
| 1.11 | Leaked-password protection (HaveIBeenPwned) | Accepted | Needs a Supabase Pro plan. Users sign in by magic link; passwords exist only for seeded test users |

## 2. Database (RLS, functions, grants)

| # | Item | Status | Evidence |
|---|---|---|---|
| 2.1 | RLS enabled on every table | Pass | Live check: all 11 tables `relrowsecurity=true`; `candidate_ranking` is a `security_invoker` view |
| 2.2 | No anon access anywhere | Pass | Live grants: anon has no table privileges; `tests/rls.test.ts` "unauthenticated" |
| 2.3 | Service-only tables (`webhook_events`, `apply_rate_limits`) unreadable by clients | Pass | Restrictive deny-all policies; `tests/rls.test.ts` "cannot read webhook_events"; `tests/ingest/routes.test.ts` "rate-limit table is not readable" |
| 2.4 | Security-definer functions pin `search_path` and have minimal grants | Pass | Live check: all definer functions `search_path=""`; queue/cron/retry functions service-role only; helpers in non-exposed `private` schema |
| 2.5 | AI scores can only be written by the server | Pass (new) | Migration `20261115150000`: insert/update/delete revoked from clients. `tests/security/score-retry.test.ts` "clients cannot claim retries or write scores" |
| 2.6 | Least privilege: no TRUNCATE/TRIGGER/REFERENCES for clients, no writes through the ranking view | Pass (new) | Migration `20261115150000` |
| 2.7 | Rubric save is atomic and role-checked in the database too | Pass (new) | `save_rubric_version()` (security invoker + role check + per-job lock). `tests/security/rubric-atomic.test.ts` (anon/hm/other refused, 10 concurrent saves stay consistent) |
| 2.8 | Storage: private `resumes` bucket, company-scoped policies | Pass | Bucket `public=false`; policies by first path segment; `tests/ingest/routes.test.ts` "company-scoped storage access" |
| 2.9 | Supabase advisors | Pass | Security: only leaked-password protection (see 1.11). Performance: redundant index dropped; one "unused index" on a new table is expected at low volume |
| 2.10 | Recruiters can edit call rows (e.g. transcript) of their own company | Accepted | Needed for queueing/stopping calls; scoring reads the transcript the webhook stored. Revisit if recruiters must not touch call data |

## 3. Service-role usage (each use and why)

| Where | Why it needs the service role | Scoping |
|---|---|---|
| Bolna webhook (`lib/calls/webhook.ts`) | Machine caller, no user session; writes call results, scores, raw events | Secret + IP allowlist; rows found by execution id |
| Dispatcher (`lib/calls/dispatch.ts`) | Cron caller; claims queued calls across companies | `x-dispatch-secret`; SQL function is service-only |
| Reschedule function (`lib/calls/reschedule.ts`) | Called by Bolna mid-call | `x-bolna-secret` + IP allowlist; scoped to the given call id |
| Web-call session (`lib/calls/single.ts`) | Links Bolna's run id to the call row the user just created | Only after the user's own RLS insert succeeded; one row by id |
| Public apply (`lib/ingest/apply.ts`, `public-job.ts`) | Applicant has no account | Open jobs only; returns only `{ok:true}`; rate-limited; writes scoped to the job's company |
| Teammate emails (`components/results/server/team.ts`) | Emails live in `auth.users` | Only for user ids the caller's own RLS query returned |
| Candidate erase (`lib/retention/erase.ts`) | Removes the candidate's stored files before the database erase | Only after the caller is confirmed admin of the candidate's company (RLS client); the database erase re-checks the role |
| Retention file deletes (`lib/retention/files.ts`) | Deletes storage files queued by the nightly purge | Service-only claim/settle functions; runs on the cron dispatcher run |

The service-role client imports `server-only`, so any browser import fails the build (`tests/security/unit.test.ts`).

## 4. Secrets, logs, bundles

| # | Item | Status | Evidence |
|---|---|---|---|
| 4.1 | Secret comparisons are constant time | Pass | `safeEqual` (SHA-256 + `timingSafeEqual`); `tests/security/unit.test.ts` "every secret-checked route goes through safeEqual" |
| 4.2 | No secrets in client bundles | Pass | After `next build`: no service key, AI key, Bolna key, webhook/dispatch secret or seed password value in `.next/static` (35 files scanned). Only the public Supabase URL + anon key are inlined |
| 4.3 | No PII in logs | Pass | Only two server logs: execution id + status + error message, and a dispatcher error message. No names, phones, transcripts |
| 4.4 | Webhook secret travels in the query string | Accepted | Bolna sends no custom webhook headers; the secret can appear in platform request logs. Rotate per `bolna/app-agent.md` if exposed |
| 4.5 | Dispatch secret for pg_cron kept in Supabase Vault, not in migrations | Pass | `20261115140100_dispatch_cron.sql` |
| 4.6 | No copy of the service-role key in the database | Pass (fixed) | Retention had stored the service key in Vault so the nightly purge could call the Storage API over HTTP. Now the purge (SECURITY DEFINER, run directly by pg_cron) only queues files and the app server deletes them with the key it already holds; the Vault copy is deleted. Migration `20261116130000`; `tests/security/retention-files.test.ts` |
| 4.7 | pg_net request rows (which carry the dispatch secret while queued) are not reachable by clients | Accepted | Supabase grants read on them, but the `net` schema is not exposed by the API (only `public`, `graphql_public`) |

## 5. Webhooks and machine routes

| # | Item | Status | Evidence |
|---|---|---|---|
| 5.1 | Webhook + reschedule require the secret | Pass | Matrix machine rows; `tests/calls/routes.test.ts` "rejects a missing or wrong secret", "bad secret -> 401" |
| 5.2 | Bolna IP allowlist, configurable | Pass (new) | `BOLNA_IP_ALLOWLIST` (comma-separated). Empty = Bolna's 3 published IPs; `off` disables. On Vercel a missing caller IP is refused. `tests/security/unit.test.ts` "Bolna source-IP allowlist" |
| 5.3 | Webhook idempotent (stored once per execution + status) | Pass | `tests/calls/routes.test.ts` "is idempotent" |
| 5.4 | Safety lock: no phone call unless `DISPATCH_ENABLED=true` and an Indian mobile | Pass | `tests/calls/routes.test.ts` "SAFETY LOCK" (2 tests). Production keeps calling paused |
| 5.5 | Scoring failure after a completed call is retried | Pass (new) | `calls.score_status` + `claim_score_retries()`; retried by the every-minute dispatcher, backoff 2 then 10 min, 3 attempts in all, then the candidate is freed for a re-call. `tests/security/score-retry.test.ts` (5 tests) |

## 6. Browser-facing protections

| # | Item | Status | Evidence |
|---|---|---|---|
| 6.1 | CSRF: cross-site writes to cookie-authenticated routes refused | Pass (new) | Proxy checks `Origin` / `Sec-Fetch-Site` on non-GET `/api/*` and `/auth/*` (machine routes and public apply exempt). Session cookies are also SameSite=Lax; server actions have Next's own origin check. `tests/security/unit.test.ts` "CSRF" |
| 6.2 | No open redirect in the auth callback | Pass (fixed) | `safeNext` previously let `/<tab>/evil.com` through (browsers strip tabs, turning it into `//evil.com`). Now rejects control chars/whitespace/backslashes and re-checks the origin. `tests/security/unit.test.ts` "auth callback: no open redirects" |
| 6.3 | Magic-link redirect built from configured origin, not the Host header | Pass (new) | `app/login/actions.ts`; Supabase redirect allowlist is the production URL + localhost |
| 6.4 | Security headers | Pass (new) | CSP, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy (microphone self only), HSTS, COOP; `X-Powered-By` off. `tests/security/unit.test.ts` "security headers" |
| 6.5 | CSP allows only Supabase, Bolna API, jsDelivr, self-hosted fonts | Pass (new) | `lib/security/headers.ts`. `'unsafe-inline'` scripts kept because of Next's inline bootstrap with Partial Prerendering; `wss:` kept because the Bolna web-call SIP socket host is per session |
| 6.6 | Third-party SDK pinned and integrity-checked | Pass (new) | Bolna Web Call SDK pinned to v3.0.1 with SRI sha384. `tests/security/unit.test.ts` "pinned ... with SRI" |
| 6.7 | Recordings: private storage paths get short-lived signed URLs | Pass | `components/results/server/data.ts` (10-minute signed URL); never `javascript:`/`data:`/`http:` |
| 6.8 | Bolna-hosted recording URLs are shown as Bolna returns them | Accepted | Only to members of the candidate's company; Bolna URLs are long and unguessable. Proxying audio through the app would remove this |
| 6.9 | CSV export guarded against formula injection | Pass | `tests/results/model.test.ts` "guards CSV cells against formula injection" |

## 7. Abuse and rate limits

| # | Item | Status | Evidence |
|---|---|---|---|
| 7.1 | Public apply: 5 per hour per IP (database-backed, IP stored hashed) | Pass | `tests/ingest/routes.test.ts` "rate-limits to 5 per hour per IP" |
| 7.2 | Apply: honeypot, consent required, file type checked by magic bytes | Pass | `tests/ingest/routes.test.ts` |
| 7.3 | Login emails rate-limited by Supabase | Pass | Supabase auth limits (email sends per hour, OTP and verify limits) |
| 7.4 | Signed-in AI routes (rubric draft, browser call) have no per-user limit | Accepted | Only admins/recruiters of a company can reach them; revisit before opening to many customers |

## 8. Correctness fixes made in M9

| # | Item | Status | Evidence |
|---|---|---|---|
| 8.1 | Call cost stored in US cents was shown as rupees (100x off and wrong currency) | Fixed | Dashboard now shows dollars and a clearly derived rupee figure at `COST_FX_INR_PER_USD` (default 88). `tests/security/unit.test.ts` "call cost" |
| 8.2 | Flaky test phone generator could collide in one job | Fixed | `tests/ingest/routes.test.ts` |

## Configuration reference

| Env | Default | Purpose |
|---|---|---|
| `DISPATCH_ENABLED` | unset (paused) | Phone calls only when exactly `true` |
| `BOLNA_IP_ALLOWLIST` | Bolna's 3 IPs | Webhook/reschedule source IPs; `off` disables |
| `COST_FX_INR_PER_USD` | 88 | Rate for the derived rupee cost |
| `RATE_LIMIT_SALT` | service key | Salt for hashed apply-form IPs |
