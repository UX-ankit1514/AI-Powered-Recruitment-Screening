"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { IconX } from "@/components/icons";
import {
  IMPORTANCE,
  REQUIREMENT_KINDS,
  RoleProfileBodySchema,
  type Anchors,
  type Requirement,
  type RoleProfileBody,
} from "@/lib/ai/role-profile-schema";
import "./role-profile.css";

type Initial = { body: RoleProfileBody; version: number; source: "generated" | "edited" | "fallback"; savedAt: string | null } | null;

const LEVELS = ["1", "2", "3", "4", "5"] as const;
const LEVEL_HINT: Record<(typeof LEVELS)[number], string> = {
  "1": "No evidence",
  "2": "Weak",
  "3": "Meets the bar",
  "4": "Strong",
  "5": "Exceptional",
};
const IMPORTANCE_LABEL: Record<Requirement["importance"], string> = { must: "Must-have", core: "Core", nice: "Nice to have" };
const KIND_LABEL: Record<Requirement["kind"], string> = { skill: "Skill", experience: "Experience", behaviour: "Behaviour", logistics: "Logistics" };

const emptyAnchors = (): Anchors => ({ "1": "", "2": "", "3": "", "4": "", "5": "" });

function nextId(prefix: string, taken: Set<string>) {
  let i = 1;
  while (taken.has(`${prefix}_${i}`)) i++;
  return `${prefix}_${i}`;
}

export function RoleProfilePanel({ jobId, editable, hasJd, initial }: { jobId: string; editable: boolean; hasJd: boolean; initial: Initial }) {
  const router = useRouter();
  const [saved, setSaved] = useState(initial);
  const [body, setBody] = useState<RoleProfileBody | null>(initial?.body ?? null);
  const [busy, setBusy] = useState<"generating" | "saving" | null>(null);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [msg, setMsg] = useState<{ bad: boolean; text: string } | null>(null);
  // Newly added requirements open for editing; typing never collapses them.
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());
  const ro = !editable;

  const dirty = useMemo(() => JSON.stringify(body) !== JSON.stringify(saved?.body ?? null), [body, saved]);
  const qualityOptions = useMemo(() => Object.entries(body?.quality_anchors ?? {}).map(([k, q]) => ({ key: k, name: q.name })), [body]);
  const taken = useMemo(
    () => new Set([...(body?.requirements ?? []).map((r) => r.id), ...(body?.must_have_checks ?? []).map((m) => m.id), ...Object.keys(body?.quality_anchors ?? {})]),
    [body],
  );

  function adopt(row: Record<string, unknown>, text: string) {
    const parsed = RoleProfileBodySchema.safeParse({ requirements: row.requirements, must_have_checks: row.must_have_checks, quality_anchors: row.quality_anchors });
    if (!parsed.success) {
      setMsg({ bad: true, text: "Saved, but the profile came back in an unexpected shape. Reload the page." });
      return;
    }
    const next = { body: parsed.data, version: Number(row.version) || 0, source: (row.source as "generated" | "edited") ?? "edited", savedAt: String(row.created_at ?? "") };
    setSaved(next);
    setBody(parsed.data);
    setMsg({ bad: false, text });
    router.refresh();
  }

  async function generate() {
    setConfirmRegen(false);
    setBusy("generating");
    setMsg(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}/role-profile/generate`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const data = (await res.json().catch(() => null)) as { role_profile?: Record<string, unknown>; error?: string } | null;
      if (!res.ok || !data?.role_profile) {
        const text =
          res.status === 502 || res.status === 503
            ? "The AI couldn't draft this right now. Try again in a minute, or write the requirements yourself."
            : (data?.error ?? "Could not draft the role profile. Try again.");
        setMsg({ bad: true, text });
        return;
      }
      adopt(data.role_profile, `Drafted version ${String(data.role_profile.version)}. Read it through and adjust anything that doesn't fit this job.`);
    } catch {
      setMsg({ bad: true, text: "Could not reach Pingo. Check your connection and try again." });
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!body) return;
    setBusy("saving");
    setMsg(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}/role-profile`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = (await res.json().catch(() => null)) as { role_profile?: Record<string, unknown>; error?: string } | null;
      if (!res.ok || !data?.role_profile) {
        setMsg({ bad: true, text: data?.error ? `Not saved. ${plainError(data.error, body)}` : "Not saved. Try again." });
        return;
      }
      adopt(data.role_profile, `Saved as version ${String(data.role_profile.version)}. The next calls and scores use it.`);
    } catch {
      setMsg({ bad: true, text: "Could not reach Pingo. Check your connection and try again." });
    } finally {
      setBusy(null);
    }
  }

  const setReq = (i: number, patch: Partial<Requirement>) =>
    body && setBody({ ...body, requirements: body.requirements.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const setReqAnchor = (i: number, lvl: (typeof LEVELS)[number], v: string) =>
    body && setReq(i, { anchors: { ...body.requirements[i].anchors, [lvl]: v } });

  function addRequirement() {
    if (!body) return;
    const r: Requirement = {
      id: nextId("req", taken),
      text: "",
      kind: "skill",
      importance: "core",
      evidence_hint: "",
      question: "",
      probe: "",
      quality: "skills",
      anchors: emptyAnchors(),
    };
    setBody({ ...body, requirements: [...body.requirements, r] });
    setFresh(new Set([...fresh, r.id]));
  }

  const generateBtn = (
    <button
      type="button"
      className="btn2 sm"
      onClick={() => (saved ? setConfirmRegen(true) : void generate())}
      disabled={ro || busy !== null || !hasJd}
      title={!hasJd ? "Add and save the job description first" : undefined}
    >
      {busy === "generating" ? "Drafting…" : saved ? "Draft again with AI" : "Generate with AI"}
    </button>
  );

  return (
    <section className="card sec rp" aria-labelledby="rp-h">
      <div className="rp-head">
        <div>
          <h2 id="rp-h">Role profile</h2>
          <p className="hint">
            What good looks like for this job. Aditi plans her questions from it, and every answer is scored against its five levels.
          </p>
        </div>
        <div className="rp-actions">
          {saved ? (
            <span className="label">
              Version <span className="num">{saved.version}</span> · {saved.source === "generated" ? "drafted by AI" : "edited by your team"}
            </span>
          ) : null}
          {editable ? generateBtn : <span className="label">Read only · admins and recruiters can edit</span>}
          {editable && body ? (
            <button type="button" className="btn sm" onClick={save} disabled={!dirty || busy !== null}>
              {busy === "saving" ? "Saving…" : "Save role profile"}
            </button>
          ) : null}
        </div>
      </div>

      {confirmRegen ? (
        <div className="rp-confirm" role="alertdialog" aria-labelledby="rp-c">
          <p id="rp-c">
            This replaces what you see with a fresh AI draft from the saved job description and rubric. Version {saved?.version} stays in the history.
          </p>
          <div className="rp-confirm-row">
            <button type="button" className="btn sm" onClick={() => void generate()}>
              Draft again
            </button>
            <button type="button" className="btn2 sm" onClick={() => setConfirmRegen(false)}>
              Keep this one
            </button>
          </div>
        </div>
      ) : null}

      {msg ? (
        <p role="status" className={msg.bad ? "err" : "note"} style={{ margin: "0 0 14px" }}>
          {msg.text}
        </p>
      ) : null}

      {!body ? (
        <div className="rp-empty">
          <p>
            <b>No role profile yet.</b> Until there is one, calls are planned and scored from the rubric&apos;s must-haves and the standard quality
            descriptions.
          </p>
          <p className="label">
            {editable
              ? hasJd
                ? "Generate one from the job description, then review each requirement."
                : "Save a job description first, then generate one."
              : "An admin or recruiter can generate one."}
          </p>
          {editable ? <div style={{ marginTop: 12 }}>{generateBtn}</div> : null}
        </div>
      ) : (
        <fieldset disabled={ro || busy !== null} className="rp-body">
          <div className="blk-head">
            <b>Requirements</b>
            <span className="label">Must-haves are checked on every call; core ones shape the questions</span>
          </div>
          <ul className="rp-list">
            {body.requirements.map((r, i) => (
              <li key={r.id}>
                <details className="rp-item" open={fresh.has(r.id) || undefined}>
                  <summary>
                    <span className={`rp-imp ${r.importance}`}>{IMPORTANCE_LABEL[r.importance]}</span>
                    <span className="rp-title">{r.text || "New requirement"}</span>
                    <span className="label rp-meta">
                      {r.kind === "logistics"
                        ? "Logistics · checked on the call, counts in JD fit only"
                        : `${KIND_LABEL[r.kind]} · counts toward ${qualityOptions.find((q) => q.key === r.quality)?.name ?? r.quality}`}
                    </span>
                  </summary>
                  <div className="rp-fields">
                    <div className="f">
                      <label htmlFor={`rq-t-${r.id}`}>Requirement</label>
                      <input id={`rq-t-${r.id}`} value={r.text} maxLength={200} onChange={(e) => setReq(i, { text: e.target.value })} placeholder="e.g. 1+ year of B2B phone sales" />
                    </div>
                    <div className="rp-row3">
                      <div className="f">
                        <label htmlFor={`rq-i-${r.id}`}>Importance</label>
                        <select id={`rq-i-${r.id}`} value={r.importance} onChange={(e) => setReq(i, { importance: e.target.value as Requirement["importance"] })}>
                          {IMPORTANCE.map((k) => (
                            <option key={k} value={k}>
                              {IMPORTANCE_LABEL[k]}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="f">
                        <label htmlFor={`rq-k-${r.id}`}>Kind</label>
                        <select id={`rq-k-${r.id}`} value={r.kind} onChange={(e) => setReq(i, { kind: e.target.value as Requirement["kind"] })}>
                          {REQUIREMENT_KINDS.map((k) => (
                            <option key={k} value={k}>
                              {KIND_LABEL[k]}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="f">
                        <label htmlFor={`rq-q-${r.id}`}>Counts toward</label>
                        <select id={`rq-q-${r.id}`} value={r.quality} disabled={r.kind === "logistics"} title={r.kind === "logistics" ? "Logistics only count in JD fit" : undefined} onChange={(e) => setReq(i, { quality: e.target.value })}>
                          {qualityOptions.map((q) => (
                            <option key={q.key} value={q.key}>
                              {q.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="f">
                      <label htmlFor={`rq-e-${r.id}`}>What a good answer contains</label>
                      <input id={`rq-e-${r.id}`} value={r.evidence_hint} maxLength={300} onChange={(e) => setReq(i, { evidence_hint: e.target.value })} />
                    </div>
                    <div className="frow">
                      <div className="f">
                        <label htmlFor={`rq-qq-${r.id}`}>Question Aditi asks</label>
                        <input id={`rq-qq-${r.id}`} value={r.question} maxLength={300} onChange={(e) => setReq(i, { question: e.target.value })} placeholder="Leave blank to let Aditi phrase it" />
                      </div>
                      <div className="f" style={{ marginTop: 0 }}>
                        <label htmlFor={`rq-p-${r.id}`}>Follow-up if the answer is vague</label>
                        <input id={`rq-p-${r.id}`} value={r.probe} maxLength={300} onChange={(e) => setReq(i, { probe: e.target.value })} />
                      </div>
                    </div>
                    <AnchorEditor idBase={`rq-a-${r.id}`} anchors={r.anchors} onChange={(lvl, v) => setReqAnchor(i, lvl, v)} />
                    {editable ? (
                      <button type="button" className="linkbtn rp-remove" onClick={() => setBody({ ...body, requirements: body.requirements.filter((_, j) => j !== i) })}>
                        Remove this requirement
                      </button>
                    ) : null}
                  </div>
                </details>
              </li>
            ))}
          </ul>
          {editable && body.requirements.length < 30 ? (
            <div className="addrow">
              <button type="button" className="btn2 sm" onClick={addRequirement}>
                Add requirement
              </button>
            </div>
          ) : null}

          <div className="blk">
            <div className="blk-head">
              <b>Must-have checks</b>
              <span className="label">How Aditi confirms each must-have on the call</span>
            </div>
            {body.must_have_checks.length ? (
              <ul className="edit">
                {body.must_have_checks.map((m, i) => (
                  <li key={m.id} className="faq">
                    <div className="faq-top">
                      <input
                        value={m.text}
                        aria-label={`Must-have ${i + 1}`}
                        maxLength={300}
                        onChange={(e) => setBody({ ...body, must_have_checks: body.must_have_checks.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })}
                      />
                      {editable ? (
                        <button
                          type="button"
                          className="x"
                          aria-label={`Remove ${m.text || "must-have check"}`}
                          onClick={() => setBody({ ...body, must_have_checks: body.must_have_checks.filter((_, j) => j !== i) })}
                        >
                          <IconX />
                        </button>
                      ) : null}
                    </div>
                    <input
                      value={m.check}
                      aria-label={`How to check must-have ${i + 1}`}
                      placeholder="How to check it on a call"
                      maxLength={300}
                      onChange={(e) => setBody({ ...body, must_have_checks: body.must_have_checks.map((x, j) => (j === i ? { ...x, check: e.target.value } : x)) })}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="label">No must-have checks. Must-haves you add to the rubric are checked anyway.</p>
            )}
            {editable && body.must_have_checks.length < 20 ? (
              <div className="addrow">
                <button
                  type="button"
                  className="btn2 sm"
                  onClick={() => setBody({ ...body, must_have_checks: [...body.must_have_checks, { id: nextId("mh", taken), text: "", check: "" }] })}
                >
                  Add check
                </button>
              </div>
            ) : null}
          </div>

          <div className="blk">
            <details className="rp-qualities">
              <summary>
                <b>Levels for each quality</b>
                <span className="label">
                  {Object.keys(body.quality_anchors).length} qualities · written for this job, used to score skills, experience, culture fit and the rest
                </span>
              </summary>
              <ul className="rp-list" style={{ marginTop: 12 }}>
                {Object.entries(body.quality_anchors).map(([key, q]) => (
                  <li key={key}>
                    <details className="rp-item">
                      <summary>
                        <span className="rp-title">{q.name}</span>
                        <span className="label rp-meta">{q.question ? "Has its own question" : "Judged across the call"}</span>
                      </summary>
                      <div className="rp-fields">
                        <div className="f">
                          <label htmlFor={`qa-q-${key}`}>Question Aditi asks (optional)</label>
                          <input
                            id={`qa-q-${key}`}
                            value={q.question}
                            maxLength={300}
                            onChange={(e) => setBody({ ...body, quality_anchors: { ...body.quality_anchors, [key]: { ...q, question: e.target.value } } })}
                          />
                        </div>
                        <AnchorEditor
                          idBase={`qa-a-${key}`}
                          anchors={q.anchors}
                          onChange={(lvl, v) => setBody({ ...body, quality_anchors: { ...body.quality_anchors, [key]: { ...q, anchors: { ...q.anchors, [lvl]: v } } } })}
                        />
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            </details>
          </div>

          {editable && dirty ? <p className="label rp-dirty">Unsaved changes · saving creates version {(saved?.version ?? 0) + 1}</p> : null}
        </fieldset>
      )}
    </section>
  );
}

const FIELD_NAME: Record<string, string> = {
  text: "the wording",
  check: "how to check it",
  question: "the question",
  probe: "the follow-up",
  evidence_hint: "what a good answer contains",
  name: "the name",
};

/** "requirements.0.anchors.3: Too small…" → "Requirement 1 (“…”): level 3 can't be empty." */
function plainError(err: string, body: RoleProfileBody): string {
  const m = /^(requirements|must_have_checks|quality_anchors)\.([^.:]+)(?:\.([^.:]+))?(?:\.([^.:]+))?:\s*(.*)$/.exec(err);
  if (!m) return err;
  const [, group, idx, field, sub, why] = m;
  const empty = /too small|>=1|required/i.test(why);
  const what = field === "anchors" && sub ? `level ${sub}` : FIELD_NAME[field ?? ""] ?? (field ? field.replace(/_/g, " ") : "it");
  const problem = empty ? `${what} can't be empty` : `${what}: ${why.toLowerCase()}`;
  if (group === "requirements") {
    const r = body.requirements[Number(idx)];
    return `Requirement ${Number(idx) + 1}${r?.text ? ` (“${r.text}”)` : ""}: ${problem}.`;
  }
  if (group === "must_have_checks") return `Must-have check ${Number(idx) + 1}: ${problem}.`;
  const q = body.quality_anchors[idx];
  return `${q?.name ?? idx}: ${problem}.`;
}

function AnchorEditor({ idBase, anchors, onChange }: { idBase: string; anchors: Anchors; onChange: (lvl: (typeof LEVELS)[number], v: string) => void }) {
  return (
    <div className="rp-anchors" role="group" aria-label="What each level looks like">
      <span className="flabel">What each level sounds like on the call</span>
      {LEVELS.map((lvl) => (
        <div key={lvl} className="rp-anchor">
          <label htmlFor={`${idBase}-${lvl}`}>
            <span className="num">{lvl}</span>
            <span className="label">{LEVEL_HINT[lvl]}</span>
          </label>
          <textarea id={`${idBase}-${lvl}`} value={anchors[lvl]} maxLength={300} rows={1} onChange={(e) => onChange(lvl, e.target.value)} />
        </div>
      ))}
    </div>
  );
}
