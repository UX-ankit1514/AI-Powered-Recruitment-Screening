# Raw thoughts: AI-powered recruitment screening

> Shubh's thinking, tidied for readability. Working name: "Hirefy" (can be renamed later).
> Not a spec. The PRD (`prd.md`) is built from this. Last updated 2026-11-15.

## The problem

A company posts a job and gets 1,000 applicants. HR or an AI screens the resumes, picks the top 50–100, and someone calls those people.

The 900 who don't get picked might include good applicants with bad resumes. We're deciding without enough information.

## The idea

Use **Bolna AI** to phone **every** applicant, not just the ones with good resumes. Each call is warm (up to 10 minutes, shorter if they're clearly not a fit), aimed at understanding who they are and hearing their story. Then the AI checks whether they fit the JD and the company.

Even someone who isn't right for this JD might have something that stands out:

- they could suit **another role** at the company
- they could be a **good culture fit** for the company in general
- they could be **looking for an internship**, so capture that

## The flow

1. Someone applies for a job.
2. We get ~1,000 applicants on whatever hiring platform we use.
3. The AI phones each of them: 2–3 minutes if they're clearly not a fit, up to 10 minutes if they're promising.
4. On the call, the AI learns about them and judges whether they fit the JD and the company.
5. Afterwards:
   - **Enrich the applicant record** with what we learned.
   - **Give a pick** on each applicant: **No / Maybe / Good / Amazing**.

## The call

- **Phone call only.** No Google Meet, no video. The call has to feel perfect.
- **Length depends on the candidate:**
  - If a candidate is clearly weak, or can't hold a basic conversation, **end the call politely within 2–3 minutes.** No need to ask them everything.
  - If a candidate seems good enough, keep going, but **10 minutes max.**
- **Upfront opening:** *"Hi, this is regarding your job application for [role] at [company]. I'd love a 10-minute chat to understand more about you. Is now a good time?"*
- **The candidate can reschedule** with the AI if now isn't a good time.
- **No "talk to a human" option.** The candidate speaks with the AI only.
- **Tone:** warm and conversational, not a prickly HR interview. We genuinely want to talk to the candidate, not judge them.

## Guardrails

- **Keep answers time-boxed.** Some candidates go on and on. The AI cuts in politely so a call doesn't drag to 45–50 minutes.
- Example: *"Okay, thank you so much. Tell me anything else you'd like me to know in the next 20 seconds, and then we'll move to the next question."*
- It can also ask a **follow-up question** instead of moving on.

## How candidates are judged

- Every call is scored on **skills, experience, confidence and culture fit**.
- **The rubric changes with the company.** Some companies want people who already know everything. Some are happy with people who want to learn. Some want curious, journalist-type people, or people who fit their culture. The scoring should adapt to each company, not assume one kind of "good candidate".

## Cost

- Roughly **₹85 for a full 10-minute call**, and about ₹20–25 for a 2–3 minute early-exit call. About ₹83 of that is Bolna credit (dialling, listening, talking, recording, transcript). The rest is our own AI scoring the transcript afterwards.

## What makes us different (vs HeyMilo, Hyring, Apna)

- HeyMilo and Hyring screen resumes first, then interview the survivors. **We call everyone**, to rescue people with bad resumes. (Apna's AI calling agent also calls applicants, so "call everyone" alone isn't unique. The next two points are.)
- They only judge against the job applied for. **We also spot other-role fit, culture fit and internship interest.**
- They lean into tests and anti-cheating. **Ours is a warm conversation.**

## Inspiration

- **Wavelength** is a very good voice AI to learn from, both for its intelligence and how natural its conversations feel.

## Team (4)

- Shubh, Ankit, Tushar, plus one person on market research. Roles to be confirmed.

## Process

1. Define exactly what we're building.
2. List every edge case.
3. Design the full system architecture and draw the system diagram (built with Fable).
4. Build it in parallel using subagents.

Progress is tracked at https://recruit-screening-tracker.vercel.app
