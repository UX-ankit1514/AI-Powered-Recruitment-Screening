/**
 * Interview plan: role profile + candidate profile → ordered question plan for Aditi.
 * Deterministic (no model call), so a call never waits on the gateway and HR's edits to the role
 * profile flow straight into the next call. Pure; safe anywhere.
 *
 * Coverage guarantee: every must-have check, every must/core requirement, every rubric quality with
 * weight > 0 and every custom trait appears in the plan (directly, or via a requirement mapped to it,
 * or as "observe across the call" for confidence / storytelling).
 */
import type { RoleProfile } from "./role-profile-schema";
import { wordOverlap } from "./role-profile";
import { clip } from "./text";

export type PlanItem = {
  /** Requirement ids / quality keys / must-have check ids this item gathers evidence for. */
  covers: string[];
  tag: "must" | "core" | "quality" | "trait" | "nice" | "observe";
  question: string;
  probe: string;
  /** Short personalised hint from the resume ("resume mentions X: ask for a specific example"). */
  note: string;
};

export type PlanCandidate = {
  current_role?: string | null;
  years_experience?: number | null;
  skills?: string[] | null;
  companies?: string[] | null;
  resume_note?: string | null;
};

export type PlanInput = {
  profile: RoleProfile;
  candidate?: PlanCandidate | null;
  weights?: Record<string, number> | null;
  /** Custom trait keys from the rubric (always covered, whatever their weight). */
  traitKeys?: string[];
};

const OBSERVE_ONLY = new Set(["confidence", "storytelling"]);

function resumeText(c: PlanCandidate | null | undefined): string {
  if (!c) return "";
  return [c.current_role, ...(c.skills ?? []), ...(c.companies ?? []), c.resume_note].filter(Boolean).join(" ");
}

function resumeNote(reqText: string, cand: PlanCandidate | null | undefined): string {
  const r = resumeText(cand);
  if (!r) return "";
  return wordOverlap(reqText, r) >= 0.34 ? "Resume suggests this; ask for one specific example rather than re-asking." : "Not clear from the resume; probe gently.";
}

export function buildInterviewPlan(input: PlanInput): PlanItem[] {
  const { profile, candidate } = input;
  const weights = input.weights ?? {};
  const traitKeys = new Set(input.traitKeys ?? []);
  const items: PlanItem[] = [];
  const covered = new Set<string>();

  // 1. Must-have checks, merged with their "must" requirement when the text matches.
  const mustReqs = profile.requirements.filter((r) => r.importance === "must");
  for (const m of profile.must_have_checks) {
    const req = mustReqs.find((r) => !covered.has(r.id) && wordOverlap(r.text, m.text) >= 0.5);
    const covers = [m.id, ...(req ? [req.id] : []), ...(req && req.kind !== "logistics" ? [req.quality] : [])];
    items.push({
      covers,
      tag: "must",
      question: req?.question || `Ask about: ${m.text}`,
      probe: req?.probe || "",
      note: clip(`Must-have "${m.text}". Verify: ${m.check}`, 260),
    });
    covers.forEach((c) => covered.add(c));
  }
  // 2. Remaining must, then core requirements.
  for (const tier of ["must", "core"] as const) {
    for (const r of profile.requirements.filter((x) => x.importance === tier && !covered.has(x.id))) {
      const viaQuality = r.kind !== "logistics" ? [r.quality] : [];
      items.push({
        covers: [r.id, ...viaQuality],
        tag: tier,
        question: r.question || `Ask about ${r.text}.`,
        probe: r.probe,
        note: clip([r.evidence_hint && `Good answer: ${r.evidence_hint}`, resumeNote(r.text, candidate)].filter(Boolean).join(" "), 260),
      });
      covered.add(r.id);
      viaQuality.forEach((q) => covered.add(q));
    }
  }
  // 3. Qualities with weight > 0 (and every custom trait) not yet covered through a requirement.
  for (const [key, qa] of Object.entries(profile.quality_anchors)) {
    const weighted = (weights[key] ?? 0) > 0;
    const isTrait = traitKeys.has(key);
    if (!weighted && !isTrait) continue;
    if (covered.has(key) && !isTrait) continue;
    if (OBSERVE_ONLY.has(key) || !qa.question) {
      items.push({ covers: [key], tag: "observe", question: "", probe: "", note: `${qa.name}: judged from how they answer throughout; no separate question.` });
    } else {
      items.push({ covers: [key], tag: isTrait ? "trait" : "quality", question: qa.question, probe: "", note: `${qa.name}. Strong answer: ${qa.anchors["4"]}` });
    }
    covered.add(key);
  }
  // 4. Nice-to-haves, only if time allows.
  for (const r of profile.requirements.filter((x) => x.importance === "nice" && !covered.has(x.id))) {
    items.push({ covers: [r.id], tag: "nice", question: r.question || `If time allows, ask about ${r.text}.`, probe: "", note: "Only if time allows." });
    covered.add(r.id);
  }
  return items;
}

/** Every id the plan must cover, for tests and for the evaluator's coverage report. */
export function requiredCoverage(input: PlanInput): string[] {
  const { profile } = input;
  const weights = input.weights ?? {};
  const ids = [
    ...profile.must_have_checks.map((m) => m.id),
    ...profile.requirements.filter((r) => r.importance !== "nice").map((r) => r.id),
    ...Object.keys(profile.quality_anchors).filter((k) => (weights[k] ?? 0) > 0 || (input.traitKeys ?? []).includes(k)),
  ];
  return [...new Set(ids)];
}

const TAG_LABEL: Record<PlanItem["tag"], string> = {
  must: "MUST",
  core: "CORE",
  quality: "QUALITY",
  trait: "TRAIT",
  nice: "IF TIME",
  observe: "OBSERVE",
};

/**
 * Compress the plan into the Bolna `interview_plan` prompt variable (plain text, ≤ maxChars).
 * Must/core items are never dropped; nice-to-haves go first, then probes and notes are shortened.
 */
export function compressPlan(items: PlanItem[], maxChars = 2200): string {
  const render = (it: PlanItem, i: number, level: 0 | 1 | 2) => {
    if (it.tag === "observe") return `${i}. [OBSERVE] ${clip(it.note, level ? 90 : 160)}`;
    let s = `${i}. [${TAG_LABEL[it.tag]}] ${clip(it.question, level === 2 ? 140 : 200)}`;
    if (it.probe && level < 2) s += ` Follow-up if vague: ${clip(it.probe, 120)}`;
    if (it.note && level === 0) s += ` (${clip(it.note, 200)})`;
    return s;
  };
  const build = (list: PlanItem[], level: 0 | 1 | 2) => list.map((it, i) => render(it, i + 1, level)).join("\n");
  let list = items;
  for (const level of [0, 1, 2] as const) {
    let out = build(list, level);
    if (out.length <= maxChars) return out;
    const noNice = list.filter((x) => x.tag !== "nice");
    out = build(noNice, level);
    if (out.length <= maxChars) return out;
    list = noNice;
  }
  return build(list, 2).slice(0, maxChars);
}
