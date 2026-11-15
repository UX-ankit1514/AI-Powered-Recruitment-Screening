"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { QUALITY_KEYS, QUALITY_LABELS, RUBRIC_PRESETS, type CallingHours, type CultureValue, type CustomTrait, type FaqItem } from "@/lib/types";
import { IconX } from "@/components/icons";
import { JdField } from "./jd-field";

export type SetupInitial = {
  jobId: string;
  title: string;
  jd: string;
  values: CultureValue[];
  faq: FaqItem[];
  hours: CallingHours;
  languages: string[];
  atsMode: "call_everyone" | "ats_filter";
  atsTopPct: number;
  atsRescue: boolean;
  rubricVersion: number;
  weights: Record<string, number>;
  traits: CustomTrait[];
  mustHaves: string[];
  niceToHaves: string[];
  applicants: number;
};

const ENABLED_LANGS = [
  { id: "en", label: "English" },
  { id: "hinglish", label: "Hinglish" },
];
const SOON_LANGS = ["Kannada", "Tamil", "Telugu", "Marathi", "Gujarati", "Bengali", "Malayalam", "Punjabi", "Odia", "Urdu"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const QUALITY_HINT: Record<string, string> = {
  skills: "Can do the core work of the role",
  experience: "Relevant years and the right kind of work",
  confidence: "Clear, steady, owns their answers",
  culture_fit: "Matches the values you list",
  curiosity: "Asks good questions, wants to understand",
  learning_drive: "Picks things up and wants to grow",
  storytelling: "Explains with specific, memorable examples",
};

/** Whole-number percentages that always add up to 100 (largest remainder), as in /demo. */
export function toPercents(w: Record<string, number>): Record<string, number> {
  const keys = Object.keys(w).filter((k) => w[k] > 0);
  const out: Record<string, number> = {};
  for (const k of Object.keys(w)) out[k] = 0;
  const tot = keys.reduce((s, k) => s + w[k], 0);
  if (!tot) return out;
  let used = 0;
  const frac = keys.map((k) => {
    const v = (w[k] / tot) * 100;
    out[k] = Math.floor(v);
    used += out[k];
    return [k, v - out[k]] as const;
  });
  frac.sort((a, b) => b[1] - a[1]);
  for (let i = 0; i < 100 - used; i++) out[frac[i % frac.length][0]]++;
  return out;
}

function presetFor(weights: Record<string, number>): string {
  const pc = toPercents(weights);
  for (const p of RUBRIC_PRESETS) {
    const pw = p.weights as Record<string, number>;
    const keys = new Set([...Object.keys(pc), ...Object.keys(pw)]);
    if ([...keys].every((k) => (pc[k] ?? 0) === (pw[k] ?? 0))) return p.id;
  }
  return "custom";
}

function slugKey(name: string, taken: Set<string>) {
  const base =
    "t_" +
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 30) || "t_trait";
  let key = base;
  let n = 2;
  while (taken.has(key)) key = `${base}_${n++}`;
  return key;
}

type JobState = {
  title: string;
  jd: string;
  values: CultureValue[];
  faq: FaqItem[];
  hours: CallingHours;
  langs: string[];
  atsMode: "call_everyone" | "ats_filter";
  atsTopPct: number;
  atsRescue: boolean;
};

function initialJobState(i: SetupInitial): JobState {
  return {
    title: i.title,
    jd: i.jd,
    values: i.values,
    faq: i.faq,
    hours: i.hours,
    langs: i.languages.filter((l) => ENABLED_LANGS.some((e) => e.id === l)),
    atsMode: i.atsMode,
    atsTopPct: i.atsTopPct,
    atsRescue: i.atsRescue,
  };
}

function initialWeights(i: SetupInitial) {
  const w: Record<string, number> = {};
  for (const k of QUALITY_KEYS) w[k] = i.weights[k] ?? 0;
  for (const t of i.traits) w[t.key] = i.weights[t.key] ?? 0;
  return w;
}

function buildJobPayload(s: JobState) {
  return {
    title: s.title.trim(),
    jd_text: s.jd,
    culture_values: s.values.map((v) => ({ name: v.name.trim(), description: (v.description ?? "").trim() })).filter((v) => v.name),
    faq: s.faq.map((f) => ({ question: f.question.trim(), answer: f.answer.trim() })).filter((f) => f.question || f.answer),
    calling_hours: s.hours,
    languages: s.langs,
    ats_mode: s.atsMode,
    ats_top_pct: s.atsTopPct,
    ats_rescue: s.atsRescue,
  };
}

function buildRubricPayload(s: { mustHaves: string[]; niceToHaves: string[]; percents: Record<string, number>; traits: CustomTrait[] }) {
  return {
    must_haves: s.mustHaves.map((text) => ({ text })),
    nice_to_haves: s.niceToHaves.map((text) => ({ text })),
    weights: Object.fromEntries(Object.entries(s.percents).filter(([, v]) => v > 0)),
    custom_traits: s.traits,
  };
}

type Status = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; text: string } | { kind: "error"; text: string };

export function SetupEditor({ initial, editable }: { initial: SetupInitial; editable: boolean }) {
  const router = useRouter();
  const ro = !editable;

  // job
  const [title, setTitle] = useState(initial.title);
  const [jd, setJd] = useState(initial.jd);
  const [values, setValues] = useState<CultureValue[]>(initial.values);
  const [valueIn, setValueIn] = useState("");
  const [faq, setFaq] = useState<FaqItem[]>(initial.faq);
  const [hours, setHours] = useState<CallingHours>(initial.hours);
  const [langs, setLangs] = useState<string[]>(() => initialJobState(initial).langs);
  const [atsMode, setAtsMode] = useState(initial.atsMode);
  const [atsTopPct, setAtsTopPct] = useState(initial.atsTopPct);
  const [atsRescue, setAtsRescue] = useState(initial.atsRescue);

  // rubric
  const [traits, setTraits] = useState<CustomTrait[]>(initial.traits);
  const [weights, setWeights] = useState<Record<string, number>>(() => initialWeights(initial));
  const [preset, setPreset] = useState(() => presetFor(initial.weights));
  const [mustHaves, setMustHaves] = useState<string[]>(initial.mustHaves);
  const [niceToHaves, setNiceToHaves] = useState<string[]>(initial.niceToHaves);
  const [mhIn, setMhIn] = useState("");
  const [trName, setTrName] = useState("");
  const [trDesc, setTrDesc] = useState("");
  const [trErr, setTrErr] = useState<string | null>(null);

  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [version, setVersion] = useState(initial.rubricVersion);
  const [draftMsg, setDraftMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [drafting, setDrafting] = useState(false);

  const jobPayload = useMemo(
    () => buildJobPayload({ title, jd, values, faq, hours, langs, atsMode, atsTopPct, atsRescue }),
    [title, jd, values, faq, hours, langs, atsMode, atsTopPct, atsRescue],
  );
  const percents = useMemo(() => toPercents(weights), [weights]);
  const rubricPayload = useMemo(
    () => buildRubricPayload({ mustHaves, niceToHaves, percents, traits }),
    [mustHaves, niceToHaves, percents, traits],
  );

  // the saved state, as the payloads the server last accepted
  const [baseline, setBaseline] = useState(() => ({
    job: JSON.stringify(buildJobPayload(initialJobState(initial))),
    rubric: JSON.stringify(
      buildRubricPayload({
        mustHaves: initial.mustHaves,
        niceToHaves: initial.niceToHaves,
        percents: toPercents(initialWeights(initial)),
        traits: initial.traits,
      }),
    ),
  }));
  const jobDirty = JSON.stringify(jobPayload) !== baseline.job;
  const rubricDirty = JSON.stringify(rubricPayload) !== baseline.rubric;
  const dirty = jobDirty || rubricDirty;
  const noWeights = !Object.values(weights).some((v) => v > 0);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const allQualities: { key: string; name: string; desc?: string; custom: boolean }[] = [
    ...QUALITY_KEYS.map((k) => ({ key: k, name: QUALITY_LABELS[k], desc: QUALITY_HINT[k], custom: false })),
    ...traits.map((t) => ({ key: t.key, name: t.name, desc: t.description, custom: true })),
  ];

  function loadPreset(id: string) {
    const p = RUBRIC_PRESETS.find((x) => x.id === id);
    if (!p) return;
    const w: Record<string, number> = {};
    for (const q of allQualities) w[q.key] = (p.weights as Record<string, number>)[q.key] ?? 0;
    setWeights(w);
    setPreset(id);
  }

  function addTrait() {
    const name = trName.trim();
    setTrErr(null);
    if (!name) return setTrErr("Give the trait a name.");
    if (allQualities.some((q) => q.name.toLowerCase() === name.toLowerCase())) return setTrErr(`There is already a trait called ${name}.`);
    if (traits.length >= 10) return setTrErr("Up to 10 custom traits.");
    const key = slugKey(name, new Set(allQualities.map((q) => q.key)));
    setTraits([...traits, { key, name, description: trDesc.trim() }]);
    setWeights({ ...weights, [key]: 10 });
    setPreset("custom");
    setTrName("");
    setTrDesc("");
  }

  function removeTrait(key: string) {
    setTraits(traits.filter((t) => t.key !== key));
    const w = { ...weights };
    delete w[key];
    setWeights(w);
    setPreset(presetFor(w));
  }

  function addMustHave() {
    const m = mhIn.trim();
    if (!m || mustHaves.some((x) => x.toLowerCase() === m.toLowerCase())) return;
    setMustHaves([...mustHaves, m]);
    setMhIn("");
  }

  function addValue() {
    const v = valueIn.trim();
    if (!v || values.length >= 5) return;
    setValues([...values, { name: v, description: "" }]);
    setValueIn("");
  }

  async function draft() {
    setDrafting(true);
    setDraftMsg(null);
    try {
      const res = await fetch(`/api/jobs/${initial.jobId}/rubric/draft`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jd_text: jd, culture_values: jobPayload.culture_values }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        must_haves?: string[];
        nice_to_haves?: string[];
        suggested_traits?: CustomTrait[];
        error?: string;
      };
      if (!res.ok) throw new Error(body.error ?? `Drafting failed (${res.status})`);
      const newMh = (body.must_haves ?? []).filter((m) => !mustHaves.some((x) => x.toLowerCase() === m.toLowerCase()));
      const taken = new Set(allQualities.map((q) => q.key));
      const names = new Set(allQualities.map((q) => q.name.toLowerCase()));
      const newTraits = (body.suggested_traits ?? [])
        .filter((t) => !names.has(t.name.toLowerCase()))
        .slice(0, Math.max(0, 10 - traits.length))
        .map((t) => {
          const key = taken.has(t.key) ? slugKey(t.name, taken) : t.key;
          taken.add(key);
          return { key, name: t.name, description: t.description ?? "" };
        });
      setMustHaves([...mustHaves, ...newMh]);
      if (body.nice_to_haves?.length) setNiceToHaves(body.nice_to_haves);
      if (newTraits.length) {
        setTraits([...traits, ...newTraits]);
        setWeights({ ...weights, ...Object.fromEntries(newTraits.map((t) => [t.key, 10])) });
        setPreset("custom");
      }
      setDraftMsg({
        text: `Added ${newMh.length} must-have${newMh.length === 1 ? "" : "s"} and ${newTraits.length} trait${newTraits.length === 1 ? "" : "s"}. Review them, then save.`,
      });
    } catch (err) {
      setDraftMsg({ text: err instanceof Error ? err.message : "Drafting failed.", bad: true });
    } finally {
      setDrafting(false);
    }
  }

  async function save() {
    if (!jobPayload.title) return setStatus({ kind: "error", text: "The job needs a title." });
    if (!langs.length) return setStatus({ kind: "error", text: "Pick at least one language." });
    if (!hours.days.length) return setStatus({ kind: "error", text: "Pick at least one calling day." });
    if (hours.start >= hours.end) return setStatus({ kind: "error", text: "Calling hours must end after they start." });
    if (rubricDirty && noWeights) return setStatus({ kind: "error", text: "Raise at least one weight above zero." });
    setStatus({ kind: "saving" });
    try {
      let savedVersion = version;
      if (jobDirty) {
        const res = await fetch(`/api/jobs/${initial.jobId}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(jobPayload),
        });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(body.error ?? `Could not save the job (${res.status})`);
      }
      if (rubricDirty) {
        const res = await fetch(`/api/jobs/${initial.jobId}/rubric`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(rubricPayload),
        });
        const body = (await res.json().catch(() => ({}))) as { rubric?: { version: number }; error?: string };
        if (!res.ok || !body.rubric) throw new Error(body.error ?? `Could not save the rubric (${res.status})`);
        savedVersion = body.rubric.version;
        setVersion(savedVersion);
      }
      setBaseline({ job: JSON.stringify(jobPayload), rubric: JSON.stringify(rubricPayload) });
      setStatus({ kind: "saved", text: rubricDirty ? `Saved · rubric v${savedVersion} is live` : "Saved" });
      router.refresh();
    } catch (err) {
      setStatus({ kind: "error", text: err instanceof Error ? err.message : "Could not save." });
    }
  }

  const called = Math.ceil((initial.applicants * atsTopPct) / 100);
  const presetButtons = (
    <div className="seg" role="group" aria-label="Rubric preset">
      {RUBRIC_PRESETS.map((p) => (
        <button key={p.id} type="button" aria-pressed={preset === p.id} onClick={() => loadPreset(p.id)} disabled={ro}>
          {p.name}
        </button>
      ))}
      {preset === "custom" ? (
        <button type="button" aria-pressed="true" disabled>
          Custom
        </button>
      ) : null}
    </div>
  );

  return (
    <>
      {ro ? (
        <p className="note" style={{ marginBottom: 20 }}>
          View only. Admins and recruiters can change the job and rubric.
        </p>
      ) : null}
      <fieldset disabled={ro} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
        <div className="jobs">
          <div className="col">
            <div className="card sec">
              <h2>The role</h2>
              <p className="hint">What the interviewer knows about the job and the company.</p>
              <div className="f">
                <label htmlFor="s-title">Job title</label>
                <input id="s-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
              </div>
              <div className="f">
                <JdField value={jd} onChange={setJd} disabled={ro} />
              </div>

              <div className="blk">
                <div className="blk-head">
                  <b>Culture values</b>
                  <span className="label">3 to 5 work best</span>
                </div>
                <ul className="edit">
                  {values.map((v, i) => (
                    <li key={i}>
                      <input
                        value={v.name}
                        aria-label={`Culture value ${i + 1}`}
                        maxLength={80}
                        style={{ flex: "0 1 38%" }}
                        onChange={(e) => setValues(values.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                      />
                      <input
                        value={v.description ?? ""}
                        placeholder="What it looks like, in a line"
                        aria-label={`What ${v.name || `value ${i + 1}`} looks like`}
                        maxLength={300}
                        onChange={(e) => setValues(values.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))}
                      />
                      <button type="button" className="x" aria-label={`Remove ${v.name || "value"}`} onClick={() => setValues(values.filter((_, j) => j !== i))}>
                        <IconX />
                      </button>
                    </li>
                  ))}
                </ul>
                {values.length < 5 ? (
                  <div className="addrow">
                    <input
                      value={valueIn}
                      onChange={(e) => setValueIn(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addValue();
                        }
                      }}
                      placeholder="Add a value"
                      aria-label="New culture value"
                      maxLength={80}
                    />
                    <button type="button" className="btn2 sm" onClick={addValue}>
                      Add
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="blk">
                <div className="blk-head">
                  <b>Company FAQ</b>
                  <span className="label">The only answers the interviewer gives</span>
                </div>
                <ul className="edit">
                  {faq.map((f, i) => (
                    <li key={i} className="faq">
                      <div className="faq-top">
                        <input
                          value={f.question}
                          placeholder="Question"
                          aria-label={`FAQ question ${i + 1}`}
                          maxLength={300}
                          onChange={(e) => setFaq(faq.map((x, j) => (j === i ? { ...x, question: e.target.value } : x)))}
                        />
                        <button type="button" className="x" aria-label="Remove question" onClick={() => setFaq(faq.filter((_, j) => j !== i))}>
                          <IconX />
                        </button>
                      </div>
                      <textarea
                        value={f.answer}
                        placeholder="Answer"
                        aria-label={`FAQ answer ${i + 1}`}
                        maxLength={1000}
                        style={{ minHeight: 50 }}
                        onChange={(e) => setFaq(faq.map((x, j) => (j === i ? { ...x, answer: e.target.value } : x)))}
                      />
                    </li>
                  ))}
                </ul>
                {faq.length < 20 ? (
                  <div className="addrow">
                    <button type="button" className="btn2 sm" onClick={() => setFaq([...faq, { question: "", answer: "" }])}>
                      Add question
                    </button>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="card sec">
              <h2>Calling</h2>
              <p className="hint">When Pingo may phone candidates, and in which languages. India time.</p>
              <div className="frow">
                <div className="f">
                  <label htmlFor="h-start">From</label>
                  <input id="h-start" type="time" value={hours.start} onChange={(e) => setHours({ ...hours, start: e.target.value })} />
                </div>
                <div className="f" style={{ marginTop: 0 }}>
                  <label htmlFor="h-end">Until</label>
                  <input id="h-end" type="time" value={hours.end} onChange={(e) => setHours({ ...hours, end: e.target.value })} />
                </div>
              </div>
              <div className="f" style={{ marginTop: 14 }}>
                <span className="flabel" id="days-l">
                  Days
                </span>
                <div className="days" role="group" aria-labelledby="days-l">
                  {DAYS.map((d, i) => {
                    const on = hours.days.includes(i);
                    return (
                      <button
                        key={d}
                        type="button"
                        className="day"
                        aria-pressed={on}
                        onClick={() => setHours({ ...hours, days: on ? hours.days.filter((x) => x !== i) : [...hours.days, i].sort((a, b) => a - b) })}
                      >
                        {d}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="blk">
                <div className="blk-head">
                  <b>Languages</b>
                  <span className="label">The candidate picks; the interviewer follows</span>
                </div>
                <div className="langs">
                  {ENABLED_LANGS.map((l) => (
                    <label key={l.id}>
                      <input
                        type="checkbox"
                        checked={langs.includes(l.id)}
                        onChange={(e) => setLangs(e.target.checked ? [...langs, l.id] : langs.filter((x) => x !== l.id))}
                      />
                      {l.label}
                    </label>
                  ))}
                </div>
                <p className="label" style={{ margin: "12px 0 8px" }}>
                  Coming soon
                </p>
                <div className="langs">
                  {SOON_LANGS.map((l) => (
                    <label key={l} className="soon" title="Coming soon">
                      <input type="checkbox" disabled checked={false} readOnly />
                      {l}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="col">
            <div className="card sec">
              <h2>Who gets a call</h2>
              <p className="hint">Call every applicant, or only the ones a resume screen ranks highest.</p>
              <div className="seg" role="group" aria-label="Who gets a call">
                <button type="button" aria-pressed={atsMode === "call_everyone"} onClick={() => setAtsMode("call_everyone")}>
                  Call everyone
                </button>
                <button type="button" aria-pressed={atsMode === "ats_filter"} onClick={() => setAtsMode("ats_filter")}>
                  ATS filter first
                </button>
              </div>
              {atsMode === "ats_filter" ? (
                <div className="ats-body">
                  <div className="sl">
                    <div className="sl-top">
                      <label htmlFor="ats-pct">Call the top N% by resume score</label>
                      <span className="pct">{atsTopPct}%</span>
                    </div>
                    <input id="ats-pct" type="range" min={10} max={100} step={5} value={atsTopPct} onChange={(e) => setAtsTopPct(Number(e.target.value))} />
                  </div>
                  <p className="ats-sum">
                    {initial.applicants ? (
                      <>
                        Of {initial.applicants.toLocaleString("en-IN")} applicants: <b>{called.toLocaleString("en-IN")}</b> get a call ·{" "}
                        <b>{(initial.applicants - called).toLocaleString("en-IN")}</b> filtered by ATS
                      </>
                    ) : (
                      <>No applicants yet · the top {atsTopPct}% will get a call</>
                    )}
                  </p>
                  <label className="chk">
                    <input type="checkbox" checked={atsRescue} onChange={(e) => setAtsRescue(e.target.checked)} />
                    <span>
                      Rescue people just below the cutoff
                      <small>{atsRescue ? "Anyone within 10 points of the cutoff still gets a call." : "Off: everyone below the cutoff is skipped."}</small>
                    </span>
                  </label>
                </div>
              ) : null}
              <p className="ats-note">Pingo works best when everyone gets a call. Use the ATS filter when call volume or budget is tight.</p>
            </div>

            <div className="card sec">
              <div className="blk-head" style={{ marginBottom: 4 }}>
                <h2>Rubric</h2>
                <button
                  type="button"
                  className="btn2 sm"
                  onClick={draft}
                  disabled={ro || drafting || !jd.trim()}
                  title={!jd.trim() ? "Add the job description first" : undefined}
                >
                  {drafting ? "Drafting…" : "Draft with AI"}
                </button>
              </div>
              <p className="hint">Weights always add up to 100%. Saving re-ranks every candidate; no one is re-scored.</p>
              {draftMsg ? (
                <p role="status" className={draftMsg.bad ? "err" : "note"} style={{ margin: "0 0 14px" }}>
                  {draftMsg.text}
                </p>
              ) : null}
              <div style={{ marginBottom: 6 }}>{presetButtons}</div>
              <div>
                {allQualities.map((q) => (
                  <div key={q.key} className="sl">
                    <div className="sl-top">
                      <label htmlFor={`w-${q.key}`}>{q.name}</label>
                      <span className="pct">{percents[q.key] ?? 0}%</span>
                      {q.custom ? (
                        <button type="button" className="x" aria-label={`Remove ${q.name}`} onClick={() => removeTrait(q.key)}>
                          <IconX />
                        </button>
                      ) : null}
                    </div>
                    {q.desc || q.custom ? (
                      <div className="sl-desc">
                        {q.desc}
                        {q.custom ? `${q.desc ? " · " : ""}scored from the next call on` : ""}
                      </div>
                    ) : null}
                    <input
                      id={`w-${q.key}`}
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={weights[q.key] ?? 0}
                      onChange={(e) => {
                        const w = { ...weights, [q.key]: Number(e.target.value) };
                        setWeights(w);
                        setPreset(presetFor(w));
                      }}
                    />
                  </div>
                ))}
              </div>
              {noWeights ? <p className="err">Every weight is zero. Raise at least one to rank candidates.</p> : null}

              <div className="blk">
                <div className="blk-head">
                  <b>Add custom trait</b>
                  <span className="label">Skipped until a call is scored on it</span>
                </div>
                <div className="addrow">
                  <input value={trName} onChange={(e) => setTrName(e.target.value)} placeholder="Name, e.g. Resilience" aria-label="Trait name" maxLength={60} />
                  <input value={trDesc} onChange={(e) => setTrDesc(e.target.value)} placeholder="One line on what good looks like" aria-label="Trait description" maxLength={300} />
                  <button type="button" className="btn2 sm" onClick={addTrait}>
                    Add trait
                  </button>
                </div>
                {trErr ? (
                  <p className="err" role="alert">
                    {trErr}
                  </p>
                ) : null}
              </div>

              <div className="blk">
                <div className="blk-head">
                  <b>Must-haves</b>
                  <span className="label">Failing one holds a candidate at Maybe</span>
                </div>
                <ul className="edit">
                  {mustHaves.length ? (
                    mustHaves.map((m, i) => (
                      <li key={m} className="mhi">
                        <span>{m}</span>
                        <button type="button" className="x" aria-label={`Remove ${m}`} onClick={() => setMustHaves(mustHaves.filter((_, j) => j !== i))}>
                          <IconX />
                        </button>
                      </li>
                    ))
                  ) : (
                    <li className="label">No must-haves. Nobody is held back.</li>
                  )}
                </ul>
                <div className="addrow">
                  <input
                    value={mhIn}
                    onChange={(e) => setMhIn(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addMustHave();
                      }
                    }}
                    placeholder="Add a must-have"
                    aria-label="New must-have"
                    maxLength={300}
                  />
                  <button type="button" className="btn2 sm" onClick={addMustHave}>
                    Add
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </fieldset>

      {editable ? (
        <div className="savebar" role="region" aria-label="Save changes">
          <span aria-live="polite">
            {status.kind === "saving" ? (
              "Saving…"
            ) : status.kind === "error" ? (
              <span className="bad">{status.text}</span>
            ) : dirty ? (
              rubricDirty ? (
                `Unsaved changes · saving creates rubric v${version + 1}`
              ) : (
                "Unsaved changes"
              )
            ) : status.kind === "saved" ? (
              <span className="ok">{status.text}</span>
            ) : (
              <>
                All changes saved · rubric <span className="num">v{version}</span>
              </>
            )}
          </span>
          <button type="button" className="btn" onClick={save} disabled={!dirty || status.kind === "saving"}>
            {status.kind === "saving" ? "Saving…" : "Save changes"}
          </button>
        </div>
      ) : null}
    </>
  );
}
