Voice AI Candidate Screening with Bolna: System PRD
Nov 15, 2026 · @Tushar Gupta
Assumptions (stated up front)
No inputs were given for role, language, volume or budget, so this PRD assumes the values below. Change any of them and the scope still holds.
Input
Assumption
Why
Role type
Software engineer (SDE-2), Bengaluru, hybrid
Resumes are keyword-rich, so skill matching is testable in a demo
Call languages
English and Hinglish
Matches the dominant spoken mix in Indian tech hiring
Volume per role
1,000 applicants, about 400 reach the call stage after a resume pre-filter
A pre-filter cuts cost; calling all 1,000 is a P2 option
Call length
6 to 8 minutes per candidate
Long enough for 6 core questions plus 2 probes
Hackathon team
3 people: 1 backend, 1 voice and prompt, 1 frontend and demo
Fits the 24 to 48 hour window
Budget
Under INR 15,000 for the hackathon (assumption)
Covers Bolna credits and LLM calls for about 100 test calls
Bolna capabilities
Outbound calls via API, custom prompts, transcript webhook (to verify in Bolna docs)
Architecture depends on these; confirm before building
All figures in this document are assumptions unless marked otherwise.
1. Executive summary
We recommend building a voice-AI screening agent on Bolna that replaces the first HR phone call.
	•	HR uploads one job description and a batch of resumes.
	•	The agent calls each candidate, asks role-specific questions built from the JD and their resume, and records the conversation.
	•	Each call is scored on skill match, depth of experience and communication confidence, with a written reason for every score.
	•	HR gets a ranked shortlist with transcripts and can override any decision.
	•	The hackathon MVP proves one thing: a ranked shortlist from live calls, in minutes, without a recruiter dialling.
One-sentence pitch: We turn 1,000 applications into a ranked, explainable shortlist overnight by letting a voice AI do the first screening call that recruiters do by hand today.
2. Problem statement and evidence
First-round phone screening does not scale: a recruiter can only make so many calls a day, so strong candidates wait or get dropped unseen. The figures below are working assumptions to validate, not sourced facts.
Pain point
Working assumption
How to validate
Time per screening call
10 to 15 minutes including scheduling and notes
Time 10 recruiter calls at a design partner
Recruiter capacity
25 to 35 screening calls per day
Ask 5 recruiters for their real daily count
Time to clear 400 calls
2 to 3 recruiter-weeks
Compute from the two rows above
Inconsistency
Two recruiters rate the same candidate differently
Have 2 recruiters score the same 10 recorded calls
Candidate drop-off
Slow response loses good candidates
Compare offer-acceptance by days-to-first-contact
Validation plan: interview 5 HR leads at startups and 2 at corporates in the first week, and run a blind test where the agent and a recruiter screen the same 30 candidates, then compare shortlists.
3. Target users and personas
The recruiter is the buyer and daily user; the hiring manager and candidate decide whether it works.
Persona
Goal
Fear
What the product must do
HR recruiter (Priya, 6 years, startup)
Fill the role fast without calling 400 people
Wrong rejections and losing control
Ranked list with reasons, call audio, one-click override
Hiring manager (Rahul, engineering lead)
Interview only people who can do the job
Wasting time on weak shortlists
Short per-candidate summary tied to must-have skills
Candidate (Ankit, 3 years experience)
A fair, convenient first round
Talking to a bot that misjudges accent or nerves
Clear disclosure, a chosen time slot, a fair rubric, a human fallback
Personas are illustrative and should be replaced with interview findings.
4. Goals, non-goals and success metrics
North star: hours of recruiter screening time saved per role, at equal or better shortlist quality.
Goals
	•	Screen 400 candidates by phone in under 24 hours.
	•	Give every score a reason HR can read and challenge.
	•	Keep a human in charge of every reject and every advance.
Non-goals for the MVP
	•	Making final hiring decisions or auto-rejecting without HR review.
	•	Video interviews, coding tests or personality profiling.
	•	Integrations with a full applicant tracking system (ATS).
Metric
Target (assumption)
Measured by
Screening cost per candidate
Under INR 50, versus about INR 85 to 125 for recruiter time
Bolna minutes plus LLM cost, divided by calls
Time to shortlist
Under 24 hours for 400 candidates
Upload time to ranked list
Shortlist precision vs. recruiter
At least 80% overlap on the top 20
Blind comparison on 30 candidates
Call completion rate
At least 60% of dialled candidates finish
Webhook call status
Candidate drop-off mid-call
Under 15%
Calls ended before question 4
5. User journey and end-to-end flow
The flow has seven steps; steps 4 and 5 are fully automated, and steps 1 and 6 are where HR stays in control.
[1 HR]        Upload JD + resume batch, pick call window     | [2 System]    Parse JD and resumes -> extract skills, experience, gaps     | [3 System]    Build per-candidate script: JD must-haves + resume probes     | [4 Bolna]     Call candidate     |-- no answer --> retry (max 3) --> SMS/WhatsApp link     |-- declines consent --> mark opted out, stop     v               Intro + consent -> core questions -> resume probes -> close     | [5 System]    Webhook: transcript + audio -> LLM scoring -> rank     | [6 HR]        Review ranked list, listen to calls, override     | [7 HR]        Advance to interview / reject / hold
Candidate view: receives an SMS with the role, the company and a time window; takes a 6 to 8 minute call that starts with a disclosure that it is an AI assistant and the call is recorded; can ask for a human callback at any point.
6. MVP scope
Decision: build one thin path end to end (upload, call, score, rank, review) and cut everything that cannot be shown live in a 3-minute demo.
Priority
Feature
Rationale
P0
Upload JD (text) and resumes (PDF or text)
Entry point of the demo
P0
LLM resume and JD parsing into skills and experience
Drives the question script
P0
Bolna outbound call with dynamic per-candidate prompt
The core value
P0
Consent disclosure at start of call
Legal and trust requirement
P0
Post-call webhook, transcript capture
Input to scoring
P0
Scoring on skills, experience, confidence, with reasons
The shortlist logic
P0
Ranked dashboard with transcript, audio and override
HR control
P1
Retry and no-answer handling, SMS link
Raises completion rate
P1
Hinglish support
Real-world fit
P1
Export shortlist to CSV
Simple handoff
P2
ATS integration, calendar scheduling
Needs partner access
P2
Voice-signal tone analysis (pitch, pace)
Hard to validate quickly
P2
Multi-role, multi-tenant, billing
Post-hackathon
Cut for the hackathon: ATS and calendar integrations, voice-signal tone analysis (confidence is inferred from transcript signals in the MVP), authentication and billing, and calling more than about 20 real candidates live.
7. Functional requirements
ID
User story
Acceptance criteria
F1
As a recruiter, I upload a JD and resumes so the system can screen them
Accepts text JD and PDF or text resumes; shows parsed skills per candidate within 30 seconds each; flags unreadable files
F2
As a recruiter, I review the generated call script before dialling
Shows 6 core questions and up to 2 resume probes per candidate; allows edits to the shared JD questions
F3
As a recruiter, I start a batch of calls in a chosen time window
Calls only inside the window; respects a 3-attempt retry limit; shows live status per candidate
F4
As a candidate, I am told it is an AI call that is recorded and can decline
Disclosure plays in the first 15 seconds; a spoken refusal ends the call and marks the candidate opted out
F5
As a candidate, I can ask for a human instead
Phrase detection ends the call politely and flags the candidate for HR callback
F6
As the system, I capture the transcript and audio after each call
Webhook stores transcript, audio link, duration and status within 60 seconds of call end
F7
As a recruiter, I see a ranked list with score reasons
Each candidate shows total score, three sub-scores and 2 to 3 evidence quotes from the transcript
F8
As a recruiter, I override a decision
Can set advance, hold or reject with a note; override is logged and never lost when scores recompute
F9
As a recruiter, I export the shortlist
CSV with name, contact, scores and decision
8. Scoring and shortlisting logic
Decision: a weighted 0 to 100 score from three sub-scores, computed by an LLM against a fixed rubric, with evidence quotes. Scores rank candidates; they never auto-reject.
Dimension
Weight
What the LLM checks
Skill and keyword match
40%
Share of JD must-have skills the candidate actually demonstrates in answers, not just names
Depth and relevance of experience
40%
Specific projects, scale, ownership and trade-offs; consistency with the resume
Communication confidence and clarity
20%
Direct answers, structure, little hedging, relevant examples
Weights are a starting assumption; HR can change them per role.
How confidence is inferred (MVP): from transcript signals only, because they are easier to explain and audit.
	•	Directness: answers the question asked, within a reasonable length.
	•	Hedging language: counts of phrases such as "I think maybe" against concrete statements.
	•	Specificity: names tools, numbers and outcomes.
	•	Recovery: handles a follow-up probe without freezing or contradicting the resume.
Voice signals (pace, pauses, pitch) are a P2 add-on. They are noisier, vary by accent and nerves, and are harder to defend as fair.
Shortlist rule: top 20% by score are "shortlist", the next 30% are "maybe", the rest "reject suggested"; any candidate with a must-have skill clearly missing is capped at "maybe".
Bias controls
	•	Score content, not accent, gender, age, name or voice quality; the scoring prompt receives the transcript text only, without candidate name or demographics.
	•	Confidence is capped at 20% so it cannot outweigh skills.
	•	Calls that ended early or had poor audio are flagged "needs human review", not scored low.
	•	Every score shows evidence quotes; HR can override, and overrides feed the audit log.
	•	Audit monthly: compare score distributions across language mix and call quality.
9. System architecture (for the Tech Lead)
Decision: a small web app plus one backend service, with Bolna handling telephony, speech-to-text and text-to-speech, and a general LLM handling parsing and scoring. We build only the glue and the scoring.
flowchart LR   HR[Recruiter dashboard<br/>Next.js] -->|upload JD + resumes| API[Backend API<br/>FastAPI]   API --> PARSE[Parsing service<br/>LLM extraction]   PARSE --> DB[(Postgres)]   API -->|create agent + start call| BOLNA[Bolna voice agent<br/>telephony, STT, TTS]   BOLNA -->|PSTN call| CAND[Candidate phone]   BOLNA -->|webhook: transcript, audio, status| API   API --> SCORE[Scoring service<br/>LLM + rubric]   SCORE --> DB   DB --> HR
Recommended stack (assumption, adjust to team skills)
Layer
Choice
Reason
Frontend
Next.js with a simple table view
Fast to build, easy to demo
Backend
Python FastAPI
Good LLM and PDF libraries
Database
Postgres (or SQLite for the demo)
Simple relational data
Voice
Bolna outbound agent
Given constraint of the idea
LLM
Any strong hosted LLM via API
Parsing, question generation and scoring
Hosting
A single cloud VM or serverless, with a public URL for webhooks
Bolna must reach the webhook
Data model
Table
Key fields
jobs
id, title, jd_text, must_have_skills, weights
candidates
id, job_id, name, phone, resume_text, parsed_skills, consent_status
calls
id, candidate_id, bolna_call_id, status, attempts, duration, audio_url, transcript
scores
id, call_id, skill, experience, confidence, total, reasons, evidence_quotes
decisions
id, candidate_id, decision, note, decided_by, decided_at
Key interfaces (names are illustrative; confirm against Bolna docs)
Endpoint
Purpose
POST /jobs
Create a job from the JD
POST /jobs/{id}/candidates
Upload resumes, parse them
POST /jobs/{id}/calls/start
Generate scripts and trigger Bolna calls
POST /webhooks/bolna
Receive call result, store transcript, trigger scoring
GET /jobs/{id}/ranking
Ranked list with reasons
PATCH /candidates/{id}/decision
HR override
Latency and cost estimates (assumptions to verify)
	•	Voice turn latency target: under 1.5 seconds between candidate stopping and agent speaking; this is mostly a Bolna and LLM setting, so test early.
	•	Scoring runs after the call, so it can take 20 to 40 seconds with no user impact.
	•	Cost per 7-minute call: roughly INR 30 to 60 all-in (telephony, speech, voice LLM, scoring); verify against current Bolna and LLM pricing before quoting externally.
10. Responsible AI, privacy and compliance
Decision: ship with consent, disclosure and human review as non-negotiable defaults. This section is product guidance, not legal advice; have counsel confirm before any real candidate is called.
Area
Requirement
Mitigation in the MVP
Consent and disclosure
Candidate must know it is an AI and that the call is recorded
Opening script states both, then asks for a clear yes; a no ends the call
Pre-call permission
Calling people needs their agreement and must respect do-not-disturb rules
Only call applicants who applied and gave a phone number; call inside permitted hours; verify current TRAI telemarketing and consent rules
Personal data (India)
The Digital Personal Data Protection (DPDP) Act 2023 expects purpose-limited use, notice, consent and deletion rights
Store the minimum; show a purpose notice; support delete on request; set a retention period such as 90 days
Personal data (global)
GDPR in the EU and similar laws elsewhere require lawful basis and rights over automated decisions
Human decides every outcome; scores are explained and contestable
PII handling
Resumes and audio are sensitive
Encrypt at rest, restrict access by role, redact phone numbers in logs, send only needed text to the LLM
Fairness: accent and speech
Speech recognition can err more on some accents and speech patterns
Test on a mix of accents; flag low-confidence transcripts for human review instead of scoring them low
Fairness: gender and name
Names and voice can leak identity
Scoring prompt receives text with no name; periodic parity checks
Fairness: nerves and disfluency
Hesitation is not lack of skill
Cap confidence at 20% of score; never reject on tone alone
Accessibility
Some candidates cannot do a phone call
Offer a written or human-callback alternative
Automated hiring tools face growing regulation in several regions, so treat the human-in-the-loop design as a requirement, not a feature.
11. Risks, dependencies and open questions
Risk
Likelihood
Impact
Owner
Mitigation
Voice latency makes the call feel robotic
Medium
High
Voice lead
Tune Bolna settings on day 1; keep questions short; test on real phones
Candidates hang up or distrust a bot
Medium
High
PM
Clear disclosure, short call, SMS pre-notice, human callback option
Speech recognition errors on Hinglish or accents
High
High
Voice lead
Test early; fall back to English; flag low-confidence calls
LLM scoring is inconsistent between runs
Medium
Medium
Backend
Fixed rubric, temperature 0, evidence quotes, re-score check on 10 calls
Scoring bias against some groups
Medium
High
PM and Tech Lead
Text-only scoring, parity checks, human override
Calling rules or consent violations
Low
High
PM
Call only applicants with consent; counsel review before pilot
Webhook or telephony failure during demo
Medium
High
Backend
Record a backup demo call; keep a pre-scored sample batch
Cost overrun from long calls
Low
Medium
Backend
Hard cap on call length at 10 minutes
Dependencies: Bolna account with outbound calling enabled and credits; a public webhook URL; a hosted LLM API key; 5 to 10 consenting volunteers to receive test calls.
Open questions
	•	Does Bolna provide per-turn latency controls, Hinglish voices and call recording URLs in the plan we have?
	•	Which phone numbers can we dial in the demo, and do we need a verified caller ID?
	•	What retention period will design partners accept for audio?
	•	Should the pilot screen all applicants or only those passing a resume filter?
12. Business case (for the Business Lead)
Decision: start with tech-hiring startups and mid-size firms in India that screen 200 to 1,000 applicants per role, price per completed screen, and use the pilot to prove cost and quality before widening.
Market size (bottom-up, all inputs are assumptions to validate)
Layer
Definition
Estimate
TAM
50,000 Indian companies hiring at volume x INR 3,00,000 per year screening spend
INR 1,500 crore
SAM
10,000 tech-led startups and mid-size firms x INR 2,00,000 per year
INR 200 crore
SOM (year 1)
100 paying customers x INR 2,00,000 per year
INR 2 crore
Competitive landscape
Alternative
Strength
Gap we exploit
In-house recruiters
Judgement and context
Cost, speed, inconsistency at volume
Recruitment agencies
Sourcing reach
Slow, per-hire fees
Resume-screening and ATS tools
Cheap, fast keyword filtering
No conversation; resumes overstate skills
Video-interview and assessment platforms
Structured evaluation
Candidate effort; scheduling friction
Other AI voice screeners
Similar idea
Differentiate on explainable scores, resume-aware probing and HR control
Competitor names are not listed because they were not researched for this draft; add a sourced comparison before the pitch.
Differentiation: resume-aware questions (not a generic script), explainable evidence-based scores, human override by default, and Indian-language call support.
Pricing model (assumption): INR 60 to 100 per completed screen, or a monthly plan with 500 screens included. At the midpoints (INR 80 price, INR 45 cost) that is about a 44% gross margin; it is thin at the low end, so the pilot must measure real cost per call.
Unit economics versus a recruiter (assumption): a recruiter at about INR 10 lakh a year fully loaded costs about INR 500 an hour, so a 10 to 15 minute screen is about INR 85 to 125. The agent cost of INR 30 to 60 plus a margin undercuts this and removes scheduling and notes time. The real saving is calendar time: 400 calls in a night, not three weeks.
Go-to-market: pilot-led, selling to HR heads and founders through the hackathon demo, startup founder communities and LinkedIn. Offer 50 free screens per pilot in exchange for a blind comparison against their recruiter.
First three design partners (targets to approach): a funded startup hiring 5 or more engineers in the next quarter; an IT services or staffing firm with high-volume fresher hiring; a mid-size product company with a lean HR team.
13. Hackathon execution plan
Decision: a 24-hour plan with three owners and one rule: the call, webhook and scoring path works end to end by hour 14, and everything after that is polish and demo rehearsal.
Team roles (assumption: 3 people)
Role
Owns
Voice and prompt lead
Bolna agent setup, call script prompt, latency tuning, test calls
Backend lead
API, parsing, webhook, scoring service, database
Frontend and demo lead
Dashboard, ranked list, transcript view, demo script and backup recording
Build plan
Hours
Milestone
0 to 2
Lock scope, create Bolna account and agent, set up repo and hosting, agree on data model
2 to 6
Backend: parse JD and resumes. Voice: first test call to a teammate with a hard-coded script
6 to 10
Dynamic per-candidate script into Bolna; consent disclosure; webhook stores transcript
10 to 14
Scoring service with rubric and evidence quotes; ranking endpoint; first end-to-end run
14 to 18
Dashboard with ranked list, transcript, override; run 10 real test calls
18 to 21
Fix the top 3 failures: latency, transcript errors, scoring consistency
21 to 24
Pre-score a sample batch, record a backup demo call, rehearse the pitch twice
Build for real: outbound call, consent, webhook, scoring, ranked dashboard, override. Mock for the demo: retry and SMS flow, ATS and calendar steps, large batch (pre-loaded sample of 50 scored candidates), CSV export.
3-minute demo script
	•	0:00 to 0:30. Problem: 1,000 applications, one recruiter, three weeks of calls.
	•	0:30 to 1:00. Upload a JD and 5 resumes; show the generated, resume-aware questions.
	•	1:00 to 2:00. Place a live call to a volunteer's phone; judges hear the disclosure and one resume-specific probe.
	•	2:00 to 2:40. Show the ranked dashboard of 50 pre-scored candidates with reasons and evidence quotes; override one decision.
	•	2:40 to 3:00. Cost and speed: cost per candidate versus a recruiter, and the ask for pilot partners.
14. Roadmap beyond the MVP
Window
Focus
Exit gate to move on
Days 0 to 30
Harden MVP for 2 design partners: retries and SMS, Hinglish, CSV export, audit log, consent review with counsel
200 real calls completed; no consent complaints
Days 31 to 60
Blind comparison against recruiters; tune rubric weights per role; ATS and calendar integration for one system; role templates
At least 80% top-20 overlap with recruiters; recruiter time saved above 60%
Days 61 to 90
Multi-tenant accounts, billing, analytics, fairness dashboard; optional voice-signal analysis behind a flag; first paid pilots
3 paying customers; cost per call within pricing assumptions
15. Decisions needed from each lead
Technical Lead
	•	Approve Bolna as the voice layer and the FastAPI plus Next.js stack, or name a replacement by hour 2.
	•	Confirm scoring is text-only for the MVP, with voice-signal analysis deferred to P2.
	•	Set the latency bar: a voice turn under 1.5 seconds, tested by hour 10, or we cut Hinglish.
	•	Choose the LLM provider and approve sending transcripts to it, given the data-handling rules above.
Business Lead
	•	Approve the first target segment: tech-hiring startups and mid-size firms in India.
	•	Approve the pricing hypothesis of INR 60 to 100 per completed screen for pilots.
	•	Name 3 design-partner targets and own the outreach after the demo.
	•	Decide whether the pilot offer is 50 free screens in exchange for a blind comparison against their recruiters.
	•	Fund a short legal review of calling and data-protection rules before any real candidate is called.
16. Pitch summary (read aloud, about 2 minutes)
Picture a recruiter with a thousand applications and a job that has to be filled this quarter. Today the first step is a phone call to every promising candidate. It is slow, it is expensive, and two recruiters will score the same person differently. Good candidates wait, and some are lost.
We built a voice assistant on Bolna that makes that first call. HR uploads a job description and a batch of resumes. For each candidate the system writes questions from the role's must-have skills and from that person's own resume. Then it calls, tells the candidate it is an AI and that the call is recorded, and has a short, structured conversation.
After each call we score three things: how well the answers match the skills the role needs, how deep and relevant the experience is, and how clearly and confidently the candidate communicates. Skills and experience carry eighty percent of the weight. Every score comes with the evidence quotes behind it, and HR sees a ranked shortlist with transcripts and audio. A human makes every final decision and can override any score.
For the Technical Lead: this is a thin, buildable stack. Bolna handles telephony and speech, our backend handles parsing, webhooks and scoring, and the full path works end to end in a 24-hour build.
For the Business Lead: we assume a screening call costs us about fifty rupees and a recruiter about a hundred, and we price per completed screen. The bigger win is time: four hundred calls overnight instead of three weeks. We assume a market of two hundred crore rupees in the segment we can reach, and we will prove it with three design partners.
Our ask today is simple: approve the stack and the segment, and name the first three partners. We will show you a live call in the demo.
