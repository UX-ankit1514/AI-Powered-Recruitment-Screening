# Execution review (2026-11-16)

Independent read-only review of the built app vs the plan. 342 tests pass, typecheck clean. Gaps are wiring and intent, not crashes. Status column is filled in as fixes land.

## 1. Blocks real use
| # | Gap | Where | Fix | Status |
|---|---|---|---|---|
| 1 | HR can't upload resumes in-app (batch + single forms send no resume) → no resume score, ATS filter inert, no resume questions, weak mismatch check | web/components/calls/batch-panel.tsx, single-call.tsx | Add resume upload; extract text in browser (reuse web/components/jobs/extract-text.ts) | fixed: resumes in batch (CSV file-name column or name match, per-row attach) and single call; read in browser, readResume runs |
| 2 | Line cap is per job, Bolna's is per account; concurrency refusals burn attempts | claim_due_calls (20261115140000_dispatch_queue.sql), web/lib/calls/outcome.ts, dispatch.ts | Account-wide in-flight cap; don't count 429/concurrency as an attempt | fixed: company-wide cap (companies.concurrency_limit, default DEFAULT_CONCURRENCY), capacity refusals re-queue +2 min on the same attempt |
| 3 | Browser test call with no speech queues a real phone retry | web/lib/calls/lifecycle.ts | Never retry web calls | fixed |
| 4 | Stop doesn't stop in-flight retries; silently deletes promised callbacks | web/app/api/batches/[id]/cancel/route.ts | Block retries for stopped batches; keep callbacks or warn | fixed: stopped batches never retry or get picked up; callbacks kept unless chosen |

## 2. Wrong / buggy
| 5 | Voicemail / wrong person scored as real calls | bolna/app-agent.json, web/lib/calls/outcome.ts | Enable voicemail detection; scorer reports voicemail/wrong person → retry | done (eval-v1: call classification before scoring, non-conversations retried, voicemail detection on the app agent) |
| 6 | Saving ATS setting doesn't re-apply it | web/app/api/jobs/[id]/route.ts | Re-apply on save | fixed: save re-applies (incl. back to call everyone); separate /ats/apply route removed |
| 7 | Dashboard/jobs ignore HR pick overrides | web/components/dashboard/load.ts, jobs/page.tsx | Use evaluate() from results data | fixed |
| 8 | Webhook processing failure lost (retry treated as duplicate) | web/lib/calls/webhook.ts | processed_at; reprocess unprocessed events | done (webhook_events.processed_at; failed/lost deliveries reprocessed by the stale sweep and on re-delivery) |
| 9 | Callback request after a full scored call books another call | scoreAndStore in webhook.ts | Only book from short/cut-off calls | done (callback booked only from short / cut-off calls) |
| 10 | Batch progress confuses callback vs original (attempt resets) | web/lib/ingest/batches.ts | Order by created_at / track parent | fixed |
| 11 | Starting a batch doesn't kick the dispatcher; cron depends on a manually-added Vault secret | batches route, 20261115140100_dispatch_cron.sql | Kick dispatcher; verify Vault secret; surface "scheduler not running" | fixed: batch start kicks dispatcher + heads-up sender; Settings shows scheduler status (tick table + Vault/cron check) |

## 3. Missing vs plan
| 12 | Custom/preset traits and other open roles never asked on the call | bolna/app-prompt.txt, web/lib/calls/context.ts | Add {{traits}}, {{open_roles}} to prompt + brief | done ({{interview_plan}}, {{traits}}, {{open_roles}} in the app prompt + brief) |
| 13 | No screen shows the public apply link; unknown job page links to login | apply page, job setup | Share-link card; fix dead-end | fixed |
| 14 | No lines-per-job setting, no close job, DEFAULT_CONCURRENCY unused | settings/jobs | Add | fixed: Settings call lines (admin, 1-50), Close / Reopen job |
| 15 | Quote → audio jump rarely works (no timestamps); recordings are Bolna permanent links | profile | Approximate by position or remove; proxy recordings via signed route | open |
| 16 | Compare page, heads-up SMS, retention, bias watch | — | Last three in progress | in progress |
| 17 | Rejecting a queued candidate doesn't cancel their call | actions route | Cancel queued calls on reject | fixed |

## 4. Test gaps
Closed (tests/calls/execution-fixes.test.ts): recruiter-role tests for calls/ingest/batches/web-session; account-wide line cap; web call never phone-retries; Stop blocks retries; reschedule rejects non-Bolna IPs. Still open: per-role tests for dashboard page data loads; one end-to-end browser test.

## 5. Cleanup
Done 2026-11-16: .env.example now lists BOLNA_APP_AGENT_ID; RATE_LIMIT_SALT set on Vercel production (applies on next deploy); /screen removed ("call now" uses /api/calls/phone, batches use /api/batches), /ats/apply removed (job save re-applies); dispatcher tests run in their own throwaway companies. Remaining below.

.env.example lists BOLNA_AGENT_ID but code reads BOLNA_APP_AGENT_ID; RATE_LIMIT_SALT missing on prod; preview deploys have no env; unused routes (/screen, /ats/apply) — wire or remove; /talent-pool redirect; interviewer transcriber set to Hindi — check English quality; security headers not yet deployed (pending security review).

## Fix notes (2026-11-16, execution fixes)
- #1 resumes: batch panel + single call read PDF/DOCX/TXT in the browser (pdf.js / mammoth now load from jsDelivr: the CSP never allowed the old cdnjs URLs, so JD and apply-form uploads were broken in production too).
- #2/#14 call lines are per company (Settings, admin only, 1-50, default DEFAULT_CONCURRENCY or 2); a Bolna capacity refusal re-queues in 2 min without using an attempt. Migration 20261116140100.
- #4 Stop marks the batch stopped first; booked callbacks are kept unless the recruiter ticks "also cancel". Close job does the same for a whole job.
- #11 the dispatcher records a tick each cron run; Settings shows "Scheduler not running" when the cron, its Vault secret or a tick from the last 3 minutes is missing.
- Removed unused routes /api/jobs/[id]/screen and /api/jobs/[id]/ats/apply (saving the job re-applies the ATS setting). Added /api/jobs/[id]/close and /api/settings/lines (both in the route matrix).
- "Call now" skips the heads-up; batch calls are queued 2 min ahead and never dialled sooner than 2 min after their heads-up.
- Still open: RATE_LIMIT_SALT on Vercel production (the CLI login here cannot see the pingo-app project).
