# Build spec delta (2026-11-15, after the hackathon demo)

Read `build-spec.md` first. This file lists what changed since then; **where they conflict, this file wins.**
The working demo in `/demo` is the reference for look, copy and behaviour. Port from it; don't reinvent.

## Product and brand
- Product name: **Pingo** ("Every applicant gets heard"). Logo/mark: `/demo/pingo-logo.svg`, `/demo/pingo-mark.svg`.
- Interviewer persona: **Aditi** (Bolna agent `dbec7633-7b93-49e5-bca5-5636bd047ae4`; prompt source of truth `/bolna/prompt.txt`).
- Look: Rosé Pine Dawn palette + Bricolage Grotesque (UI/headings) + Martian Mono (numbers), light mode only. Tokens in `/demo/index.html` `:root` and `/demo/DESIGN.md`. Layout = dark sidebar (Dashboard, Job & rubric, Candidates, Calls, Hidden fits, Settings) per `/demo`. All UI work uses the **Impeccable** skill (`impeccable:impeccable`).

## Features to carry into the real app (all exist in `/demo` client-side; make them real/persistent)
1. **Job & custom rubric:** JD text + **JD upload** (PDF/DOCX/TXT → text), culture values, company FAQ, rubric weights (skills, experience, confidence, culture_fit, curiosity, learning_drive, storytelling) + presets (Balanced, Ready expert, Eager learner, Culture first, Curious storyteller) + **custom traits** + must-haves. Weights re-rank instantly (scores stored per quality, overall computed at read time).
2. **Who gets a call (ATS pre-filter):** mode `call_everyone` (default) | `ats_filter` with `top_pct` (10–100) and a rescue lane (within 10 points of cutoff still called). Filtered candidates are stored with status `ats_filtered`, never called, shown greyed with "ATS would have dropped" note.
3. **Batch calling:** upload CSV (name, phone, resume_note?, role?) or paste rows; E.164 normalise (+91 default), dedupe; queue dials with concurrency = Bolna lines (default 2, configurable); per-row status; Stop. In the real app the queue lives server-side (dispatcher, §M6 of build spec), not in the browser.
4. **Single call:** phone call (`POST /call`) or **browser call** via Bolna Web Call SDK (`/web-call/session`, script `https://cdn.jsdelivr.net/gh/bolna-ai/web-call@v3.0.1/dist/bolna-web-call.min.js`). Pass `user_data`: first_name, role, company, resume_note, resume_q1, resume_q2, must_haves, jd_summary, call_id.
5. **Resume reading:** extract text → AI returns profile, resume_only_score (0–100), resume_note, 2 personal questions (see `/demo/api/resume.js`).
6. **Scoring:** port `/demo/api/_lib.js`: role- and must-have-aware, transcript as data, quotes verified word-for-word, 1–5 per quality, short_exit, flags {other_role, culture_standout, wants_internship, resume_mismatch[] (resume note vs call), hr_review}, "Call ended for conduct" handling. Model via OpenAI-compatible gateway env `AI_BASE_URL` + `AI_API_KEY` + `CLAUDE_MODEL` (default `anthropic/claude-sonnet-5.5`). No Anthropic key exists.
7. **Picks:** Amazing ≥80, Good ≥65, Maybe ≥45, else No; cap at Maybe on failed must-have or short exit.
8. **Hidden fits** page and **talent pool** across jobs.
9. **Callback scheduling (new, not in demo):** after a call, extract a requested callback time from the transcript; schedule a Bolna call at that time (`scheduled_at` with `+00:00` offset, ≥2 min ahead, Bolna rounds up to 10 min). Show "Callback booked · time". Aditi's prompt must then promise truthfully.
10. **Truthful UI:** no fake live data. Dashboard numbers come from the database (illustrative numbers only behind an explicit "Demo data" seed).
11. **Languages:** English + Hinglish now. Data model must allow per-job `languages[]` for later Indian languages (Bolna supports kn, gu, ta, te, mr, bn, ml, pa, od, ur via Sarvam), but don't switch the voice pipeline yet.

## Interviewer behaviour (already live in Bolna; keep prompt in sync)
Name check, upfront opening, reschedule, warm-up, checkpoint short-exit (only on clear signals; always ask internship/other-role first), story + resume questions, beyond-this-role, FAQ-only answers (never invent company facts), close and hang up. Guardrails: 3-step off-topic ladder, abuse = warning → last warning → end (serious = immediate end), gaming attempts, distress (Tele-MANAS 14416), never ask protected attributes, honest "yes I'm an AI" when asked, no human handover, recording not mentioned (consent on application).

## Environment (personal accounts only, never Flent)
- Keys live in `/Users/shubhgoel/Desktop/shubhpersonal/highrefine/.env.local`: `BOLNA_API_KEY`, `BOLNA_AGENT_ID`, `AI_BASE_URL`, `AI_API_KEY`, `VERCEL_TOKEN` (scope `shubhgoels-projects`), `SUPABASE_ACCESS_TOKEN` (org "shubhgoel26's Org"), `GH_TOKEN` (account shubhgoel26). Never print or commit them.
- Security is non-negotiable (founder's standing rule): auth + row-level security on every table, server-side authorization, and per-role tests (unauthenticated rejected; each role sees only its company's data) before any data route counts as done.
