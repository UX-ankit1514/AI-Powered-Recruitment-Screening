-- candidate_ranking (build-spec §2): latest score per candidate, overall computed at read time
-- from the job's CURRENT rubric weights, so a weights change re-ranks instantly.
-- overall = sum(score_i * w_i) / sum(w_i over scored qualities), mapped 1..5 -> 0..100.
-- pick: amazing >= 80, good >= 65, maybe >= 45, else no; capped at maybe on a failed
-- must-have or a short exit.
-- security_invoker => the caller's RLS applies to every underlying table.

create or replace view public.candidate_ranking
with (security_invoker = true)
as
with latest as (
  select distinct on (s.candidate_id) s.*
  from public.scores s
  order by s.candidate_id, s.created_at desc
),
cur as (
  select r.job_id, r.version, r.weights
  from public.rubrics r
  where r.is_current
),
agg as (
  select l.id as score_id,
         sum((l.qualities -> w.key ->> 'score')::numeric * (w.value #>> '{}')::numeric)
           / nullif(sum((w.value #>> '{}')::numeric), 0) as avg_score
  from latest l
  join public.candidates c on c.id = l.candidate_id
  join cur on cur.job_id = c.job_id
  cross join lateral jsonb_each(cur.weights) w
  where jsonb_typeof(l.qualities -> w.key -> 'score') = 'number'
    and jsonb_typeof(w.value) = 'number'
    and (w.value #>> '{}')::numeric > 0
  group by l.id
),
base as (
  select c.id as candidate_id,
         c.job_id,
         c.company_id,
         c.name,
         c.status,
         c.source,
         c.resume_only_score,
         l.id as score_id,
         l.call_id,
         l.qualities,
         l.must_have_results,
         l.flags,
         l.summary,
         l.short_exit,
         l.rubric_version as scored_rubric_version,
         cur.version as current_rubric_version,
         round((a.avg_score - 1) / 4 * 100)::int as overall,
         coalesce(exists (
           select 1 from jsonb_array_elements(
             case when jsonb_typeof(l.must_have_results) = 'array' then l.must_have_results else '[]'::jsonb end
           ) m
           where m ->> 'met' = 'false'
         ), false) as failed_must_have
  from public.candidates c
  left join latest l on l.candidate_id = c.id
  left join agg a on a.score_id = l.id
  left join cur on cur.job_id = c.job_id
)
select b.*,
       case
         when b.overall is null then null
         when b.overall >= 80 and not (b.failed_must_have or coalesce(b.short_exit, false)) then 'amazing'::public.pick
         when b.overall >= 65 and not (b.failed_must_have or coalesce(b.short_exit, false)) then 'good'::public.pick
         when b.overall >= 45 or ((b.failed_must_have or coalesce(b.short_exit, false)) and b.overall >= 65) then 'maybe'::public.pick
         else 'no'::public.pick
       end as pick
from base b;

revoke all on public.candidate_ranking from anon;
grant select on public.candidate_ranking to authenticated;
