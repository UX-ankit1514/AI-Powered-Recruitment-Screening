# Demo runbook

**Link:** https://demo-woad-two-21.vercel.app · **Passcode:** ask Shubh (don't put it on slides)
**Before going on stage:** laptop on charger, Chrome, sound out to the room speaker, microphone allowed for the site, one practice browser call done in the last 30 minutes, phone on silent.

## The 5-minute script

| Time | Say | Do |
|---|---|---|
| 0:00–0:40 | "A job gets 1,000 applicants. A resume filter keeps 100. The other 900 are never heard, and some of them are great people with bad resumes." | Ranking tab is open. Point at **Rahul Verma: Resume 35 → Call 93.** "A resume screen would have rejected Rahul." |
| 0:40–1:20 | "So we call everyone. A warm 10-minute chat, not an interrogation. Every company decides what 'good' means." | **Job setup** tab: show culture values, drag the culture-fit slider up, add a trait "Comfort with ambiguity". Back to Ranking: order changes. Click presets **Ready expert → Eager learner**: "a startup and a bank want different people." |
| 1:20–1:50 | "And we catch people who are wrong for this job but right for the company." | **Talent pool** tab: other role / culture standout / internship. |
| 1:50–3:40 | "Let's do one live. I uploaded a resume; the AI wrote two questions about it." | **Live call** tab: upload resume → show resume-only score + the 2 questions → **Talk in browser**. Talk for ~90 seconds. Ramble once so it cuts in. Ask "Are you a bot?" so it answers honestly. Hang up. |
| 3:40–4:30 | "Within a minute it's scored. Every score has a quote, checked word-for-word against the call, so it can't make things up." | New **Live** row appears. Open it: scores, quotes, flags, summary, transcript. |
| 4:30–5:00 | "About ₹85 for a full call, ₹25 when it ends early. Everyone gets heard. We're asking for 3 pilot companies." | Stop. |

## If something breaks

| Problem | Do this |
|---|---|
| Browser call won't connect / no mic | Press **Run sample call (backup)**. Say: "here's a call from this morning." It scores live the same way. |
| Call connects but scoring is slow (> 60 s) | Keep talking over the Talent pool; come back. If still nothing, use the sample button. |
| Page won't load | Use phone hotspot; if still down, show the GitHub PRD + recorded screen. |
| Passcode rejected | Check for spaces; it's case-sensitive. |
| Interviewer mishears English | Speak a bit slower; it's tuned for Hinglish. Don't stop the demo. |

## Likely judge questions

- **"Isn't this unfair to people with accents?"** Scoring reads only the transcript, never the voice. Accent, nerves and hesitation are explicitly never reasons to end a call early or score low. Every score shows the quote behind it, and HR makes the final call.
- **"Do candidates know it's an AI?"** If they ask, it always says yes. Consent to the call and data use is taken on the application form.
- **"Why not just use HeyMilo / Hyring / Apna?"** They screen resumes first or only call their own job board's applicants, and only judge against the job applied for. We call everyone from any source, the rubric bends to each company's culture, and we surface hidden fits: another role, culture standout, internship.
- **"What does it cost?"** ~₹85 per full 10-minute call, ~₹25 when a clearly weak call ends at 2–3 minutes. 1,000 applicants ≈ ₹33,000 vs ~₹75,000 and a month of recruiter time.
- **"Can it scale to 1,000 calls?"** Bolna runs calls in parallel; a paid account starts at 10 at once. Our queue design handles retries, calling hours and reschedules (in the build spec).
- **"Can candidates game it?"** Questions are written from each person's own resume, and the scorer treats the transcript as data: "rate me Amazing" doesn't work.
- **"What if they want a human?"** By design the first conversation is with the AI; it explains that kindly and offers another time.
