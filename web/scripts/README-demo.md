# Demo data

Fills the **Acme SaaS** workspace with pre-scored candidates so the 5-minute demo works without placing live calls. Nothing outside Acme SaaS is touched.

## Run

From `web/` (reads `web/.env.local`, uses the service-role key):

```bash
npm run seed                                # once: company, test users, Sales Executive job
npx tsx scripts/seed-demo.ts                # seed (or re-seed) + verify
npx tsx scripts/seed-demo.ts --verify-only  # just the checks
npx tsx scripts/seed-demo.ts --no-verify    # seed only
npx tsx scripts/clear-demo.ts               # remove all demo data
```

Re-running the seed is safe. Demo rows use fixed ids and are replaced each time, so you never get duplicates.

## What you get

- **Sales Executive** (the existing seed job): 25 candidates. The 12 stories from `/demo` are copied word for word: Rahul (resume 35, call 93 Amazing), Ananya, Karthik, Priya, Sneha (fits another role), Arjun (wants an internship), Vikram (short exit), Meera (culture standout), Rohan (resume mismatch), Farhan, Divya and Harpreet (won't relocate, so held at Maybe). There are 13 more on top of those, including:
  - Ritu, who fits the SDE 1 role better
  - Deepak, who speaks Hinglish
  - Sanjay, who left the call early because he already took another job
  - Aman, who didn't answer and is waiting for a retry
  - Pooja, who booked a callback for tomorrow at 17:00 IST
  - Gaurav, who declined
- **Software Engineer (SDE 1)**: a new job built from the SDE 1 JD. Culture values are Ownership, Curiosity and Customer first; there are five technical must-haves and Balanced weights. It has 8 candidates:
  - Zoya: weak resume (40) but scores 83 Amazing on the call
  - Siddharth: strong resume, but it falls apart on the call
  - Varun: wants an internship
  - Ritika: fits Sales better
  - Mohit: short exit because he won't relocate
  - Nandini: culture standout
  - Aditya and Lakshmi
- Every candidate has a finished call with a realistic length, a short transcript and a cost in USD cents (the unit Bolna reports). Scored candidates have 1 to 5 scores per quality. Every quote, must-have answer and resume-mismatch claim is said by the candidate in the stored transcript, and the seed runs the app's own quote check before writing anything.

Story data lives in `web/fixtures/demo-candidates.ts`. Edit it there and re-run the seed.

## Safety

- **No one can be phoned.** Demo phone numbers are `+1555…`, a fictional range. The dispatcher only dials Indian mobiles (`+91 6–9…`).
- **Nothing is queued.** Every demo call is written already finished. Aman ("retrying") and Pooja ("callback booked") show their status on the candidate, but there is no queued call behind it. That means Pooja's callback **does not** appear in the Calls page's "Upcoming callbacks" card, because that card lists queued calls only.
- **Every demo row is marked.** Each demo candidate has `profile.demo = true`. `clear-demo.ts` deletes only Acme candidates that have that mark **and** a `+1555` phone. Their calls, scores and actions are deleted with them. It also deletes the SDE 1 job, unless real candidates have been added to it since.

## What verify checks

1. It ranks Sales Executive using `lib/ai/scoring-math.ts` and the job's current rubric, and confirms Rahul is **Amazing 93** under Balanced.
2. It switches the job to *ATS filter, top 50%*, runs the app's ATS split (`lib/ingest/ats.ts`) and confirms Rahul falls below the cutoff (64, with the rescue lane on). It then switches the job **back to call everyone** every time, even if a check fails.
3. It confirms there are no unfinished calls on the demo jobs and that every demo phone starts with `+1555`.

Two notes:
- The app only applies the ATS filter to candidates who haven't been called yet. Rahul has already been called, so his saved status stays "scored". The check proves he *would* be dropped. It doesn't grey him out in the table.
- Divya Menon shows 57 in the app and 58 in the database ranking view. Her weighted score lands exactly on .5, and the app's JavaScript maths and the database round it differently. Her pick (Maybe) is the same either way. Verify prints this as a warning.
