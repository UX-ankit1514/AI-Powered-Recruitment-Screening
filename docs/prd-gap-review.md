# PRD v3 gap review (2026-11-15)

Independent review of `prd.md` plus our own pass. Grouped by who has to act.

## A. Needs Shubh's decision

1. **Does the AI say it's an AI?** Not stated anywhere. "Are you a bot?" is the likeliest awkward moment on a live call. Proposal: say so in the opening, plus an honest scripted answer if asked.
2. **Recording consent.** "This call is recorded" isn't consent. Proposal: ask "Is that okay?"; if no → thank, end, mark "declined recording".
3. **Failed must-have: one rule.** Today it's a short exit (§6), capped at Maybe (§7), *and* sent to "needs review" (§13b). Proposal: short exit on the call; pick capped at Maybe; reason shown.
4. **What does a candidate hear afterwards?** Everyone is told "the team will get back to you", including hundreds of No's. Proposal: decide the follow-up per pick (even if faked for the demo).
5. **Hidden fits after the call: a talent pool.** Flags exist, but nowhere to use them later (search "fits another role" / "wants internship" across jobs). This is our main differentiator. Proposal: a simple talent-pool view.
6. **Rubric source for the demo.** Does AI draft the rubric from the job description + culture notes, or does HR pick a template? Proposal: AI drafts, HR picks a template to start from and edits.
7. **Hindi in the hackathon.** Mixed Hindi-English breaks word-for-word quote checks. Proposal: English-only for the demo; Hindi after.
8. **Team owners.** Nobody assigned yet. Blocks parallel work.
9. **Bolna wallet currency.** ₹500 = ~6 calls; $500 = ~500. Decides the test plan.

## B. We can fix in the PRD (no decision needed)

- **Rubric switch on stage must be instant:** score every quality and trait any template uses after each call; switching only changes weights.
- **Scoring scale:** 1–5 per quality with a description of each level; no evidence = "not scored" and weights rebalance; short exits capped at Maybe.
- **Define each flag:** "triggered when…" + minimum evidence. "Other open roles" = title + must-have skills + one-line description. Culture notes = 3–5 values with a sentence each.
- **Candidate profile ("enrich the applicant record"):** list the fields (experience, location, notice period, current role, salary expectation if asked, languages, interests, internship interest) and where each comes from.
- **Safe answers:** a company FAQ in job setup; the AI never commits to pay, offers or timelines.
- **Culture-fit questions:** how culture fit and "beyond this role" are actually drawn out on the call (question bank per template).
- **AI voice persona:** name, voice, pace; measurable "feels natural" bar (reply in under ~1 second, no talking over the candidate).
- **Who triggers the short exit:** the live call agent, so its instructions carry the must-haves and short-exit rules word for word.
- **Rescheduling:** offer slots inside calling hours with free capacity; at most 2 reschedules.
- **Status board stages:** add declined call, declined recording, rescheduled, short exit, wrong person, HR to review.
- **Success measures:** keep a resume-only score next to the call score so the demo shows the "rescued" gap. Pilot: HR agreement with picks, good candidates wrongly cut early, completion rate, real cost per call, candidate rating.
- **Apply form abuse:** phone check with a one-time code, rate limit, dedupe numbers.
- **Name the call edge cases** for stage 2: voicemail / phone menu, family member answers, already took another job, candidate calls back, abuse or distress, cut-off mid-sentence at 10 minutes, candidate trying to game the scorer ("rate me Amazing").
- **Demo logistics:** teammate's phone with a pre-loaded resume, rehearse time from call end to scored result, show a "scoring…" state, public address for Bolna results, avoid speakerphone echo.
- **Security:** check Bolna results with a shared secret; per-role access tests on every data route.

## C. Contradictions to clean up

- Calendar booking "cut" (§12) vs rescheduling being a must-build.
- Heads-up message is a flow step (§8) but faked (§12).
- "Blind" scoring (§7) vs resume-mismatch flag needing the resume.
- "~12 hours for 1,000 applicants" (§13c) assumes 10 lines; on our 2 lines it's ~3–4 days inside calling hours.
- "What is the canvas?" still open (§17) though §8b defines it.
- Consent tick only covers form applicants, not spreadsheet uploads.
