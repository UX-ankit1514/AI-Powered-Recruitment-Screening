PRD: Voice AI Recruiter Screening (Bolna) – Hackathon MVP
Nov 15, 2026 · @Tushar Gupta
Decisions needed
Five calls unblock the build. Each has a recommended default so the team can start before they are made.
Owner
Decision
Recommended default
Why it matters
Tech Lead
Cascaded pipeline (ASR + LLM + TTS) or one speech-to-speech model in Bolna
Cascaded: Deepgram ASR, GPT-4o-class or Claude LLM, ElevenLabs/Cartesia TTS
We need a clean transcript for scoring and per-stage control of Hindi/English
Tech Lead
Score in Bolna's post-call extraction or in our own LLM service
Our own service, triggered by Bolna's completion webhook
Keeps the rubric, weights and evidence quotes under our control and versioned
Tech Lead
Telephony for the demo
Number bought in the Bolna dashboard; Exotel/Plivo later for India scale
Zero setup on hackathon day
Business Lead
First segment
High-volume Indian hiring: BPO, sales, retail, campus and fresher roles
Highest application volume per role and most phone-first candidates
Business Lead
Positioning of the AI's role
"AI screens, HR decides": no auto-reject in any tier
Lowers legal and reputational risk and makes the pitch easier to buy
1. TL;DR
Pitch: An AI voice agent that phones every applicant, runs a short interview tailored to the job description and the candidate's own resume, and hands HR a ranked, evidence-backed shortlist, so a team screens 1,000 applicants in a day instead of weeks.
	•	Problem: First-round phone screening is the slowest, least consistent step in hiring. Strong candidates wait or get missed; recruiters burn hours on calls that end in "not a fit".
	•	Solution: HR uploads a JD and applicants flow in from portals, email, a public form or CSV. A Bolna voice agent calls each candidate, asks adaptive questions, and an LLM scores the transcript on skill match, experience depth and communication.
	•	Output: A dashboard with a ranked shortlist. Every score links to transcript quotes and the call recording, and HR keeps the final decision.
	•	Hackathon scope (P0): JD upload with editable rubric, CSV and public-form ingestion, one live Bolna outbound call, post-call scoring, and a ranked shortlist with a candidate detail page. Portal integrations are simulated.
	•	Differentiator: Questions are generated from the JD plus each resume, so the call probes what that person claims. Confidence is a bounded, minor signal, never a gate.
2. Problem, users and personas
Screening, not sourcing, is the bottleneck: a single open role draws 1,000+ applications, and a recruiter can phone-screen only a few dozen a day (assumption, to validate with 3 HR interviews).
Persona
Job to be done
Pain today
What they need from us
HR recruiter (startup generalist or corporate TA)
Turn 1,000 applicants into 30 worth interviewing
Hours of repetitive calls, no-shows, gut-feel notes that are hard to compare
Calls run automatically; a ranked list with reasons and recordings
Hiring manager
Meet only candidates who can do the job
Shortlists padded with keyword matches who fail basic probing
Evidence that the candidate actually did what the resume says
Candidate
Get a fair, fast hearing
Weeks of silence; screening calls at bad times; one rushed chance
A call at a time they choose, in their language, with a clear next step
Root causes
	•	Keyword filters on resumes reward formatting, not ability, and miss strong candidates with plain resumes.
	•	Human phone screens vary by recruiter, time of day and fatigue, so scores are not comparable across a pool.
	•	Slow first contact loses the best candidates to faster employers.
3. Goals, non-goals and success metrics
The MVP wins if one job goes from JD upload to ranked shortlist, with a real phone call in between, during the demo.
Goals
	•	Cut time from application to shortlist from weeks to under 24 hours.
	•	Make every screening score explainable through transcript evidence.
	•	Give every applicant a call, not only the top resume-keyword matches.
Non-goals (MVP)
	•	Final hiring decisions or auto-rejection.
	•	Technical assessments (coding tests, case studies).
	•	Video or facial analysis.
	•	Real job-portal API integrations (simulated in the demo).
Metric
Definition
MVP target (demo)
Pilot target (assumption)
Time to shortlist
Hours from JD upload to ranked list
Under 15 minutes for 20 seeded candidates
Under 24 h for 1,000
Cost per screen
Bolna + LLM + telephony per completed call
Measured and shown
Under ₹50 per screen
Shortlist precision
Share of AI top-30 that HR would also shortlist
Not measured
70%+ agreement vs a human panel
Call completion rate
Completed screens / calls attempted
1 of 1 live call
60%+ after 3 retries
Candidate drop-off
Calls ended before the last question
Tracked
Under 15%
HR override rate
Scores changed by HR
Tracked
Falling over time (signals calibration)
4. User journeys and user stories
The core journey has six steps and only two of them need a human.
HR journey (happy path)
	•	HR creates a job and uploads the JD; the system extracts a rubric (must-have skills, nice-to-haves, years of experience, location, notice period). HR edits and approves it. (human)
	•	Applicants arrive through the gateways (CSV/ZIP, portal feed, email inbox, public form) and are parsed, deduplicated and phone-validated.
	•	HR clicks Start screening; candidates get an SMS/WhatsApp notice with a slot picker, then the Bolna agent calls in the chosen window.
	•	After each call, Bolna's webhook delivers the transcript and recording; the scoring service writes scores with evidence quotes.
	•	The shortlist view ranks candidates live as calls complete.
	•	HR reviews the top candidates, listens to clips, overrides if needed, and sends interview invites. (human)
Candidate journey: gets a notice → picks a time or takes the call → consents to recording → answers 5-8 questions in English or Hindi → asks own questions → hears the next step and timeline.
ID
As a...
I want to...
Acceptance criteria
US-1
Recruiter
upload a JD and get an editable rubric
PDF/DOCX/text accepted; rubric shown in under 30 s; every field editable; rubric saved as a version
US-2
Recruiter
import 1,000 applicants from a CSV/ZIP
Parse rate shown; duplicates merged by phone + email; invalid numbers flagged, not dropped
US-3
Recruiter
start screening with one click
Calls queued within configured window and concurrency; status visible per candidate
US-4
Candidate
be called at a time that suits me
Slot link in notice; reschedule possible during the call ("call me later")
US-5
Candidate
know I'm talking to an AI and that I'm recorded
Disclosure and consent in the first 20 s; "no" ends the call and marks the candidate for human follow-up
US-6
Recruiter
see a ranked shortlist with reasons
Ranked by overall score; each sub-score shows at least one transcript quote
US-7
Hiring manager
compare 2-3 finalists side by side
Scores, summaries, red flags and audio clips in one view
US-8
Recruiter
override a score and leave a note
Override logged with user, time, old and new value; used for calibration
US-9
Recruiter
export or push shortlisted candidates
CSV export (P0); ATS push and calendar invite (P1)
5. Functional requirements
P0 is what we demo; P1 makes it pilot-ready; P2 makes it a product. Everything not marked P0 is mocked or cut on hackathon day.
5a. Admin dashboard (web)
Feature
P0
P1
P2
HR login, create/manage jobs
Email login, single org
Roles: recruiter, hiring manager, admin
SSO, multi-org
JD upload + rubric extraction
PDF/DOCX/text; LLM extracts must-haves, nice-to-haves, years, location; HR edits
Rubric templates per role family
Learn rubric from past successful hires
Screening config
Question count (5-8), language (EN/HI), scoring weights
Call window, retry rules, max call length
A/B test question sets
Pipeline view
Statuses: Imported, Queued, Called, No Answer, Completed, Shortlisted, Rejected
Bulk actions, live call counter
Funnel analytics per source
Shortlist view
Ranked table: overall, skill match %, experience fit, communication, one-line summary
Filters (score, experience, location, notice period), sort
Saved views, team sharing
Candidate detail
Resume, recording, transcript with highlighted keywords, score breakdown with quotes
Soft-skill radar, red flags (resume vs call mismatch), clip jump-to
Interviewer notes from later rounds
Compare
—
2-3 candidates side by side
Shareable comparison link for hiring manager
HR actions
Shortlist, reject, CSV export
Override score with note, re-call, interview invite
ATS push, calendar booking
5b. Applicant ingestion (input gateways)
Gateway
P0
P1
P2
Bulk CSV / ZIP of resumes
Yes
—
—
Public application form / link
Yes (name, phone, email, resume, consent tick)
Embeddable widget
—
Job portals: LinkedIn, Naukri, Indeed, Foundit, Apna
Simulated feed from a JSON fixture
Email-forward parsing of portal application alerts
Official partner APIs where available
Email inbox (jobs@)
—
Parse attachments into candidates
—
ATS: Greenhouse, Lever, Zoho Recruit
—
—
Two-way sync
Processing
Resume parse to fields; phone normalized to E.164
Dedupe by phone + email; invalid-number flag; consent record
Fraud/duplicate-identity checks
Assumption: most portals gate application data behind paid employer accounts or partner programs, so the MVP simulates them. Verify each portal's access terms before P2.
5c. Voice screening engine (Bolna)
	•	Per-candidate prompt (P0): built from the approved rubric plus the parsed resume, passed as per-call context so the agent asks about this person's own projects and gaps.
	•	Call flow (P0): greeting and AI disclosure → recording consent → identity check (name) → role intro (30 s) → 5-8 adaptive questions → candidate questions → close with next steps.
	•	Edge cases: voicemail detection and retry (P0: 1 retry; P1: 3 with backoff), "call me later" reschedule (P1), language switch EN/HI mid-call (P1), interruptions and off-topic answers redirected once then moved on (P0).
	•	Post-call (P0): Bolna webhook on status change → on completed, fetch transcript and recording → queue for scoring.
What Bolna gives us as-is versus what we build (Bolna glossary, platform concepts, FAQ):
Capability
From Bolna
We build
Agent with prompt, ASR → LLM → TTS pipeline
Yes; Deepgram/Azure ASR, OpenAI/Anthropic/own LLM, ElevenLabs/Cartesia TTS
Prompt templates per rubric
Outbound single calls and CSV batches
Yes (/batches, per-row recipient_data)
Queue that feeds batches from our pipeline
Guardrails: time-of-day, do-not-call list, daily caps
Yes
Policy config per job
Transcript, recording URL, extraction JSON
Yes, populated at completed status
Our own scoring with evidence
Webhook on every status change
Yes, same payload as GET /executions/{id}
Receiver, idempotency, retries
Concurrency
10 concurrent calls by default on paid plans; more on Enterprise
Throttling and scheduling
Languages
Multilingual, Hindi and English cited
Verify Hinglish code-switching quality ourselves
Unverified: exact Indic language list, Hinglish quality, and webhook payload schema. Test on day one.
5d. Scoring and shortlisting engine
	•	Transparent rubric with five dimensions (section 6); weights configurable per job (P0).
	•	Shortlist threshold and top-N setting (P0).
	•	Every sub-score stores 1-3 transcript quotes with timestamps (P0). No quote, no score: the dimension is marked "insufficient evidence".
	•	Consistency check: claims in the call compared with the resume (P1 red flag).
5e. Soft skills: what we assess and how
Recruiters' first-round screens mostly test communication, motivation and whether the resume holds up under questions. Remote and hybrid work raised the weight of written and spoken clarity and self-management; startups weigh ownership and adaptability more than corporates, which weigh structure and stakeholder skills. Treat this table as design input from practitioner consensus (assumption), to be validated with 3-5 recruiters.
Soft skill
How humans assess it today
Voice-call signals we can use
Standout vs average
Communication clarity
Gut feel during the call
Answer structure (situation → action → result), concise answers, few restarts
Standout answers the question asked in under 90 s with one concrete example
Confidence
Tone, hesitation
Response latency, filler-word rate, hedging phrases ("I think maybe")
Standout commits to claims and owns gaps ("I haven't used X, but...")
Ownership
"Tell me about a project"
First-person "I did" vs "we did", outcome with a number
Standout names a decision they made and its result
Problem-solving
Follow-up probing
Steps explained in order; handles a follow-up "why"
Standout explains a trade-off they weighed
Adaptability / learning
Questions on change
Story of learning a new tool or role fast
Standout names what they would do differently
Motivation and role fit
"Why this role?"
Specificity about the company/role, alignment with JD
Standout links own goal to this role's actual work
Consistency with resume
Rarely checked
Claimed skills and dates in call vs resume
Standout goes deeper than the resume, not just repeats it
5f. The limits of "confidence" scoring
Voice-based confidence is the riskiest signal in the product. A University of Washington study presented at EMNLP found leading audio models rated identical scripts lower in Chinese and Nigerian accents and placed Indian accents in the middle, below American and British (EurekAlert). Speech recognition also makes more errors on non-standard dialects (Axios). Nervousness, neurodivergence and second-language speakers all read as "low confidence" while saying nothing about competence.
Mitigations we build in:
	•	Score what was said (content, specificity, structure) from the transcript, not how it sounded (accent, pitch, voice quality).
	•	Cap the confidence/communication dimension at 15% of the overall score; it can reorder close candidates but never push someone over or under the shortlist line alone.
	•	Never use confidence as a reject reason; it is shown as context with its evidence.
	•	Report score distributions by language and region of the candidate pool, and alert HR when gaps appear (P1).
	•	Offer a callback or human screen to any candidate on request.
6. Scoring model
Each candidate gets a 0-100 overall score from five evidence-backed dimensions, plus a must-have gate that HR controls.
Dimension
Default weight
Scale
How it is scored
Evidence required
Skill match (S)
30%
0-100
Share of rubric must-haves the candidate demonstrates in resume and call, nice-to-haves at half credit
Resume line or quote per skill
Experience relevance (E)
25%
0-100
Years in relevant work vs JD, plus depth: did they explain what they did, how, and the result
1-2 quotes
Answer quality (A)
20%
1-5 per question, rescaled
LLM grades each answer against a per-question rubric written from the JD
Quote per answer
Soft skills (P)
10%
1-5 per skill in 5e, rescaled
Ownership, problem-solving, adaptability, motivation
Quote per skill
Communication and confidence (C)
15% (hard cap)
0-100
Transcript-only features: structure, specificity, hedging and filler-word rate, response latency
Quote plus feature values
\text{Overall} = G \cdot (0.30\,S + 0.25\,E + 0.20\,A + 0.10\,P + 0.15\,C), \quad G \in \{0, 1\}
G is the must-have gate: 1 when every HR-marked deal-breaker (for example, a required certification or location) is met, else 0. G = 0 candidates are not hidden; they go to a "Needs review" list with the failed criterion shown.
Bounding the confidence signal (C)
	•	Computed from the transcript text and timing only. Pitch, accent and voice quality are not inputs.
	•	Normalized within the candidate pool for the same language, so a Hindi-first pool is not compared with an English-first one.
	•	Weight cannot exceed 15% in configuration; HR can lower it to 0.
	•	Shown with a plain-language note: "context only, not a reason to reject".
Worked example (Sales Executive, B2B SaaS; JD needs 2+ years B2B sales, CRM use, Hindi + English)
Dimension
Score
Evidence
Skill match
80
CRM (Salesforce) on resume and explained in call; cold-calling explained; no demo experience (nice-to-have)
Experience relevance
75
"3 years at an edtech, I closed about 40 school accounts a quarter"
Answer quality
70 (avg 3.8 / 5)
Clear objection-handling example; weak answer on pipeline forecasting
Soft skills
72
Ownership: "I rebuilt our follow-up script myself after losing two deals"
Communication and confidence
65
Structured answers; frequent hedging on the pricing question
Overall = 0.30×80 + 0.25×75 + 0.20×70 + 0.10×72 + 0.15×65 = 24 + 18.75 + 14 + 7.2 + 9.75 = 73.7, gate met → shortlisted if the threshold is 70.
7. System architecture
Bolna handles the phone call end to end; we own ingestion, prompts, scoring and the dashboard, joined by one completion webhook.

MVP architecture · 8 components, 1 webhook loop
Data flow
	•	Applicants land in Postgres from the gateways; resumes are parsed to JSON by an LLM call.
	•	HR approves the rubric and clicks Start screening; the scheduler builds a per-candidate prompt context (rubric + resume probes + questions).
	•	The scheduler calls Bolna's outbound call API (or /batches for bulk, with recipient_data per row) within the allowed window and concurrency.
	•	Bolna runs the call and POSTs a webhook on each status change; on completed the receiver fetches transcript, recording URL and extraction (Bolna glossary).
	•	The scoring service grades the transcript, checks each evidence quote against the transcript text, and writes scores.
	•	The dashboard subscribes to score changes (Supabase realtime) and re-ranks the shortlist live.
Hackathon stack
Layer
Choice
Why
Frontend
Next.js + Tailwind + shadcn/ui on Vercel
Fast to build, free hosting
Backend
FastAPI (Python)
LLM and parsing libraries in Python
Database, auth, storage, realtime
Supabase
One service for four needs
Queue
Postgres table + worker loop (MVP); Redis/Celery later
No extra infra on day one
LLM (parsing, scoring)
GPT-4o-class or Claude, JSON-mode output
Structured scores with quotes
Voice
Bolna agent: Deepgram ASR, LLM, ElevenLabs/Cartesia TTS
Providers named in Bolna platform concepts
Resume parsing
PDF/DOCX to text (pdfplumber, python-docx) + LLM extraction
Handles messy Indian resume formats
Data model (core tables)
Table
Key fields
jobs
id, org_id, title, jd_text, status, created_by
rubrics
id, job_id, version, must_haves[], nice_to_haves[], deal_breakers[], weights{}, questions[]
candidates
id, job_id, name, phone_e164, email, source, resume_url, resume_json, consent_at, status
calls
id, candidate_id, bolna_execution_id, attempt, status, started_at, duration_s, recording_url, transcript, cost
scores
id, candidate_id, rubric_version, gate_met, dimension scores{}, evidence[], overall, summary, red_flags[]
actions
id, candidate_id, user_id, type (shortlist, reject, override, note), old_value, new_value, at
Key endpoints
Method + path
Purpose
POST /jobs
Create job, upload JD
POST /jobs/{id}/rubric
Extract or update rubric (versioned)
POST /jobs/{id}/candidates/import
CSV/ZIP upload; also form and portal-mock ingest
POST /jobs/{id}/screen
Queue calls for selected or all candidates
POST /webhooks/bolna
Receive Bolna status events (IP-allowlisted, idempotent on execution id)
GET /jobs/{id}/shortlist
Ranked candidates with scores and summaries
GET /candidates/{id}
Detail: resume, transcript, recording URL, evidence
POST /candidates/{id}/actions
Shortlist, reject, override, note, re-call
Scaling to 1,000+ candidates
	•	Bolna's default is 10 concurrent calls on paid plans, higher on Enterprise (FAQ). At 10 concurrent and 7-minute calls, 1,000 attempts take roughly 8-12 hours including retries and call windows.
	•	Use /batches for bulk runs; note that scheduled_at must be at least two minutes ahead and is rounded up to the next 10-minute mark.
	•	Scoring is async and parallel (LLM rate limit is the only cap); target under 2 minutes after call end.
Latency and cost
	•	Voice turn latency: Bolna cites a pipeline under 600 ms; target under 1 s perceived.
	•	Cost: $0.02/min Bolna platform fee plus provider charges; we model about $0.06/min all-in (assumption) and ₹43 per completed screen (section 9).
8. Non-functional requirements
Consent and human review are product features, not legal fine print: an AI that calls people and judges them must be visibly fair to be bought. This section is not legal advice; confirm each item with counsel before a pilot.
Area
Requirement
Notes and status
India DPDP Act
Itemized notice at application (data collected, purpose, retention, how to withdraw); consent captured and logged; withdrawal deletes data
DPDP Rules notified 13 Nov 2025; notice and consent duties apply from 13 May 2027, breach notice to the Board with a 72-hour detailed update (AZB & Partners). Build to them now.
Call recording consent
AI disclosure and recording consent in the first 20 seconds; "no" ends recording and routes to a human
P0
Outbound calling rules (India)
Call only applicants who opted in on the form; respect DND, time windows and daily caps via Bolna guardrails
TRAI reserves 140-series for promotional calls and 1600-series for service calls by BFSI and government (Telangana Today). Which applies to recruiter screening calls is an open question for telecom counsel.
GDPR / US (global, P2)
Lawful basis, data-subject rights, EU AI Act high-risk duties for hiring AI; TCPA consent for US calls
Out of MVP scope
Data retention
Recordings 90 days, transcripts and scores 12 months, then auto-delete; configurable per org
Assumption; align with DPDP log-retention minimums
Security
Encryption in transit and at rest; signed URLs for recordings; webhook source-IP allowlist (Bolna publishes its IPs); role-based access; audit log of every view and override
P0: TLS, IP allowlist, signed URLs. P1: rest
Bias and fairness
Score from transcript content, not voice; confidence capped at 15%; pool-level score gaps by language/region monitored; quarterly audit against human panel
See 5f
Human in the loop
AI ranks and explains; HR makes every shortlist and reject decision; no auto-reject
Product principle, all tiers
Explainability
Every sub-score links to quotes and timestamps; rubric version stored with each score
P0
Performance
Agent reply latency under 1 s end to end; scoring within 2 min of call end; dashboard updates live
Bolna cites under 600 ms pipeline latency (platform concepts)
Reliability
Idempotent webhook handling; retries with backoff; no lost call results
P0
9. Business case
The win is speed and coverage more than cost: 1,000 applicants screened in about 12 hours of machine time instead of about 31 recruiter-days, at roughly a third of the cost. All figures below are assumptions to validate in a pilot.
Target segments (in order)
	•	High-volume Indian hiring: BPO/CX, inside sales, retail, logistics, campus and fresher programs.
	•	Startups hiring 10-50 people a quarter without a TA team.
	•	Staffing and RPO firms that screen for many clients (they resell the efficiency).
Market size (bottom-up, assumption): 5,000 Indian employers and staffing firms × 10,000 screens a year × ₹100 per screen = ₹500 crore a year serviceable market. Replace with real counts from NASSCOM/Naukri data before external use.
Unit economics: screening 1,000 applicants
Line item
Human recruiter
AI screener
Assumptions
₹6 LPA recruiter ≈ ₹300/hour; 4 screens/hour including no-answers and notes
7-min calls; all-in voice cost $0.06/min (Bolna's $0.02/min platform fee plus ASR/LLM/TTS/telephony, FAQ); ₹88/$; 60% completion
Calls / screens
1,000 attempts, 250 hours
600 completed + 400 short attempts
Direct cost
≈ ₹75,000
≈ ₹22,000 calls + ₹2,000 LLM scoring + ₹2,000 retries ≈ ₹26,000
Elapsed time
≈ 31 working days for one recruiter
≈ 12 hours at 10 concurrent calls (Bolna's default), plus 5 hours HR review of top 30
Consistency
Varies by recruiter and day
Same rubric for every candidate, with evidence
Pricing options
Model
Price (assumption)
Best for
Gross margin at ₹43/screen cost
Pay per completed screen
₹120
Startups, trials
≈ 64%
Job pack (500 screens)
₹49,000
Mid-size, campus drives
≈ 56%
Annual platform + volume
₹15 lakh/yr incl. 20,000 screens
Enterprise, staffing firms
≈ 43% (falls with volume discounts from Bolna)
Competitive landscape
Player
What it does
Our difference
Apna AI Calling Agent
Calls applicants from Apna job posts in Hindi, English and regional languages; claims 10,000+ parallel conversations and 80% connection rates
Works with applicants from any source, not one job board; resume-specific probing
Paradox
Chatbot screening and scheduling for high-volume hiring, sold with Workday
Voice-first for phone-first Indian candidates
HireVue
Video interviews and assessments for large enterprises
No video, low bandwidth, no app install; priced for startups
Hunar.AI
WhatsApp and voice agents for frontline hiring
Evidence-linked scoring and white-collar roles
Bolna customers (Awign, Hyreo)
Recruitment voice agents built on Bolna (Bolna blog)
Proof the stack works; our product layer is rubric + evidence + dashboard
Go-to-market: pilot free with 3 startups from the Bengaluru founder network and one staffing firm; publish a precision-vs-human study; then sell through Startup India and HR community channels and as an add-on for ATS vendors.
Moat over time: calibration data (HR overrides and later-round outcomes) that tunes rubrics per role family; trust from auditable, bias-monitored scoring; integrations into the employer's existing portals and ATS.
10. Hackathon MVP scope
One job, 20 seeded candidates, one live call to a judge's or teammate's phone, and a shortlist that updates on screen when the call ends.
Build (real)
Mock (looks real, fake data)
Cut (say so in the pitch)
JD upload → LLM rubric → HR edit
Job-portal feeds (LinkedIn, Naukri, Indeed) from a JSON fixture
ATS sync, SSO, multi-org
CSV upload + public apply form
19 pre-scored candidates with transcripts
Email inbox ingestion
Bolna agent with per-candidate context; one live outbound call
Bias-gap report (static chart)
Calendar booking, WhatsApp notices
Webhook → transcript → LLM scoring with quotes
Compare view (static)
Hindi-English switching tuning
Ranked shortlist + candidate detail page with audio
—
Real retry/reschedule logic
Build plan by role (team of 4, 24 hours; stretch to 48)
Hours
Frontend
Backend
AI / prompts
PM / demo
0-4
Dashboard shell, job page, upload UI
Supabase schema, auth, file storage
Rubric-extraction prompt; Bolna agent created in Studio
Sample JD, 20 candidate resumes, demo script draft
4-10
Pipeline view with statuses
CSV/form ingestion, resume parsing, Bolna call API
Per-candidate call prompt, question generation
Test calls with team members, note failures
10-16
Shortlist table, candidate detail
Webhook receiver, scoring queue
Scoring prompt with JSON output and quotes
Seed fixture data, portal mock
16-22
Transcript highlighting, audio player, live updates
Error handling, idempotency
Calibrate scores on 5 test transcripts
Pitch deck, rehearse
22-24
Polish
Freeze, deploy
Freeze prompts
Record fallback video
Demo script (5 minutes)
	•	0:00-0:40 Problem: "1,000 applicants, one recruiter, three weeks."
	•	0:40-1:30 Upload a JD live; the rubric appears; edit one must-have.
	•	1:30-2:00 Show 20 applicants already in from "Naukri" and "LinkedIn" (mock) and the CSV.
	•	2:00-3:30 Click Start screening on one candidate: a teammate's phone rings on stage; the room hears 2-3 questions on speaker, including one about a project on their resume.
	•	3:30-4:30 Call ends; the candidate appears in the ranked shortlist; open the detail page, click a quote and the audio jumps to it.
	•	4:30-5:00 Business case in one slide and the ask.
Fallback if the live call fails: switch to a pre-recorded call video at step 4 and trigger the webhook from a saved payload, so the shortlist still updates live. Rehearse the switch once.
11. Risks, assumptions and open questions
The biggest risks are fairness and candidate trust, not technology: the stack exists, but a biased or creepy call kills adoption.
Risk
Likelihood
Impact
Mitigation
Accent or language bias in scores
High
High
Transcript-only scoring, 15% cap on confidence, pool-level gap monitoring, human review (5f)
Candidates hang up on an AI caller
Medium
High
Pre-call SMS with company name and slot link; disclosure up front; human callback option
ASR errors on Hinglish or noisy lines distort scores
Medium
Medium
Test Bolna ASR options on day one; flag low-confidence transcripts for human review
LLM scoring drifts or hallucinates evidence
Medium
High
Quotes must match transcript text exactly (string check); rubric and prompt versioned; calibration set
Outbound calls classed as promotional under TRAI rules
Medium
High
Opt-in consent at application; counsel review on number series before pilot
Live demo call fails (network, venue)
Medium
High
Pre-recorded fallback and saved webhook payload
Portals block data access
High
Medium
Start with CSV, form and email-forward; partner APIs later
Candidates game the questions
Low
Medium
Questions generated per resume; follow-up "why" probes
Assumptions
	•	Recruiters screen about 4 candidates an hour including no-answers.
	•	All-in voice cost is about $0.06 a minute; calls average 7 minutes.
	•	60% of applicants complete a call within 3 attempts.
	•	HR accepts AI ranking as long as it can see the evidence.
Open questions
	•	Which TRAI number series applies to recruiter screening calls?
	•	Does Bolna's ASR handle Hinglish code-switching well enough for scoring?
	•	What does Bolna's webhook payload contain at completed (exact schema)?
	•	Should candidates see their own score or summary?
	•	Who owns the candidate data: the employer, us, or both?
12. Roadmap beyond the hackathon

Post-hackathon roadmap · 3 phases, 2 gates
Each phase starts only when its gate is met: no paid rollout until AI shortlists agree with HR at least 70% of the time on pilot data.
13. Appendix
Demo-ready samples the team can copy as-is.
A. Sample JD (excerpt)
Sales Executive - B2B SaaS (Bengaluru, hybrid) Must have: 2+ years B2B or inside sales; CRM use (Salesforce/HubSpot/Zoho); fluent English and Hindi Nice to have: SaaS product demos; edtech or SMB customers Deal-breakers: can join within 30 days; based in or willing to move to Bengaluru
B. Sample resume (parsed fields)
{   "name": "Priya Sharma",   "phone": "+91XXXXXXXXXX",   "experience": [     {"company": "LearnFast Edtech", "role": "Inside Sales Associate", "years": 3,      "highlights": ["Closed school accounts", "Salesforce pipeline owner"]}   ],   "skills": ["Salesforce", "cold calling", "objection handling"],   "languages": ["English", "Hindi"],   "notice_period_days": 30,   "location": "Bengaluru" }
C. Voice-agent system prompt (template)
You are Asha, an AI screening assistant calling on behalf of {company} about the {role} role {candidate_name} applied for. Rules: - In your first sentence, say you are an AI assistant and the call is recorded for hiring review. Ask for consent. If they decline, thank them, say a recruiter will reach out, and end the call. - Confirm you are speaking with {candidate_name}. Offer to call back later if now is a bad time. - Speak in {language}; switch to Hindi or English if the candidate does. - Ask these questions one at a time, with at most one follow-up each: {questions} - Ask about the resume item: {resume_probe} - Never give feedback on performance, salary promises, or hiring decisions. - If an answer is off-topic, redirect once, then move on. - Keep the call under 8 minutes. End by inviting questions and saying the team will reply within {sla}.
Generated question set (for the sample candidate)
	•	Walk me through how you handled a typical school account from first call to close.
	•	Your resume says you owned the Salesforce pipeline. How did you decide which deals to focus on each week?
	•	Tell me about a deal you lost. What did you change afterwards?
	•	A customer says "your price is too high". What do you say?
	•	Why B2B SaaS, and why this role now?
	•	Can you join within 30 days and work from Bengaluru? (deal-breaker check)
D. Evaluation output (scoring service)
{   "candidate_id": "c_0142",   "rubric_version": "job_17_v2",   "gate": {"met": true, "failed": []},   "scores": {     "skill_match": {"value": 80, "evidence": [{"quote": "I used Salesforce every day to track renewals", "t": "01:42"}]},     "experience": {"value": 75, "evidence": [{"quote": "I closed about 40 school accounts a quarter", "t": "00:58"}]},     "answer_quality": {"value": 70, "per_question": [4, 4, 4, 4, 3, 4]},     "soft_skills": {"value": 72, "ownership": 4, "problem_solving": 3, "adaptability": 4, "motivation": 3},     "communication": {"value": 65, "features": {"hedges_per_min": 1.8, "filler_rate": 0.04, "median_latency_s": 1.2}, "note": "context only"}   },   "overall": 73.7,   "summary": "3 yrs edtech inside sales, strong CRM and objection handling; weaker on forecasting.",   "red_flags": [],   "recommendation": "shortlist" }
E. Dashboard wireframes
Screen
Layout
Key elements
Jobs
Card grid
Job title, applicants, screened, shortlisted counts; "New job" button
Job setup
Two columns
Left: JD upload and text. Right: extracted rubric with editable chips (must-have / nice-to-have / deal-breaker), weight sliders, language and question count
Pipeline
Kanban by status
Columns Imported → Queued → Called → Completed → Shortlisted / Rejected; source badges (CSV, Form, Naukri…); Start screening button
Shortlist
Ranked table
Rank, name, overall, skill %, experience, communication, summary, source; filters on the left; bulk shortlist / export
Candidate detail
Header + two panes
Header: name, overall score, actions. Left: score breakdown with quotes, soft-skill radar, red flags. Right: audio player above transcript with keywords highlighted; clicking a quote seeks the audio
Compare
2-3 columns
Same rows per candidate: scores, summary, best quote, red flags, play clip
F. 60-second spoken pitch
Every open role in India gets a thousand applications, and a recruiter can phone maybe thirty a day. So most candidates never get a real hearing, and the good ones get hired elsewhere while they wait. We built an AI voice screener on Bolna. HR uploads a job description, applicants flow in from portals, forms and spreadsheets, and our agent calls every one of them in Hindi or English. It doesn't read a script: it asks about the projects on that person's own resume. Within minutes of each call, HR sees a ranked shortlist, and every score links to the exact words the candidate said. We score what candidates say, not how they sound, and HR makes every decision. A thousand screens takes about twelve hours instead of a month, at around forty rupees each. You just heard it call a phone on this stage. We're asking for a pilot with three hiring teams to prove it matches their best recruiters.
Sources
	•	Bolna docs: glossary
	•	Bolna docs: platform concepts
	•	Bolna docs: FAQ (pricing, concurrency, telephony)
	•	Bolna blog: voice AI for recruitment (vendor-reported customer figures)
	•	Entrackr: Apna launches AI calling agent
	•	Metaview: Paradox alternatives and competitors
	•	EurekAlert: UW study on accent bias in AI speech ratings
	•	Axios: AI can't hear everyone equally
	•	AZB & Partners: DPDP framework comes into effect
	•	Telangana Today: TRAI clarifies 1600 and 140 number series
	•	Let's Data Science: Hunar.AI voice agents for frontline hiring (search result, not opened)
