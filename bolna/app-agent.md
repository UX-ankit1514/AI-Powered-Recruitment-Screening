# Pingo interviewer (app) — Bolna agent contract

For M6 (dispatcher, webhook, reschedule) and anyone calling Bolna from `/web`.
Verified against Bolna docs (docs MCP) and the live API on 2026-11-15.

| | |
|---|---|
| App agent id | `e155c924-5640-467a-b216-1bb44240497e` (also in `app-agent-id.txt`) — use as `BOLNA_AGENT_ID` in `/web` |
| Demo agent (DO NOT TOUCH) | `dbec7633-7b93-49e5-bca5-5636bd047ae4` "Aditi" — `prompt.txt` / `agent.json` stay its source of truth |
| Prompt | `app-prompt.txt` (demo prompt + `{{call_id}}`, `{{faq}}`, `{{culture_values}}`, FAQ-only answers, truthful callback booking) |
| Full config (secrets redacted) | `app-agent.json` |
| Function schema (secrets redacted) | `app-functions.json` |

Cloned from the demo: welcome message "Hi, am I speaking with {{first_name}}?", ElevenLabs `eleven_turbo_v2_5` voice "Nila" (`V9LCAAi4tTlqe9JadbCo`), Deepgram `nova-3` language `hi` (handles Hinglish), OpenAI `gpt-4.1-mini` (temp 0.4, max_tokens 200), Plivo in/out, `call_terminate: 600` (10 min), `hangup_after_silence: 15`.
Not cloned: the demo's two dispositions (post-call extractions) — the app scores transcripts itself, so `extracted_data` will be `{}`.

Secrets: the webhook URL and the function header both carry `BOLNA_WEBHOOK_SECRET` from `/web/.env.local`. If that secret is rotated, PATCH the agent (`webhook_url` and `tools_config.api_tools.tools_params.reschedule_call.headers`) or both endpoints will start rejecting Bolna.

---

## 1. Prompt variables (`user_data`)

Every key below should be sent on every call (send `""` rather than omitting; the prompt tells Aditi to skip blanks and never read out `{{...}}`).

| key | content |
|---|---|
| `call_id` | our `calls.id` (uuid). Required: the reschedule function gets it automatically (see §4). Never spoken. |
| `first_name` | candidate first name |
| `role` | job title |
| `company` | company name |
| `jd_summary` | short JD summary (shapes role questions, never read out) |
| `resume_note` | 1–3 line resume summary |
| `resume_q1`, `resume_q2` | personal resume questions (≤ 25 words each) |
| `must_haves` | bullet text, one per line |
| `culture_values` | bullet text, `- Name: description` per line |
| `faq` | Q/A text, `Q: ... A: ...` per line. Aditi answers company questions ONLY from this. Empty = she defers everything to the hiring team. |

(`traits` and `other_interest_prompt` from build-spec §5 are not used by this prompt; sending them is harmless.)

## 2. Start a phone call

`POST https://api.bolna.ai/call` · `Authorization: Bearer $BOLNA_API_KEY` · `Content-Type: application/json`

```json
{
  "agent_id": "e155c924-5640-467a-b216-1bb44240497e",
  "recipient_phone_number": "+919876543210",
  "from_phone_number": "+91XXXXXXXXXX",
  "user_data": {
    "call_id": "<calls.id uuid>",
    "first_name": "Rahul", "role": "Sales Associate", "company": "Acme",
    "jd_summary": "...", "resume_note": "...", "resume_q1": "...", "resume_q2": "...",
    "must_haves": "- Spoken English\n- Field sales experience",
    "culture_values": "- Ownership: ...\n- Customer first: ...",
    "faq": "Q: Where is the office? A: Bengaluru, HSR Layout.\nQ: Is it remote? A: No, on-site 6 days."
  }
}
```

- `from_phone_number` optional: omit to use the account's default number.
- Response: `{"message":"done","status":"queued","execution_id":"<uuid>"}` → store `execution_id` as `calls.bolna_execution_id`.
- Optional `scheduled_at` (ISO with `+00:00`, ≥ 2 min ahead, rounded up to 10 min) — only if we ever use Bolna-side scheduling.

## 3. Start a browser call (Web Call SDK)

Server route (behind our auth) proxies the mint response unchanged to the browser:

`POST https://api.bolna.ai/web-call/session` · `Authorization: Bearer $BOLNA_API_KEY`

```json
{ "agent_id": "e155c924-5640-467a-b216-1bb44240497e", "user_data": { "...same keys as §1..." } }
```

Response (200, verified with one mint on 2026-11-15): `{ run_id, agent_id, sip_username, sip_password, sip_domain, wss_url, sip_register, expires_in: 120, ice_servers }`. Single-use, ~120 s TTL: mint one per call, never cache. Client: `new BolnaWebCall({ sessionUrl: "/api/..." })` from `https://cdn.jsdelivr.net/gh/bolna-ai/web-call@v3.0.1/dist/bolna-web-call.min.js`, `call.start()` from a click. Web calls also produce an execution and fire the same webhook; `run_id` is the link (verify it equals the execution `id` on first web call).

## 4. Webhook

Configured on the agent: `webhook_url = https://pingo-app-nine.vercel.app/api/webhooks/bolna?secret=<BOLNA_WEBHOOK_SECRET>`.
No custom webhook headers are set (`webhook_headers: null`); auth = `?secret=` + source IP.

- Source IPs (whitelist all three; read client IP from `x-forwarded-for` on Vercel): `13.203.39.153`, `13.126.9.249`, `13.202.133.53`.
- Method POST, JSON body = the execution object, identical to `GET https://api.bolna.ai/executions/{id}`.
- Fires on **every status change**, several times per call with the same `id` → idempotent, key on `id`. Store every raw delivery in `webhook_events`.
- Pre-call webhooks: not used (our function has no `pre_call_webhook_param`), so every delivery is an execution update.

### Status values (`status`)

Lifecycle: `scheduled` → `queued` → `initiated` → `ringing` → `in-progress` → `call-disconnected` → `completed`.
Other: `rescheduled` (call guardrails only; not used).
Terminal: `completed`, `no-answer`, `busy`, `failed`, `canceled`, `stopped`, `error`, `balance-low`.

Rules from the docs:
1. Ignore non-terminal deliveries for content. `call-disconnected` has empty transcript/recording/cost; `completed` arrives ~2–3 min after hang-up when post-processing is done.
2. `completed` does NOT mean a conversation happened. Check `conversation_duration > 0` and at least one `user:` line in `transcript`. `termination_reason` is authoritative for how it ended.

### Where things live

| What | Field |
|---|---|
| execution id | `id` (string uuid) |
| agent | `agent_id` |
| status | `status` |
| how it ended | `termination_reason` (null while in progress) — values below |
| error text | `error_message` |
| talk seconds (billing figure) | `conversation_duration` (0 = no conversation) |
| provider call seconds | `telephony_data.duration` |
| transcript | `transcript` — string, newline-separated `assistant: ...` / `user: ...` lines |
| recording | `telephony_data.recording_url` (null if not connected / PII masking on) |
| cost | `total_cost` **in cents**; wallet deduction = `cost_breakdown.total_cost_to_deduct` |
| who hung up | `telephony_data.hangup_by`, `telephony_data.hangup_reason`, `telephony_data.hangup_provider_code` |
| numbers | `user_number` / `agent_number` (mirrors `telephony_data.to_number` / `from_number`) |
| our variables back | `context_details.recipient_data` (contains the `user_data` we sent → `call_id` lives here; use it as a fallback join if `execution_id` wasn't stored) |
| voicemail | `answered_by_voice_mail` (detection is off on this agent; rely on `termination_reason = voicemail_reached`) |
| timing | `created_at`, `initiated_at`, `updated_at` |
| function calls | NOT in payload (`tool_call_logs` is always `[]`) → the reschedule endpoint must persist bookings itself |
| latency | `latency_data.time_to_first_audio` (ms) |

### `termination_reason` values → suggested `call_outcome`

| termination_reason | outcome |
|---|---|
| `agent_ended_call`, `user_hung_up` | `completed` (or `short_exit` / `rescheduled` / `wrong_person` / `declined` from transcript + scoring + reschedule state); `user_hung_up` with tiny duration → `dropped` |
| `max_duration_reached` | `completed` |
| `inactivity_timeout` | `dropped` if no `user:` line, else `completed` |
| `voicemail_reached` | `voicemail` (retry) |
| `no_answer`, `dial_timeout` | `no_answer` (retry) |
| `busy` | `busy` (retry) |
| `declined` | `declined` |
| `abandoned` | `no_answer` |
| `agent_llm_error`, `agent_transcription_error`, `agent_voice_error`, `agent_realtime_error`, `agent_network_error`, `network_error` | `dropped`/`failed` (retry) |
| `invalid_number`, `number_blocked`, `caller_id_rejected` | `failed` (no retry) |
| `number_unreachable` | `no_answer` (retry) |
| `insufficient_balance`, `provider_account_balance`, `account_suspended`, `rate_limited`, `concurrency_limit_reached`, `provider_error`, `platform_error` | `failed` (requeue; alert) |
| `canceled_via_api` | `failed` (deliberate) |
| `call_transferred`, `destination_hung_up`, `ivr_not_completed` | not expected for this agent |
| `unknown` / null | classify from `status` + `conversation_duration` |

## 5. Custom function `reschedule_call`

Lives at `tasks[0].tools_config.api_tools` (full redacted copy in `app-functions.json`):

```json
{
  "tools": [{
    "name": "reschedule_call", "key": "custom_task",
    "description": "Book a callback when the candidate cannot talk now or asks to be called at another time (...). First call with action='list' ..., then action='book' with the exact slot_iso ... Only confirm after booked=true.",
    "pre_call_message": "One moment, let me check.",
    "parameters": { "type": "object",
      "properties": {
        "call_id":  { "type": "string" },
        "action":   { "type": "string", "enum": ["list", "book"] },
        "slot_iso": { "type": "string", "description": "exact value from slot_isos for 'book'; \"\" for 'list'" } },
      "required": ["call_id", "action", "slot_iso"] }
  }],
  "tools_params": { "reschedule_call": {
    "method": "POST",
    "url": "https://pingo-app-nine.vercel.app/api/bolna/reschedule",
    "headers": { "x-bolna-secret": "<BOLNA_WEBHOOK_SECRET>", "Content-Type": "application/json" },
    "api_token": null,
    "param": "{\"call_id\": \"%(call_id)s\", \"action\": \"%(action)s\", \"slot_iso\": \"%(slot_iso)s\"}"
  } }
}
```

How it works (per Bolna docs):
- `param` is a stringified JSON template; `%(name)s` is replaced with the LLM's argument of the same name (case-sensitive) and sent as the POST body.
- `call_id` is also a prompt variable (`{{call_id}}` from `user_data`), and Bolna auto-substitutes prompt variables into function params with the same name, so the LLM never asks for it. **Still treat it as untrusted** (validate uuid, check the call exists and is in progress/just finished, enforce max 2 reschedules).
- The `url` is static (no variable interpolation documented for `url`) — that's why `call_id` travels in the body.
- Auth: static `headers` map. Our secret goes in `x-bolna-secret` (`api_token` would set `Authorization` instead; unused). Requests come from the same three Bolna IPs.
- All three params are `required` so the `%`-template never sees a missing key; `slot_iso` is `""` on `list`. Values arrive as strings.
- The JSON response is fed back to the LLM verbatim, so keep it short and speakable. Respond fast (the caller is waiting; `pre_call_message` covers ~1–2 s).

### Request Bolna will send

```
POST /api/bolna/reschedule
x-bolna-secret: <BOLNA_WEBHOOK_SECRET>
Content-Type: application/json

{"call_id": "8f0c...uuid", "action": "list", "slot_iso": ""}
{"call_id": "8f0c...uuid", "action": "book", "slot_iso": "2026-11-17T08:30:00Z"}
```

### Response the prompt expects (build-spec §3)

- list → `200 {"slots": ["Tue 2 pm", "Tue 5 pm", "Wed 11 am"], "slot_isos": ["2026-11-17T08:30:00Z", "2026-11-17T11:30:00Z", "2026-11-18T05:30:00Z"]}` — same order, ≤ 3, within the job's calling hours (IST labels, UTC ISO). Empty arrays if none.
- book → `200 {"booked": true, "spoken": "Tuesday at 2 pm"}` or `200 {"booked": false, "reason": "slot no longer available"}`.
- Unknown/expired `call_id`, reschedule limit hit, or slot not in the offered list → `200 {"booked": false, "reason": "..."}` (prefer 200 + booked:false over 4xx so Aditi says the truthful fallback). Bad/missing secret → 401.

Prompt behaviour on top of this: Aditi offers up to 3 listed slots, books only a `slot_iso` from the list, confirms using `spoken` only when `booked: true`; otherwise says "I couldn't lock a time just now, but the hiring team has your details and will be in touch" and never names a time. On `booked: true` the endpoint should set the outcome to `rescheduled` and queue a new `calls` row at that time; the subsequent `completed` webhook for this execution must not overwrite that.

## 6. Status of testing

- Agent created (201) and fetched back: config, prompt, webhook and function match; demo agent untouched (same `updated_at`, no webhook).
- One web-call session minted for the new agent (200). No phone calls placed. The 5 scenario test calls (M4 "done when") and a real `sample-webhook.json` are still to do, once `/api/webhooks/bolna` and `/api/bolna/reschedule` are deployed.
