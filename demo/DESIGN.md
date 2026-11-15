# Hirefy design language

Operational dashboard for HR recruiters, shown live on a projector. Calm, exact, warm. The brand lives in the details, not in decoration.

## Name
- Wordmark: "Hirefy." in Instrument Serif, with the full stop in the brand cyan. No logo image.
- Tagline beside it in small Geist after a 1px rule: "Every applicant gets heard". Hidden on phones.

## Colour: Flexoki
All colour comes from Flexoki. Light and dark follow the OS setting.
- Light: paper #FFFCF0 background, base-50 #F2F0E5 sunken areas, base-100 #E6E4D9 rules, base-200 input borders, ink #100F0F text, base-600 #6F6E69 secondary text (base-700 for body-secondary).
- Dark: black #100F0F background, base-950 #1C1B1A surfaces, base-900 #282726 sunken areas and rules, base-200 #CECDC3 text, base-500 #878580 secondary.
- Brand accent: cyan-600 #24837B (dark: cyan-400 #3AA99F). Used for primary actions, the active tab, focus, links, score pips and the on-call state.
- Pick scale: chips tinted from the -50 step (dark: -950), with -600 text (dark: -400).
  - Amazing: green #66800B / #879A39
  - Good: cyan #24837B / #3AA99F
  - Maybe: yellow #AD8301 / #D0A215
  - No: red #AF3029 / #D14D41
- Flags, kept low-emphasis as tinted chips: fits another role = blue, culture standout = magenta, wants internship = purple, resume mismatch = orange.
- Errors, unmet must-haves and the hang-up button use red.

## Live call states
The status card has a 3px top rule and a dot in the state colour, with a five-step track below it.
- Idle: grey, smaller headline.
- Connecting / ringing: orange, with a pulse.
- On call: cyan, with a calm 2.2s pulse. The mic pill, mute and hang-up controls appear.
- Scoring: blue, with a pulse.
- Done (ranked): green, steady.
- Failed: red, steady. The error sits in a soft red box in plain English.
The pulse stops when the OS asks for reduced motion.

## Type
- Instrument Serif: the wordmark, headings, the live status line, the candidate summary, quotes, and the questions the interviewer will ask.
- Geist: all UI text, including labels, tables and forms.
- Geist Mono (tabular figures): numbers only, such as scores, counts, weights, rank and resume-vs-call deltas. Words stay in Geist.
- Scale: 11 (column labels) · 12 (meta) · 14 (body) · 18-21 (quotes, summary) · 30-38 (headings) · 52 (live status, 38 on phones).

## Space, radius, borders
- Spacing in steps of 4: 4, 8, 12, 16, 20, 24, 40. Tight inside a group, 20-40 between groups.
- Radius: 4px for controls and chips, 8px for panels. No pill shapes.
- 1px hairlines. No shadows, gradients, glass, or thick coloured side borders.

## Microcopy
Warm, plain English, second person. Say what is happening and what to do next ("allow it when asked"). Errors name the problem and the way out. A status code goes in brackets at the end, never on its own. We talk to people, we don't judge them: "Held at Maybe", not "Rejected".

## Credits
- Flexoki colour scheme by Steph Ango (kepano), MIT licence: https://github.com/kepano/flexoki
- Geist and Geist Mono by Vercel, SIL Open Font Licence: https://github.com/vercel/geist-font
- Instrument Serif by Instrument, SIL Open Font Licence: https://github.com/Instrument/instrument-serif
