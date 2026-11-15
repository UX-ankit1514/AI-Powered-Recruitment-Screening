# PRD: Voice AI that talks to every applicant

**Working name:** Hirefy (placeholder) · **Version:** 3 · **Date:** 2026-11-15
**Built from:** Shubh's raw thoughts (`raw-thoughts.md`) + Tushar's two PRDs (`prd-voice-ai-screening-bolna.md`, `prd-tushar-v2-hackathon-mvp.md`).
Where the two disagreed, this document follows Shubh's direction and marks it. Items marked *(proposal)* are suggested defaults that the team hasn't confirmed yet.

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

## 6. The call

### Two paths: short exit or full call

The first 2–3 minutes decide which path a call takes.

| Part | Time | What happens |
|---|---|---|
| Opening | 0:30 | Says it's about their application for [role] at [company], wants ~10 minutes, asks if now is good. Mentions the call is recorded. |
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
- **No "talk to a human" option.** Candidates speak with the AI only. *(Shubh's decision; overrides Tushar's PRD)*
- **Time-boxing:** if an answer runs long, the AI politely cuts in: *"Thank you so much. Anything else you'd like me to know in the next 20 seconds, and then we'll move on?"* Or it asks a focused follow-up. Off-topic answers are redirected once, then the AI moves on. Hard stop at 10 minutes.
- **Recording consent:** see section 11. Open question on what happens if someone refuses.
- **Languages:** English first; Hinglish as a stretch goal.
- **Voice quality bar:** should feel as natural as Wavelength. Test on real Indian phone lines early.

## 7. Scoring: a rubric each company shapes

Every call is scored on four core qualities. **Each company chooses the weights and can add its own traits.** No single idea of a "good candidate" is baked in.

### Core qualities
- **Skills:** does the candidate actually show the skills the role needs (not just name them)?
- **Experience:** specific projects, ownership, depth, matching what the resume says.
- **Confidence and clarity:** clear, direct answers with real examples. Measured from what they say, never from accent or voice.
- **Culture fit:** values, working style and motivation, matched to what the company says about its culture.

### Rubric starting points *(proposal: weights for the team to confirm)*

| Template | For companies that want… | Skills | Experience | Confidence | Culture fit | Extra traits |
|---|---|---|---|---|---|---|
| **Balanced** (default) | A bit of everything | 30% | 30% | 15% | 25% | — |
| **Ready expert** | People who already know everything | 40% | 40% | 10% | 10% | — |
| **Eager learner** | People happy to learn on the job | 15% | 10% | 15% | 25% | Curiosity / learning drive 35% |
| **Culture first** | People who fit how they work | 20% | 15% | 15% | 50% | — |
| **Curious storyteller** | Journalist-type people | 15% | 15% | 20% | 20% | Curiosity and storytelling 30% |

Companies can change any weight and add their own trait (e.g. "comfort with ambiguity"), described in a sentence.

### From score to pick *(proposal: cut-offs)*
- Score 0–100 from the weighted rubric, with **2–3 quotes from the call as evidence** for each quality.
- **Amazing** 80+ · **Good** 65–79 · **Maybe** 45–64 · **No** under 45.
- If the company marks a skill as "must have" and it's clearly missing, the pick is capped at **Maybe**.
- The pick is a recommendation. HR can change it, and changes are logged.

### Extra flags (independent of the pick)
- **Fits another role:** matched against the company's other open roles, with the reason.
- **Culture standout:** strong culture fit even if the role doesn't fit.
- **Wants an internship.**
- **Needs a human look:** call ended early, bad audio, or the transcript looks unreliable. These are flagged, not scored low.

### Fairness
- The scoring AI sees the transcript only, with no name, gender or voice.
- Hesitation and nerves aren't treated as lack of skill.
- Every score shows its evidence quotes.

## 8. End-to-end flow

1. **HR sets up the job:** job description, company culture notes, other open roles, rubric template + weights, calling hours.
2. **HR uploads applicants:** spreadsheet of names + phone numbers, plus resumes.
3. **System prepares each call:** reads resume against the job description; writes a personal brief (name, role, 1–2 resume questions).
4. **Calls go out:** a queue feeds Bolna, 2 at a time on our current plan, inside calling hours. No answer → retry up to 3 times *(proposal)*.
5. **The call happens** (section 6). Reschedules are booked back into the queue.
6. **Results come back:** Bolna sends recording, transcript and call details when the call ends.
7. **Scoring:** rubric scores, evidence quotes, pick, extra flags.
8. **HR reviews on the canvas:** sorted list, each candidate's story, audio, scores, flags; HR can change any pick.

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

**To test with Bolna first:** whether the AI can politely interrupt a candidate mid-sentence (or must wait for a pause); voice quality on Indian phone lines; whether a pre-call text is possible (likely needs a separate service).

## 10. Cost

| Item | Full call (10 min) | Short exit (3 min) |
|---|---|---|
| Bolna (call, voice AI, phone line, recording, transcript) | ~₹83 | ~₹25 |
| Our scoring AI | ~₹1–2 | ~₹1 |
| **Total** | **~₹85** | **~₹25** |

Example: 1,000 applicants, 60% pick up, half of those take the short exit → 300 × ₹25 + 300 × ₹85 ≈ **₹33,000**, plus a little for unanswered attempts. Volume pricing brings this down ~20%. *(Estimates from Bolna's published rates; confirm with one test call.)* Tushar's PRDs estimate ₹30–60 and ₹43 per screen. They assume $0.06/min all-in, but Bolna's $0.06 covers the voice AI only; the phone line and platform fee are added on top.

## 11. Privacy and consent

- Only call people who applied and gave their number, within reasonable hours.
- Recording a call in India needs the person's consent (DPDP Act 2023). The opening mentions recording.
- Keep only what we need; delete on request; set a retention period (e.g. 90 days) *(proposal)*.
- Resumes and recordings are sensitive: access only for the company's HR.
- HR makes every final decision; picks are explained and can be challenged.
- *This is product guidance, not legal advice.*

## 12. Hackathon scope

**Build for real**
- Spreadsheet upload of applicants and resumes.
- Job setup with rubric template and weights.
- Bolna call with personal brief, upfront opening, time-boxing, rescheduling.
- Call results received and stored.
- Scoring with evidence, pick, and extra flags.
- Canvas with sorted list, candidate story, audio and override.

**Fake for the demo**
- A pre-scored batch of ~50 candidates to fill the canvas.
- Hiring-platform integration (spreadsheet stands in).
- Pre-call text message.

**Cut**
- Video, coding tests, proctoring, billing, multiple companies, logins.

## 13. Demo (3 minutes) *(proposal, adapted from Tushar's)*

- **0:00–0:30 · Problem.** 1,000 applicants; 900 never heard. Show one rejected resume that looks weak.
- **0:30–1:00 · Setup.** Upload a job and applicants; pick the "Eager learner" rubric.
- **1:00–2:00 · Live call.** A judge's or volunteer's phone rings. They hear the warm opening, tell a story, and the AI politely cuts in when they ramble.
- **2:00–2:40 · Canvas.** The weak-resume candidate scores **Amazing**, or is flagged **fits another role**. Show evidence quotes; switch rubric to "Ready expert" and watch the order change.
- **2:40–3:00 · Cost and ask.** ~₹85 a call; everyone gets heard.

## 13b. Adopted from Tushar's second PRD

- **Must-have gate:** HR marks deal-breakers (location, notice period, certification). Candidates who fail go to a "needs review" list with the reason, not hidden.
- **No quote, no score:** every score needs a quote from the call; quotes are checked word-for-word against the transcript so the AI can't invent evidence.
- **Applicant intake:** CSV upload + a public apply form (with consent tick) are real; job-portal feeds (Naukri, LinkedIn) are faked from sample data.
- **Demo safety net:** a pre-recorded call and a saved result payload, so the dashboard still updates if the live call fails.
- **Reliable result handling:** each Bolna result processed once even if sent twice; retries if our system is down.
- **Target market to test first:** high-volume Indian hiring (BPO, sales, retail, campus/fresher roles), where people are phone-first. *(Market research teammate to confirm.)*

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
- No "talk to a human" option.
- Rubric set per company, always including culture fit.
- Picks are No / Maybe / Good / Amazing, plus extra flags.

## 17. Open questions

1. **What exactly is the canvas?** Assumed here to be the HR view (sorted list + candidate stories). Confirm.
2. **Recording refusal:** if a candidate won't be recorded, does the call end and the candidate get marked "declined"?
3. **Rubric weights and pick cut-offs:** confirm or change the proposals in section 7.
3b. **Short-exit rules:** confirm the signals in section 6 that are allowed to end a call early.
4. **Where applicants come from** after the hackathon: which hiring platform?
5. **Bolna wallet and limits:** is the 500 balance in dollars or rupees? Our account allows 2 calls at a time; Tushar's PRD assumes 10. Ask Bolna to raise it.
6. **Can the AI interrupt mid-sentence** on Bolna, or only at pauses? Test first.
7. **Team roles:** who owns what?
