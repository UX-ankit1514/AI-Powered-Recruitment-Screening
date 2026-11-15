/**
 * Browser-side text extraction for job descriptions (PDF, Word .docx, plain text), as in /demo.
 * pdf.js and mammoth load on demand from cdnjs (pinned versions) so they never touch the main bundle.
 * The file never leaves the browser; only the extracted text goes into the form.
 */
const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";
const MAMMOTH = "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js";
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_PDF_PAGES = 15;

type PdfJs = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (src: { data: ArrayBuffer }) => {
    promise: Promise<{ numPages: number; getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: { str?: string }[] }> }> }>;
  };
};
type Mammoth = { extractRawText: (o: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }> };

const loaded = new Map<string, Promise<void>>();
function loadScript(src: string): Promise<void> {
  let p = loaded.get(src);
  if (!p) {
    p = new Promise<void>((ok, bad) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.crossOrigin = "anonymous";
      s.onload = () => ok();
      s.onerror = () => {
        loaded.delete(src);
        bad(new Error("Could not load the file reader. Check your connection and try again."));
      };
      document.head.appendChild(s);
    });
    loaded.set(src, p);
  }
  return p;
}

export async function extractText(file: File): Promise<string> {
  if (file.size > MAX_BYTES) throw new Error("That file is over 10 MB. Paste the text instead.");
  const name = file.name.toLowerCase();
  if (/\.(txt|md)$/.test(name)) return file.text();
  if (name.endsWith(".pdf")) {
    await loadScript(`${PDFJS}pdf.min.js`);
    const lib = (window as unknown as { pdfjsLib: PdfJs }).pdfjsLib;
    lib.GlobalWorkerOptions.workerSrc = `${PDFJS}pdf.worker.min.js`;
    const doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages: Promise<string>[] = [];
    for (let i = 1; i <= Math.min(doc.numPages, MAX_PDF_PAGES); i++) {
      pages.push(
        doc
          .getPage(i)
          .then((pg) => pg.getTextContent())
          .then((tc) => tc.items.map((it) => it.str ?? "").join(" ")),
      );
    }
    return (await Promise.all(pages)).join("\n\n");
  }
  if (name.endsWith(".docx")) {
    await loadScript(MAMMOTH);
    const mammoth = (window as unknown as { mammoth: Mammoth }).mammoth;
    const r = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return r.value;
  }
  throw new Error("Upload a PDF, Word (.docx) or text file.");
}

/** Collapse runs of blank space that PDF extraction leaves behind. */
export function tidy(text: string) {
  return text
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
