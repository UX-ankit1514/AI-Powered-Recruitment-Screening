# Pingo design language

Operational recruiter dashboard, shown live on a projector. Light mode only. Calm, exact, scannable; brand lives in precise details.

## Shell
- Dark charcoal sidebar (#18191E): wordmark "Pingo" with a blue waveform mark and the tagline "Every applicant gets heard"; nav Dashboard, Jobs, Candidates, Calls, Hidden fits, Settings; "Bolna connected" card pinned at the bottom.
- Main area light grey (#F3F4F7) with white cards (16px radius, 1px #E6E8ED border, soft offset shadow).
- Hash routing: #dashboard (default), #candidates, #candidate/<id>, #jobs, #calls, #hidden, #settings. Under 900px the sidebar becomes a top bar.

## Colour
- Primary indigo-blue #3550E8 (hover #2A40C6, soft #E8ECFE): primary buttons, Amazing, focus, on-call state.
- Picks: Amazing solid blue pill; Good soft blue (#93A3F3 bars); Maybe peach (#F2B68C, ink #93460F); No grey (#CDD0D8).
- Flag tints: fits another role green, culture standout blue, wants internship yellow, resume mismatch red, HR review grey.
- Text #14161C / #474C59 / #646A7A.

## Type
- Geist for all UI. Geist Mono (tabular) for numbers only: scores, counts, timers, money. No serif.
- Scale: 11.5 column labels · 12.5 meta · 14 body · 17 card titles · 26-30 page titles · 34 KPI · 52 call state.

## Components
- Pills 99px radius; buttons and inputs 10px; cards 12-16px.
- Tables: avatar initials, name + source, pick pill, score + bar, call, why/flags chip, Open.
- Call stage: full-width focused card with concentric rings, pulse and waveform in the state colour (connecting orange, on call blue, scoring violet, done green, failed red), large state label, elapsed timer and 10-minute bar. Motion stops under prefers-reduced-motion.
- Dashboard KPIs, picks bar, live-call examples and hidden-fit counts are illustrative for the 1,000-applicant story; tables use real candidates.
