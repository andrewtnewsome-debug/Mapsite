import type { jsPDF } from "jspdf";
import type * as Docx from "docx";
import type { OnePagerEnv } from "portal/app/components/OnePagerStudio";
import type { IntroEnv } from "portal/app/components/IntroEmail";
import { loadScript, SAMPLE_ERRORS } from "./cim-browser";

/** What this view of the link can do: ask Claude, save files, and write Gmail drafts. Each may be absent. */

declare const React: typeof import("react");
declare const LOGO: string;

interface Sample { json(input: string, options?: { modelTier?: "default" | "complex" | "quick" }): Promise<unknown> }
interface Downloads { save(req: { filename: string; data: Blob }): Promise<unknown> }
interface Mcp { callTool(server: string, tool: string, input?: unknown): Promise<{ payload?: unknown }> }

let caps: { sample: Sample | null; downloads: Downloads | null; mcp: Mcp | null } = { sample: null, downloads: null, mcp: null };
const listeners = new Set<() => void>();
let started = false;

function start() {
  if (started) return;
  started = true;
  const use = (name: string) => window.claude?.use(name).catch(() => null) ?? Promise.resolve(null);
  Promise.all([use("sample"), use("downloads"), use("mcp")]).then(([sample, downloads, mcp]) => {
    caps = { sample: sample as Sample | null, downloads: downloads as Downloads | null, mcp: mcp as Mcp | null };
    listeners.forEach((l) => l());
  });
}

const JSPDF = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
async function loadJsPdf(): Promise<typeof jsPDF> {
  await loadScript(JSPDF);
  const lib = (window as unknown as { jspdf?: { jsPDF: typeof jsPDF } }).jspdf;
  if (!lib) throw new Error("The PDF maker couldn't load. Check your connection and try again.");
  return lib.jsPDF;
}

const DOCX = "https://cdn.jsdelivr.net/npm/docx@9.0.2/build/index.umd.js";
async function loadDocx(): Promise<typeof Docx> {
  await loadScript(DOCX);
  const lib = (window as unknown as { docx?: typeof Docx }).docx;
  if (!lib) throw new Error("The Word maker couldn't load. Check your connection and try again.");
  return lib;
}

const DOWNLOAD_ERRORS: Record<string, string> = {
  declined: "Download cancelled.",
  rate_limited: "Another save is waiting for your answer. Finish that one, then try again.",
};

const GMAIL_ERRORS: Record<string, string> = {
  server_not_connected: "Gmail isn't connected. Add it in claude.ai Settings, Connectors, then try again.",
  needs_reauth: "Gmail needs reconnecting in claude.ai Settings, Connectors.",
  not_in_manifest: "Gmail isn't allowed for this page. Allow it from the page's permissions, or copy the email instead.",
  approval_required: "Saving to Gmail needs your approval. Try again and choose Allow.",
  blocked_by_policy: "Your organization doesn't allow Gmail here. Copy the email instead.",
};

const codeOf = (e: unknown) => (e as { code?: string })?.code ?? "";

function buildEnv() {
  const { sample, downloads, mcp } = caps;
  const onePager: Omit<OnePagerEnv, "persist"> = {
    writeWithClaude: sample
      ? async (_s, _opts, prompt) => {
          try {
            return await sample.json(prompt, { modelTier: "default" });
          } catch (e) {
            throw new Error(SAMPLE_ERRORS[codeOf(e)] ?? "Claude couldn't write the one-pager. The data-built version is still here.");
          }
        }
      : null,
    loadJsPdf,
    loadDocx,
    logoSrc: LOGO,
    logoDataUrl: async () => LOGO,
    saveFile: async (filename, blob) => {
      if (!downloads) throw new Error("Downloads aren't available in this view of the page.");
      try {
        await downloads.save({ filename, data: blob });
      } catch (e) {
        throw new Error(DOWNLOAD_ERRORS[codeOf(e)] ?? "The PDF couldn't be saved here.");
      }
    },
  };
  const intro: IntroEnv = {
    loadJsPdf,
    logoDataUrl: async () => LOGO,
    mailto: false,
    gmailDraft: mcp
      ? async (email, attachment) => {
          const to = email.to.filter((a) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a));
          try {
            const res = await mcp.callTool("Gmail", "create_draft", {
              ...(to.length ? { to } : {}),
              subject: email.subject,
              body: email.body,
              ...(attachment ? { attachments: [{ content: attachment.base64, filename: attachment.filename, mimeType: "application/pdf" }] } : {}),
            });
            const payload = res.payload as { viewUrl?: unknown } | undefined;
            return typeof payload?.viewUrl === "string" ? payload.viewUrl : null;
          } catch (e) {
            const code = codeOf(e);
            throw new Error(GMAIL_ERRORS[code] ?? `The Gmail draft couldn't be saved${code ? ` (${code})` : ""}. Copy the email instead.`);
          }
        }
      : null,
  };
  return { onePager, intro };
}

/** Re-renders once the page learns what this view can do. */
export function useLinkEnv() {
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    start();
    const l = () => setTick((t) => t + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return buildEnv();
}
