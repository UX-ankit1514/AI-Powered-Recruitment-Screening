import type { DB } from "./http";

export const RESUME_BUCKET = "resumes";
export const MAX_RESUME_BYTES = 10 * 1024 * 1024;

const TYPES: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  txt: "text/plain",
};

export function resumeExt(name: string): string | null {
  const m = /\.([a-z0-9]+)$/i.exec(name.trim());
  const ext = m?.[1]?.toLowerCase();
  return ext && ext in TYPES ? ext : null;
}

/** Checks extension and the file's magic bytes (a .pdf must really be a PDF, etc.). */
export async function checkResumeFile(file: File): Promise<{ ok: true; ext: string } | { ok: false; reason: string }> {
  const ext = resumeExt(file.name);
  if (!ext) return { ok: false, reason: "resume must be PDF, Word or text" };
  if (file.size === 0) return { ok: false, reason: "resume file is empty" };
  if (file.size > MAX_RESUME_BYTES) return { ok: false, reason: "resume is over 10 MB" };
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const starts = (...b: number[]) => b.every((v, i) => head[i] === v);
  if (ext === "pdf" && !starts(0x25, 0x50, 0x44, 0x46)) return { ok: false, reason: "file is not a real PDF" };
  if (ext === "docx" && !starts(0x50, 0x4b)) return { ok: false, reason: "file is not a real Word document" };
  if (ext === "doc" && !starts(0xd0, 0xcf, 0x11, 0xe0)) return { ok: false, reason: "file is not a real Word document" };
  return { ok: true, ext };
}

/** Text of a .txt resume (PDF/DOCX text is extracted in the browser and sent alongside). */
export async function plainText(file: File): Promise<string | null> {
  if (resumeExt(file.name) !== "txt") return null;
  const t = (await file.text()).replace(/\u0000/g, "").trim();
  return t ? t.slice(0, 20_000) : null;
}

export function resumePath(companyId: string, jobId: string, candidateId: string, ext: string) {
  return `${companyId}/${jobId}/${candidateId}/resume.${ext}`;
}

export async function uploadResume(db: DB, path: string, file: File, ext: string) {
  const { error } = await db.storage.from(RESUME_BUCKET).upload(path, file, {
    contentType: TYPES[ext],
    upsert: true,
  });
  return !error;
}
