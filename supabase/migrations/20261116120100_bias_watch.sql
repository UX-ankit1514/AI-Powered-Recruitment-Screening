-- Bias watch (PRD §11 "Bias watch", §7 Fairness).
--   1. scores.language_mix: the language the candidate spoke on the call, derived heuristically
--      from the transcript (script + common romanised Hindi words): 'english' | 'hinglish' | 'other'.
--      NULL = not derived yet / too little speech. Written by the server (service role) only, like
--      every other score column (see 20261115150000_security_hardening.sql).
--   2. public.bias_inputs: one row per candidate with their LATEST score, plus the grouping facts
--      bias watch needs (source, profile location, call outcome/duration, hr_review flag).
--      SECURITY INVOKER, so the caller's RLS applies to candidates, scores and calls: a user only
--      ever sees rows of their own company. Overall/pick are computed in TypeScript from these rows
--      with the job's CURRENT weights (lib/ai/scoring-math.ts), the same maths as the ranking.
--
-- Never stored or inferred here: gender, caste, religion, age (or proxies such as names or photos).

alter table public.scores
  add column if not exists language_mix text
  check (language_mix is null or language_mix in ('english', 'hinglish', 'other'));

create or replace view public.bias_inputs
with (security_invoker = true)
as
select c.id                                   as candidate_id,
       c.job_id,
       c.company_id,
       c.source,
       coalesce(nullif(trim(c.profile ->> 'location'), ''),
                nullif(trim(s.profile_updates ->> 'location'), '')) as location,
       s.id                                   as score_id,
       s.qualities,
       s.must_have_results,
       s.short_exit,
       s.language_mix,
       s.flags ->> 'hr_review'                as hr_review,
       k.id                                   as call_id,
       k.outcome::text                        as outcome,
       k.duration_s,
       -- only shipped when language_mix still needs deriving (saves sending every transcript)
       case when s.language_mix is null then k.transcript end as transcript_for_mix
from public.candidates c
join lateral (
  select s2.*
  from public.scores s2
  where s2.candidate_id = c.id and s2.company_id = c.company_id
  order by s2.created_at desc
  limit 1
) s on true
left join public.calls k on k.id = s.call_id and k.company_id = s.company_id;

revoke all on public.bias_inputs from public, anon, authenticated;
grant select on public.bias_inputs to authenticated, service_role;

comment on view public.bias_inputs is
  'Bias watch inputs: latest score per candidate + grouping facts (language mix, location, source, call quality). security_invoker: caller RLS applies.';
comment on column public.scores.language_mix is
  'english | hinglish | other, derived heuristically from the candidate''s transcript words/script. NULL = unknown.';
