import { CIM_INSTRUCTIONS, normalizeCim } from "portal/lib/cim";
import type { ReadCim } from "portal/app/apply/ApplyForm";

/** The `sample` capability: asks Claude on the viewer's own account. */
interface Sample {
  json(input: string, options?: { modelTier?: "default" | "complex" | "quick" }): Promise<unknown>;
}

const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";
// Claude reads at most 256 KiB per request, and every byte counts against the viewer's usage,
// so send about 150 KB: the opening pages plus the pages most likely to hold the figures.
const TEXT_BUDGET = 150_000;
const ALWAYS_PAGES = 3;
const RELEVANT = /revenue|ebitda|adjusted|sales|margin|customer|employees|founded|headquarter|transaction|valuation|asking|seller|purchase|debt|\$\s?\d/gi;

/** A failure the upload box shows; `detail` is the platform's own explanation, shown small. */
export class CimError extends Error {
  constructor(message: string, readonly detail?: string) {
    super(message);
  }
}

/** "1-3, 5, 9-12" */
function pageRanges(pages: number[]): string {
  const out: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    let j = i;
    while (j + 1 < pages.length && pages[j + 1] === pages[j] + 1) j++;
    out.push(i === j ? `${pages[i]}` : `${pages[i]}-${pages[j]}`);
    i = j;
  }
  return out.join(", ");
}

declare global {
  interface Window { pdfjsLib?: { getDocument(src: { data: Uint8Array }): { promise: Promise<PdfDoc> } } }
}
interface PdfDoc { numPages: number; getPage(n: number): Promise<{ getTextContent(): Promise<{ items: { str?: string; hasEOL?: boolean }[] }> }> }

export function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const el = document.createElement("script");
    el.src = src;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error("The PDF reader couldn't load. Check your connection and try again."));
    document.head.appendChild(el);
  });
}

/** Loaded on first use. The worker script runs on the page itself (pdf.js's main-thread mode). */
async function pdfjs() {
  await loadScript(PDFJS + "pdf.min.js");
  await loadScript(PDFJS + "pdf.worker.min.js");
  if (!window.pdfjsLib) throw new Error("The PDF reader couldn't load. Try again.");
  return window.pdfjsLib;
}

export const SAMPLE_ERRORS: Record<string, string> = {
  not_granted: "Claude wasn't allowed to run on this page, so the CIM can't be read. Fill in the form by hand.",
  sampling_disabled: "Claude isn't available on this account, so the CIM can't be read. Fill in the form by hand.",
  rate_limited: "Claude is limiting requests right now: either your plan's usage limit or too many requests at once (for example, this page open in two places). Wait a few minutes and try again, or fill in the form by hand.",
  prompt_too_large: "That document is too long to read in one pass. Upload a shorter version, such as the teaser.",
  invalid_json: "Claude's answer couldn't be read. Try uploading again.",
  refused: "Claude couldn't read this document. Fill in the form by hand.",
  session_expired: "Your Claude session expired. Sign in again, then retry the upload.",
};

export function makeCimReader(sample: Sample): ReadCim {
  return async (file, progress) => {
    if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) {
      throw new CimError("Upload the CIM as a PDF. Save Word or PowerPoint files as PDF first.");
    }
    if (file.size > 30 * 1024 * 1024) throw new CimError("That file is over 30 MB. Upload a smaller copy of the CIM.");

    progress("Opening the PDF…");
    const lib = await pdfjs();
    let doc: PdfDoc;
    try {
      doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    } catch {
      throw new CimError("This PDF couldn't be opened. It may be password-protected or damaged.");
    }

    // Read every page, then send the opening pages and the most figure-heavy ones, in page order.
    const pages: { n: number; text: string; score: number }[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const content = await (await doc.getPage(i)).getTextContent();
      const text = content.items.map((it) => (it.str ?? "") + (it.hasEOL ? "\n" : " ")).join("").replace(/[ \t]+/g, " ").trim();
      pages.push({ n: i, text, score: i <= ALWAYS_PAGES ? Infinity : (text.match(RELEVANT)?.length ?? 0) });
      if (i % 10 === 0) progress(`Reading page ${i} of ${doc.numPages}…`);
    }
    if (pages.reduce((n, p) => n + p.text.length, 0) < 200) {
      throw new CimError("This PDF has almost no text, so it is probably scanned images. Fill in the form by hand.");
    }
    const encoder = new TextEncoder();
    const chosen: typeof pages = [];
    let bytes = 0;
    for (const p of [...pages].sort((a, b) => b.score - a.score || a.n - b.n)) {
      const size = encoder.encode(p.text).length + 16;
      if (bytes + size > TEXT_BUDGET) continue;
      chosen.push(p);
      bytes += size;
    }
    chosen.sort((a, b) => a.n - b.n);
    const text = chosen.map((p) => `\n\n[Page ${p.n}]\n${p.text}`).join("");
    const pagesRead = chosen.length;

    progress("Claude is reading the CIM. This usually takes one to two minutes…");
    const header =
      `Document: ${file.name}, ${doc.numPages} pages.` +
      (pagesRead < doc.numPages ? ` Included pages: ${pageRanges(chosen.map((p) => p.n))} (the opening pages and those with the most figures).` : "");
    let raw: unknown;
    try {
      raw = await sample.json(`${CIM_INSTRUCTIONS}\n\n${header}\n<document>${text}\n</document>`, { modelTier: "default" });
    } catch (e) {
      const { code = "", message = "" } = (e ?? {}) as { code?: string; message?: string };
      throw new CimError(
        SAMPLE_ERRORS[code] ?? "Claude couldn't finish reading the CIM. Try again, or fill in the form by hand.",
        [code, message].filter(Boolean).join(": "),
      );
    }
    return normalizeCim(raw, { fileName: file.name, pageCount: doc.numPages, pagesRead });
  };
}
