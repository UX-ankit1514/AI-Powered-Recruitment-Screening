# Raw thoughts: AI-powered recruitment screening

> Shubh's original brain-dump, lightly tidied for readability. Working name: "Hirefy" (can be renamed later).
> Not a spec. This is the starting point we design from.

## The problem

When a company posts a job description, it might get 1,000 applicants. Usually HR or an AI screens the resumes, picks the top 50 or 100, and someone calls those people.

The 900 who don't get picked might include good applicants with bad resumes. We're deciding without enough information.

## The idea

Use **Bolna AI** (voice AI) to build a tool that calls **every** applicant. It's a 10–15 minute call to understand who they are and hear their story, done in a warm way. Then it checks whether they fit the JD.

Even someone who isn't right for this JD might have something in their story that stands out:

- they could suit **another role** at the company
- they could be a **good culture fit** for the company in general
- they could be **looking for an internship**, so capture that

## The flow

1. Someone applies for a job.
2. We get ~1,000 applicants on whatever hiring platform we use.
3. The AI schedules a 10–15 minute call with each of them.
4. On the call, the AI learns about them and judges whether they fit the JD and the company.
5. Afterwards:
   - **Enrich the applicant record** with what we learned on the call.
   - **Give a pick** on each applicant: **No / Maybe / Good / Amazing**.

## The interface

- **A phone call, not a Google Meet.** No video. Just the voice AI talking with the candidate for 10–15 minutes, and **the phone call has to feel perfect**.
- The **candidate can reschedule** the call with the Bolna agent if now isn't a good time.
- Alongside the call, we can also have a **canvas** (a visual view of the candidates and results; details still to be worked out).
- The tone should be **warm and conversational**, not a prickly HR interview. We want to actually talk to the candidate, not sit in judgement.

## Opening the call: be upfront

The AI should say right away what the call is about, for example: *"Hi, this is regarding your job application for [role] at [company]. I'd love a quick 10-minute chat to understand more about you. Is now a good time?"* If it isn't, offer to reschedule.

## Guardrails

- **Keep answers time-boxed.** Some candidates go on and on. The AI should know how to cut in politely so a call doesn't drag to 45–50 minutes, which wastes everyone's time.
- Example interjection: *"Okay, thank you so much. Tell me anything else you'd like me to know in the next 20 seconds, and then we'll move to the next question."*
- It can also ask a **follow-up question** instead of moving on.

## Inspiration

- **Wavelength** is a very good voice AI to learn from, both for its intelligence and how natural its conversations feel.

## Open questions (from the first discussion)

- ~~Phone call or browser call?~~ **Decided: phone call.** No Google Meet.
- **What is the canvas exactly?** Recruiter dashboard, per-candidate story board, or something else?
- **Hackathon demo:** what should the judges see live? A phone ringing and a real conversation, or mainly a dashboard of verdicts?
- **Consent:** candidates should know they're talking to an AI and agree to the call.
