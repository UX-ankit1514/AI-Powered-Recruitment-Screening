# PRD: Voice AI that talks to every applicant

**Working name:** Hirefy (placeholder) · **Version:** 4 (final for build) · **Date:** 2026-11-15
**Built from:** Shubh's raw thoughts (`raw-thoughts.md`) + Tushar's two PRDs (`prd-voice-ai-screening-bolna.md`, `prd-tushar-v2-hackathon-mvp.md`).
**Order of authority:** Shubh's latest decisions (made after comparing both PRDs) override everything, including his own earlier raw thoughts and both of Tushar's PRDs. Tushar's PRDs have *not* been updated, so where they disagree with this document, this document wins. See section 0. Items marked *(proposal)* are suggested defaults that the team hasn't confirmed yet.

---

## 0. Where this overrides Tushar's PRDs

| Topic | Tushar's PRDs say | This PRD (Shubh's decision) |
|---|---|---|
| Talking to a human | Candidate can ask for a human anytime; refusing recording routes to a human | **Not allowed.** The candidate speaks only with the AI. No human callback is offered or promised |
| Call length | 6–8 minutes, hard cap 8–10 | **Early exit in 2–3 minutes** for clearly weak candidates; **up to 10 minutes** for promising ones |
| What's scored | Skills, experience, answer quality, soft skills, confidence | Skills, experience, confidence **and culture fit**, with weights each company shapes |
| Hidden fits | Not covered | **Flags for other role, culture standout, internship interest** |
| Result | Score + shortlist threshold | **No / Maybe / Good / Amazing** + flags |
| Feel of the call | 5–8 questions read by "Asha" | **Warm, story-led conversation** |
| Cost | ₹43 per screen | **~₹85 full call, ~₹25 short exit** (phone line and Bolna fee included) |

---

## 1. Summary

A company gets 1,000 applicants. Today a resume filter keeps ~100 and the rest are never heard. We give **every applicant a warm phone call** with a voice AI built on Bolna: up to 10 minutes for promising candidates, ended politely in 2–3 minutes for clearly weak ones. The AI hears each person's story, scores them on a rubric the company sets, and gives a pick: **No / Maybe / Good / Amazing**. It also flags people who are wrong for this job but **right for another role, a strong culture fit, or looking for an internship.**

**One-line pitch:** Resumes decide who gets a conversation today. We give everyone the conversation, so the good people with bad resumes stop getting lost.

## 2. Problem

- A resume filter drops ~90% of applicants without speaking to them. Some are strong candidates who write weak resumes.
- Recruiters can't phone 1,000 people. At 25–35 calls a day, even 400 calls take 2–3 recruiter-weeks *(Tushar's working assumption, to validate)*.
- Rejected applicants who'd suit another role or an internship are lost, not kept.

## 3. What makes us different

Compared with HeyMilo, Hyring, Apna's AI calling agent, Hunar.AI, Paradox and HireVue (based on public pages; to be confirmed with demos). Bolna's own customers (Awign, Hyreo) also build recruitment voice agents, so the voice call itself is not new.

| | Others | Us |
|---|---|---|
| Who gets a conversation | HeyMilo / Hyring: resume screen first. Apna: calls applicants, but only from its own job board | **Everyone, from any source.** The conversation is the filter, not the resume |
| What they judge against | The job applied for | The job applied for **plus other open roles, culture fit and internship interest** |
| Feel of the call | Interview / assessment, anti-cheat proctoring | **Warm, story-led conversation** |
| Rubric | Mostly skills, set by recruiter | **Changes with each company's culture** (experts vs learners vs curious types) |

Not differentiators (don't pitch as new): Indian languages, rescheduling, time limits on calls, calling applicants by AI.
**Our sharpest edge:** finding the hidden fits (other role, culture, internship) and a rubric that bends to each company's culture.

## 4. Users

| User | Wants | Needs from us |
|---|---|---|
| **Recruiter / HR** | Fill the role without phoning 1,000 people; not miss good people | Every applicant called; a sorted list with reasons; ability to change any pick |
| **Hiring manager** | Interview only people worth meeting | A short story + scores per candidate, tied to what the role needs |
| **Candidate** | A fair, pleasant first round, even with a weak resume | Clear opening, a warm chat, ability to pick a better time |

## 5. Goals, non-goals, anti-goals

**Goals**
- Every applicant gets a call, not just the top of the resume pile.
- Every pick comes with reasons and quotes from the call that HR can read and challenge.
- Surface "hidden" candidates: other-role fit, culture fit, internship interest.

**Non-goals (for the hackathon)**
- Making the final hiring decision. HR always has the last word.
- Video, coding tests, personality tests, anti-cheat proctoring.
- Full integration with a hiring platform (ATS). We use a spreadsheet upload instead.

**Anti-goals (it fails if this happens, even if it technically works)**
- The call feels like a cold, robotic interrogation.
- Calls drag past 10 minutes because the AI can't steer.
- Good candidates get cut at 3 minutes because they were nervous or have an accent.
- Candidates are judged on accent, nerves or voice instead of what they say.
- The AI invents answers about pay, offers or timelines. It answers only from the company FAQ set in job setup.

## 6. The call

### Two paths: short exit or full call

The first 2–3 minutes decide which path a call takes.

| Part | Time | What happens |
|---|---|---|
| Opening | 0:30 | **Confirms it's speaking to [candidate name].** Says it's about their application for [role] at [company], wants ~10 minutes, asks if now is good. (Recording is not mentioned on the call; consent is taken at application.) If it's the wrong person, apologises and ends the call. |
| Reschedule branch | — | If now isn't good, the AI offers times and books one. Call ends. |
| Warm-up | ~2 min | "Tell me a bit about yourself and what you're looking for." One must-have check if the company set one. |
| **Checkpoint (~3 min)** | — | **Short exit** if clearly not a fit (below). Otherwise, carry on. |
| Their story + role questions | 4–5 min | Deeper story, questions from the JD and rubric, 1–2 questions about their own resume. |
| Beyond this role | ~1 min | What else they enjoy or want to learn; open to other roles or an internship? |
| Their questions + close | ~1 min | Answers basic questions, explains next steps, thanks them. **Hard stop at 10 minutes.** |

**Short exit (2–3 minutes)** happens only on clear signals:
- They can't hold a basic conversation (can't follow or answer simple questions), even after the AI slows down or rephrases once.
- They clearly fail a company "must have" (e.g. won't relocate, can't join in time).
- Answers show no relevant experience or interest at all.

**Never a reason for a short exit:** accent, nerves, hesitation, a weak resume, or a short first answer. *(These would undo the point of the product.)*

The short exit is warm: *"Thank you so much for your time, that's really helpful. The team will get back to you on next steps."* No sign the call was cut short. Short-exit candidates are still scored on what was said, and the "Wants an internship" / "Fits another role" flags still apply.

### Rules
- **Phone call only.** No video, no Google Meet.
- **Tone:** warm and conversational, never prickly. The AI is there to understand, not to judge.
- **Upfront opening:** says plainly what the call is about in the first few seconds.
- **Rescheduling:** the candidate can move the call to a better time, booked by the AI on the call.
- **No "talk to a human" option.** Candidates speak with the AI only. *(Shubh's decision; overrides Tushar's PRDs)*
  - The AI never offers or promises a human callback.
  - If a candidate asks for a human, the AI warmly explains that this first conversation is with the AI and carries on: *"I understand. This first chat is with me, and it only takes a few minutes. Your answers go straight to the hiring team."*
  - If they still don't want to talk, the AI offers to reschedule. If they decline that too, it thanks them and ends the call. The candidate is marked "declined call", with no human follow-up.
- **Time-boxing:** if an answer runs long, the AI politely cuts in: *"Thank you so much. Anything else you'd like me to know in the next 20 seconds, and then we'll move on?"* Or it asks a focused follow-up. Off-topic answers are redirected once, then the AI moves on. Hard stop at 10 minutes.
- **Is it an AI?** The AI doesn't announce it, but whenever the candidate asks, it answers honestly: *"Yes, I'm an AI assistant helping the hiring team."*
- **Recording:** not mentioned on the call. Consent and the data notice are taken on the apply form (and confirmed by the employer for spreadsheet uploads). Indian law expects notice and consent for processing personal data, but doesn't require asking again on the call.
- **Languages:** English and Hinglish only (no pure Hindi). The AI follows the candidate's mix.
- **Voice quality bar:** should feel as natural as Wavelength. Test on real Indian phone lines early.

## 7. Scoring: a rubric each company shapes

Every call is scored on four core qualities. **Every job starts from one standard rubric, which the company edits to its needs:** change weights, add its own traits, mark must-haves. No single idea of a "good candidate" is baked in.

### Core qualities
- **Skills:** does the candidate actually show the skills the role needs (not just name them)?
- **Experience:** specific projects, ownership, depth, matching what the resume says.
- **Confidence and clarity:** clear, direct answers with real examples. Measured from what they say, never from accent or voice.
- **Culture fit:** values, working style and motivation, matched to what the company says about its culture.

### Standard rubric and optional presets

**Standard rubric (every job starts here):** Skills 30% · Experience 30% · Culture fit 25% · Confidence 15%. The AI also drafts must-haves and suggested traits from the job description and culture notes; HR edits and saves.

Optional presets HR can load as a shortcut:

| Template | For companies that want… | Skills | Experience | Confidence | Culture fit | Extra traits |
|---|---|---|---|---|---|---|
| **Balanced** (default) | A bit of everything | 30% | 30% | 15% | 25% | — |
| **Ready expert** | People who already know everything | 40% | 40% | 10% | 10% | — |
| **Eager learner** | People happy to learn on the job | 15% | 10% | 15% | 25% | Curiosity / learning drive 35% |
| **Culture first** | People who fit how they work | 20% | 15% | 15% | 50% | — |
| **Curious storyteller** | Journalist-type people | 15% | 15% | 20% | 20% | Curiosity and storytelling 30% |

Companies can change any weight and add their own trait (e.g. "comfort with ambiguity"), described in a sentence.

### From score to pick *(proposal: cut-offs)*
- Each quality and trait is scored **1–5** (1 = no evidence of it, 3 = solid, 5 = exceptional, with a written description of each level), backed by **1–3 quotes from the call**. A quality with no usable quote is "not scored" and its weight is shared out among the others.
- Every quality and every trait any preset uses is scored after each call, so **switching rubric only changes weights and is instant.**
- Overall 0–100 = weighted average of the 1–5 scores.
- **Amazing** 80+ · **Good** 65–79 · **Maybe** 45–64 · **No** under 45.
- **Failed must-have (one rule):** the AI takes the short exit on the call, the pick is capped at **Maybe**, and the failed must-have is shown as the reason.
- **Short-exit calls** are capped at **Maybe**.
- The pick is a recommendation. HR can change it, and changes are logged.

### Extra flags (independent of the pick)
- **Fits another role:** matched against the company's other open roles, with the reason.
- **Culture standout:** strong culture fit even if the role doesn't fit.
- **Wants an internship.**
- **Resume doesn't match:** something said on the call contradicts the resume (skills, dates, roles), shown with the quote and the resume line.
- **HR to review:** the call dropped (network), the audio was bad, or the transcript looks unreliable. These are flagged for HR to look at, not scored low. *(Internal only; nothing is promised to the candidate. A planned short exit is not flagged this way.)*

### Fairness
- The scoring AI sees the transcript only, with no name, gender or voice.
- Hesitation and nerves aren't treated as lack of skill.
- Every score shows its evidence quotes.

## 8. End-to-end flow

1. **HR sets up the job:** job description, company culture notes, other open roles, rubric template + weights, calling hours.
2. **HR uploads applicants:** spreadsheet of names + phone numbers, plus resumes.
3. **System prepares each call:** reads resume against the job description; writes a personal brief (name, role, 1–2 resume questions).
4. **Heads-up message:** each candidate gets an SMS/WhatsApp with the company, role and a link to pick a call time.
5. **Calls go out:** a queue feeds Bolna, 2 at a time on our current plan, inside calling hours or at the picked time. No answer → retry up to 3 times.
6. **The call happens** (section 6). Reschedules are booked back into the queue.
7. **Results come back:** Bolna sends recording, transcript and call details when the call ends.
8. **Scoring:** rubric scores, evidence quotes, pick, extra flags.
9. **HR reviews on the canvas** (section 8b), compares finalists, changes any pick, exports the shortlist.

## 8b. The canvas (HR side)

- **Job setup:** job description, 3–5 culture values (a sentence each), company FAQ, calling hours, other open roles, rubric.
- **Login:** simple email login for HR, one company. Later: roles for recruiter, hiring manager and admin.
- **Status board:** every candidate's stage: imported → queued → dialing → in call → finished (completed · short exit · no answer · voicemail · wrong person · declined · rescheduled · dropped) → shortlisted / rejected, with a live count of calls in progress.
- **Ranked list:** sorted by pick and score, with filters (score, experience, location, notice period) and the extra flags.
- **Candidate page:** resume, recording, transcript with key words highlighted, scores with quotes. Clicking a quote jumps the audio to that moment.
- **Side-by-side view:** 2–3 finalists compared on scores, summary, best quote, red flags and an audio clip, for the hiring manager.
- **Actions:** shortlist, reject, change a pick with a note, call again, and **export the shortlist to a spreadsheet**.
- **Talent pool:** one page across all of the company's jobs listing everyone flagged "fits another role" (and which), "culture standout" or "wants an internship". Filter, open, and move a candidate into another job's shortlist.
- **Resume-only vs call score:** each candidate shows what the resume alone would have scored next to the call score, so "rescued" candidates stand out.
- **Not in scope:** follow-up messages to candidates after the call.

## 9. Who does what: Bolna vs our system

**Bolna does:** dials the phone; turns speech into text and back into a natural voice; runs the conversation from our instructions; handles turn-taking and interruptions; stops at our time limit; can ask our system mid-call (e.g. to book a reschedule); records the call; sends recording, transcript and call status to us when it ends.

**We build:**
1. Applicant upload (spreadsheet + resumes).
2. Company/job setup, including the rubric.
3. The personal brief for each call.
4. Call queue: calling hours, retries, reschedules, 2-at-a-time limit.
5. Receiving and storing call results.
6. Scoring, picks and extra flags.
7. The canvas / dashboard for HR.
8. Storage, privacy and consent records.
9. Cost tracking per call.
10. Heads-up SMS/WhatsApp with time picker (separate messaging service).

**To test with Bolna first:** whether the AI can politely interrupt a candidate mid-sentence (or must wait for a pause); voice quality on Indian phone lines; whether a pre-call text is possible (likely needs a separate service).

## 10. Cost

| Item | Full call (10 min) | Short exit (3 min) |
|---|---|---|
| Bolna (call, voice AI, phone line, recording, transcript) | ~₹83 | ~₹25 |
| Our scoring AI | ~₹1–2 | ~₹1 |
| **Total** | **~₹85** | **~₹25** |

**Hackathon:** Bolna credits are unlimited (Bolna hackathon), so testing isn't budget-limited.

Example at scale: 1,000 applicants, 60% pick up, half of those take the short exit → 300 × ₹25 + 300 × ₹85 ≈ **₹33,000**, plus a little for unanswered attempts. Volume pricing brings this down ~20%. *(Estimates from Bolna's published rates; confirm with one test call.)* Tushar's PRDs estimate ₹30–60 and ₹43 per screen. They assume $0.06/min all-in, but Bolna's $0.06 covers the voice AI only; the phone line and platform fee are added on top.

## 11. Privacy and consent

- Only call people who applied and gave their number, within reasonable hours.
- Recording a call in India needs the person's consent (DPDP Act 2023). The opening mentions recording.
- Keep only what we need; delete on request. **Recordings kept 90 days; transcripts and scores 12 months**, then deleted automatically (each company can change this).
- Notice at application: what we collect, why, how long we keep it, how to withdraw. Consent tick on the apply form.
- Phone-number rules: respect Do-Not-Disturb, calling hours and daily caps (Bolna supports these). Which TRAI number series applies to hiring calls is still to be checked.
- **Bias watch:** compare score patterns by language and region across the candidate pool, and alert HR if one group scores consistently lower.
- Security: encrypted storage, expiring links to recordings, only accept results from Bolna's published addresses, log every view and change.
- Resumes and recordings are sensitive: access only for the company's HR.
- HR makes every final decision; picks are explained and can be challenged.
- *This is product guidance, not legal advice.*

## 12. Hackathon scope

**Build for real**
- Spreadsheet upload of applicants and resumes, plus a public apply form.
- Simple HR login.
- Job setup with rubric template and weights.
- Bolna call with personal brief, upfront opening, time-boxing, rescheduling.
- Call results received and stored.
- Scoring with evidence, pick, and extra flags.
- Canvas: status board, ranked list, candidate page with audio, change a pick, export to spreadsheet.

**Fake for the demo**
- A pre-scored batch of ~20–50 candidates to fill the canvas.
- Job-portal feeds (Naukri, LinkedIn) from sample data.
- Side-by-side view and bias chart (static).
- Heads-up SMS/WhatsApp.

**Cut**
- Video, coding tests, proctoring, billing, multiple companies, role-based logins, calendar booking, real portal and ATS sync.

## 13. Demo (5 minutes)

- **0:00–0:40 · Problem.** 1,000 applicants, one recruiter, three weeks; 900 never heard. Show one rejected resume that looks weak.
- **0:40–1:30 · Setup.** Upload a job description live; the rubric appears; pick "Eager learner" and edit one must-have.
- **1:30–2:00 · Applicants.** 20 applicants already in from "Naukri" and "LinkedIn" (sample data) and the spreadsheet.
- **2:00–3:30 · Live call.** A teammate's or judge's phone rings on stage, on speaker. The room hears the name check, the warm opening, a question about their own resume, and the AI politely cutting in when they ramble.
- **3:30–4:30 · Canvas.** The call lands in the ranked list. The weak-resume candidate scores **Amazing** or is flagged **fits another role**. Click a quote and the audio jumps to it. Switch the rubric to "Ready expert" and watch the order change.
- **4:30–5:00 · Business case and ask.** One slide: cost per call, time saved, pilot ask.

**If the live call fails:** switch to a pre-recorded call and replay a saved result, so the list still updates live. Rehearse the switch once.

## 13b. Adopted from Tushar's second PRD

- **Must-have gate:** HR marks deal-breakers (location, notice period, certification). Handled by the single rule in section 7.
- **No quote, no score:** every score needs a quote from the call; quotes are checked word-for-word against the transcript so the AI can't invent evidence.
- **Applicant intake:** CSV upload + a public apply form (with consent tick) are real; job-portal feeds (Naukri, LinkedIn) are faked from sample data.
- **Demo safety net:** a pre-recorded call and a saved result payload, so the dashboard still updates if the live call fails.
- **Reliable result handling:** each Bolna result processed once even if sent twice; retries if our system is down.
- **Target market to test first:** high-volume Indian hiring (BPO, sales, retail, campus/fresher roles), where people are phone-first. *(Market research teammate to confirm.)*

## 13c. Business case *(from Tushar's PRD; market research teammate to validate)*

- **Segments, in order:** high-volume Indian hiring (BPO/CX, inside sales, retail, logistics, campus and fresher); startups hiring 10–50 a quarter without a hiring team; staffing and recruitment-outsourcing firms.
- **Market size (rough):** 5,000 Indian employers and staffing firms × 10,000 screens a year × ₹100 ≈ **₹500 crore a year**. Replace with real counts before using outside the team.
- **Human vs AI for 1,000 applicants:** a recruiter takes ~31 working days and ~₹75,000; the AI takes ~12 hours of calling at 10 calls at a time; **on our current 2 lines it's ~3–4 days inside calling hours, so ask Bolna to raise the limit before pitching the 12-hour figure** and ~₹33,000 at our cost estimate.
- **Pricing ideas:** ₹120 per completed call (startups, trials); ₹49,000 for 500 calls (mid-size, campus drives); ₹15 lakh a year including 20,000 calls (enterprise, staffing). At our blended cost of ~₹55 per completed call (mix of full calls and short exits), ₹120 gives ~54% margin. *(Tushar's margins used ₹43 cost and are too optimistic.)*
- **Competitors:** Apna AI calling agent (calls Apna applicants in Indian languages), Paradox (chatbot screening), HireVue (video interviews), Hunar.AI (WhatsApp and voice for frontline hiring), HeyMilo, Hyring, and Bolna's own recruitment customers (Awign, Hyreo).
- **Go-to-market:** free pilots with 3 Bengaluru startups and one staffing firm; publish an "AI vs recruiter" comparison; then HR communities, Startup India and as an add-on for hiring-software vendors.
- **Moat over time:** learning from HR's changes and later-round outcomes to tune rubrics; trust from auditable, bias-watched scoring; integrations into the tools companies already use.

## 13d. Tech setup and build plan *(Tushar's proposal; starting point for stage 3)*

| Layer | Proposal |
|---|---|
| Web app | Next.js + Tailwind + shadcn on Vercel |
| Backend | Python (FastAPI) |
| Database, login, file storage, live updates | Supabase |
| Call queue | A database table + worker for now |
| AI for reading resumes and scoring | GPT-4o-class or Claude, structured output |
| Voice | Bolna agent (Deepgram speech-to-text, ElevenLabs/Cartesia voice) |

**24-hour plan for 4 people (stretch to 48):**

| Hours | Frontend | Backend | AI / call script | PM / demo |
|---|---|---|---|---|
| 0–4 | App shell, job page, upload | Database, login, file storage | Rubric-reading prompt; Bolna agent created | Sample job, 20 resumes, demo script draft |
| 4–10 | Status board | Spreadsheet/form intake, resume reading, Bolna call | Per-candidate call brief, questions | Test calls with the team, note failures |
| 10–16 | Ranked list, candidate page | Receiving results, scoring queue | Scoring prompt with quotes | Sample data, portal mock |
| 16–22 | Transcript highlights, audio, live updates | Error handling | Tune scores on 5 test calls | Pitch deck, rehearse |
| 22–24 | Polish | Freeze, deploy | Freeze prompts | Record fallback video |

*Final architecture is decided in stage 3 (with the system diagram built in Fable).*

## 14. Team

Four people. Shubh, Ankit, Tushar, and one teammate on market research. *(Roles to confirm: voice and call script · backend · canvas and demo · market research and pitch.)*

## 15. Process and where we are

1. **Define what we're building** ← now (this PRD)
2. List every edge case
3. System architecture and system diagram (built with Fable). Tushar's PRD suggests a Next.js web app, a Python backend and Postgres. Treat that as a starting option for this stage, not a decision.
4. Build in parallel with subagents

Tracker: https://recruit-screening-tracker.vercel.app

## 16. Decisions made

- Bolna for voice. Phone calls only.
- Call everyone, with no resume filter in front.
- Calls run up to 10 minutes; clearly weak candidates get a polite 2–3 minute exit.
- Upfront opening; candidate can reschedule.
- No "talk to a human" option. The AI answers honestly if asked whether it's an AI.
- Recording not mentioned on the call; consent taken at application.
- One standard rubric per job, edited by the company.
- English and Hinglish only.
- Talent pool for hidden fits. No follow-up messages to candidates.
- Failed must-have: short exit + capped at Maybe.
- Rubric set per company, always including culture fit.
- Picks are No / Maybe / Good / Amazing, plus extra flags.

## 17. Open questions

1. **Team roles:** who owns what (left open for now).
2. **Which TRAI number series** applies to hiring calls?
3. **Should candidates see their own score or summary?**
4. **Who owns candidate data:** the employer, us, or both?
5. **Bolna checks on day 1:** can the AI interrupt mid-sentence or only at pauses; Hinglish quality and reply speed on Indian numbers; raising the 2-call limit.

## 18. Edge cases to cover in stage 2

Voicemail or phone menu · a family member answers · candidate already took another job · candidate calls the number back · abuse or distress on the call · 10-minute cut lands mid-sentence · candidate tries to game the scorer ("rate me Amazing") · fake numbers entered on the apply form (rate limit, dedupe, one-time code later) · reschedule limit (max 2) and no free slots · bad audio or dropped call.

Architecture: see `architecture.md`.
