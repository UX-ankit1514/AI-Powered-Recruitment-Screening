"use client";

import { useRef, useState } from "react";
import { PhoneVerify } from "@/lib/messaging/phone-verify";
import { SCRIPT_INTEGRITY } from "@/components/jobs/extract-text";

// Resume text is read in the browser (same readers as /demo), so the server stays dependency-free.
// jsDelivr is the only script CDN the CSP allows (see components/jobs/extract-text.ts).
const PDFJS = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/";
const MAMMOTH = "https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js";
const MAX_BYTES = 10 * 1024 * 1024;

type PdfLib = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(src: { data: ArrayBuffer }): {
    promise: Promise<{
      numPages: number;
      getPage(n: number): Promise<{ getTextContent(): Promise<{ items: { str?: string }[] }> }>;
    }>;
  };
};
type Mammoth = { extractRawText(o: { arrayBuffer: ArrayBuffer }): Promise<{ value: string }> };

const loaded: Record<string, Promise<void>> = {};
function loadScript(src: string) {
  loaded[src] ??= new Promise<void>((ok, bad) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.crossOrigin = "anonymous";
    if (SCRIPT_INTEGRITY[src]) s.integrity = SCRIPT_INTEGRITY[src];
    s.onload = () => ok();
    s.onerror = () => {
      delete loaded[src];
      bad(new Error("load"));
    };
    document.head.appendChild(s);
  });
  return loaded[src];
}

async function extractText(file: File): Promise<string> {
  const n = file.name.toLowerCase();
  if (n.endsWith(".txt")) return file.text();
  if (n.endsWith(".pdf")) {
    await loadScript(`${PDFJS}pdf.min.js`);
    const lib = (window as unknown as { pdfjsLib: PdfLib }).pdfjsLib;
    lib.GlobalWorkerOptions.workerSrc = `${PDFJS}pdf.worker.min.js`;
    const doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages: string[] = [];
    for (let i = 1; i <= Math.min(doc.numPages, 10); i++) {
      const tc = await (await doc.getPage(i)).getTextContent();
      pages.push(tc.items.map((it) => it.str ?? "").join(" "));
    }
    return pages.join("\n");
  }
  if (n.endsWith(".docx")) {
    await loadScript(MAMMOTH);
    const m = (window as unknown as { mammoth: Mammoth }).mammoth;
    return (await m.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value;
  }
  return "";
}

type Status = { kind: "idle" | "sending" | "done" } | { kind: "error"; message: string };

const inputCls =
  "h-11 w-full rounded-[10px] border border-line-strong bg-surface px-3.5 text-[15px] outline-none transition-colors placeholder:text-text-3 focus:border-accent";
const labelCls = "mb-1.5 block text-[13px] font-medium text-text-2";

export function ApplyForm({ jobId, company, verification = "off" }: { jobId: string; company: string; verification?: "on" | "dev" | "off" }) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [fileNote, setFileNote] = useState("");
  const resumeText = useRef("");
  const readSeq = useRef(0);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const seq = ++readSeq.current;
    resumeText.current = "";
    if (!file) return setFileNote("");
    if (file.size > MAX_BYTES) {
      e.target.value = "";
      return setFileNote("That file is over 10 MB. Try a smaller copy.");
    }
    setFileNote(`Reading ${file.name}`);
    try {
      const text = (await extractText(file)).replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
      if (seq !== readSeq.current) return;
      resumeText.current = text.slice(0, 20000);
      setFileNote(text.length >= 40 ? `${file.name} attached` : `${file.name} attached. We could not read its text, which is fine.`);
    } catch {
      if (seq === readSeq.current) setFileNote(`${file.name} attached`);
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status.kind === "sending") return;
    const fd = new FormData(e.currentTarget);
    if (resumeText.current) fd.set("resume_text", resumeText.current);
    setStatus({ kind: "sending" });
    try {
      const res = await fetch(`/api/apply/${jobId}`, { method: "POST", body: fd });
      if (res.ok) return setStatus({ kind: "done" });
      const j = (await res.json().catch(() => null)) as { error?: string } | null;
      setStatus({ kind: "error", message: j?.error ?? "Something went wrong. Try again in a minute." });
    } catch {
      setStatus({ kind: "error", message: "Could not reach Pingo. Check your connection and try again." });
    }
  }

  if (status.kind === "done") {
    return (
      <div role="status" className="rounded-md bg-accent-soft px-4 py-4 text-accent-ink">
        <p className="text-[16px] font-semibold">Application received</p>
        <p className="mt-1 text-[14px]">
          Thank you. Aditi, the AI interviewer for {company}, will call you during working hours for a short chat of about 10 minutes.
        </p>
      </div>
    );
  }

  const sending = status.kind === "sending";
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div>
        <label htmlFor="ap-name" className={labelCls}>Full name</label>
        <input id="ap-name" name="name" required maxLength={120} autoComplete="name" className={inputCls} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Messaging: phone field with 6-digit code verification (adds the phone_token field). */}
        <PhoneVerify jobId={jobId} mode={verification} inputCls={inputCls} labelCls={labelCls} />
        <div>
          <label htmlFor="ap-email" className={labelCls}>Email <span className="font-normal text-text-3">(optional)</span></label>
          <input id="ap-email" name="email" type="email" maxLength={320} autoComplete="email" className={inputCls} />
        </div>
      </div>
      <div>
        <label htmlFor="ap-resume" className={labelCls}>Resume <span className="font-normal text-text-3">(PDF, Word or text, optional)</span></label>
        <input
          id="ap-resume"
          name="resume"
          type="file"
          accept=".pdf,.docx,.doc,.txt"
          onChange={onFile}
          className="block w-full text-[13.5px] text-text-2 file:mr-3 file:h-9 file:cursor-pointer file:rounded-[10px] file:border file:border-line-strong file:bg-sunken file:px-3.5 file:font-medium file:text-text hover:file:bg-line"
        />
        <p aria-live="polite" className="mt-1.5 min-h-[18px] text-[12.5px] text-text-3">{fileNote}</p>
      </div>

      {/* Honeypot: hidden from people, filled by bots. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 overflow-hidden">
        <label htmlFor="ap-website">Website</label>
        <input id="ap-website" name="website" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="rounded-md border border-line bg-bg px-4 py-3 text-[13px] leading-relaxed text-text-2">
        <p className="mb-1 font-semibold text-text">How your data is used</p>
        <p>
          {company} uses Pingo to screen applications. If you apply, an AI interviewer will phone you for a short interview.
          The call is recorded and transcribed, and your answers, resume and contact details are used only to assess this
          application. They are shared only with {company}&apos;s hiring team. You can ask the company to delete your data at any time.
        </p>
      </div>
      <label className="flex cursor-pointer items-start gap-2.5 text-[13.5px] text-text-2">
        <input type="checkbox" name="consent" value="true" required className="mt-[3px] size-4 accent-accent" />
        <span>I agree to be called by the AI interviewer and to the use of my data as described above.</span>
      </label>

      {status.kind === "error" ? (
        <p role="alert" className="rounded-md bg-red-bg px-3 py-2 text-[13px] text-red">{status.message}</p>
      ) : null}

      <button
        type="submit"
        disabled={sending}
        className="h-11 rounded-[10px] bg-accent font-semibold text-white transition-colors hover:bg-accent-ink disabled:opacity-60"
      >
        {sending ? "Sending application" : "Apply"}
      </button>
    </form>
  );
}
