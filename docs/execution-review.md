# Execution review (2026-11-16)

Independent read-only review of the built app vs the plan. 342 tests pass, typecheck clean. Gaps are wiring and intent, not crashes. Status column is filled in as fixes land.

## 1. Blocks real use
| # | Gap | Where | Fix | Status |
|---|---|---|---|---|
| 1 | HR can't upload resumes in-app (batch + single forms send no resume) → no resume score, ATS filter inert, no resume questions, weak mismatch check | web/components/calls/batch-panel.tsx, single-call.tsx | Add resume upload; extract text in browser (reuse web/components/jobs/extract-text.ts) | open |
| 2 | Line cap is per job, Bolna's is per account; concurrency refusals burn attempts | claim_due_calls (20261115140000_dispatch_queue.sql), web/lib/calls/outcome.ts, dispatch.ts | Account-wide in-flight cap; don't count 429/concurrency as an attempt | open |
| 3 | Browser test call with no speech queues a real phone retry | web/lib/calls/lifecycle.ts | Never retry web calls | open |
| 4 | Stop doesn't stop in-flight retries; silently deletes promised callbacks | web/app/api/batches/[id]/cancel/route.ts | Block retries for stopped batches; keep callbacks or warn | open |

## 2. Wrong / buggy
| 5 | Voicemail / wrong person scored as real calls | bolna/app-agent.json, web/lib/calls/outcome.ts | Enable voicemail detection; scorer reports voicemail/wrong person → retry | open |
| 6 | Saving ATS setting doesn't re-apply it | web/app/api/jobs/[id]/route.ts | Re-apply on save | open |
| 7 | Dashboard/jobs ignore HR pick overrides | web/components/dashboard/load.ts, jobs/page.tsx | Use evaluate() from results data | open |
| 8 | Webhook processing failure lost (retry treated as duplicate) | web/lib/calls/webhook.ts | processed_at; reprocess unprocessed events | open |
| 9 | Callback request after a full scored call books another call | scoreAndStore in webhook.ts | Only book from short/cut-off calls | open |
| 10 | Batch progress confuses callback vs original (attempt resets) | web/lib/ingest/batches.ts | Order by created_at / track parent | open |
| 11 | Starting a batch doesn't kick the dispatcher; cron depends on a manually-added Vault secret | batches route, 20261115140100_dispatch_cron.sql | Kick dispatcher; verify Vault secret; surface "scheduler not running" | open |

## 3. Missing vs plan
| 12 | Custom/preset traits and other open roles never asked on the call | bolna/app-prompt.txt, web/lib/calls/context.ts | Add {{traits}}, {{open_roles}} to prompt + brief | open |
| 13 | No screen shows the public apply link; unknown job page links to login | apply page, job setup | Share-link card; fix dead-end | open |
| 14 | No lines-per-job setting, no close job, DEFAULT_CONCURRENCY unused | settings/jobs | Add | open |
| 15 | Quote → audio jump rarely works (no timestamps); recordings are Bolna permanent links | profile | Approximate by position or remove; proxy recordings via signed route | open |
| 16 | Compare page, heads-up SMS, retention, bias watch | — | Last three in progress | in progress |
| 17 | Rejecting a queued candidate doesn't cancel their call | actions route | Cancel queued calls on reject | open |

## 4. Test gaps
Recruiter-role tests for calls/ingest/batches/web-session; per-role tests for dashboard page data loads; account-wide line cap; web call never phone-retries; Stop blocks retries; reschedule rejects non-Bolna IPs; one end-to-end browser test.

## 5. Cleanup
.env.example lists BOLNA_AGENT_ID but code reads BOLNA_APP_AGENT_ID; RATE_LIMIT_SALT missing on prod; preview deploys have no env; unused routes (/screen, /ats/apply) — wire or remove; /talent-pool redirect; interviewer transcriber set to Hindi — check English quality; security headers not yet deployed (pending security review).
