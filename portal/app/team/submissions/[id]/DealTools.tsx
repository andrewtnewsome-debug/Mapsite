"use client";

import OnePagerStudio, { type OnePagerEnv } from "../../../components/OnePagerStudio";
import IntroEmail, { type IntroEnv } from "../../../components/IntroEmail";
import { persistOnePager } from "../../actions";
import type { ProviderMatch } from "@/lib/matching";
import type { Submission } from "@/lib/types";

const loadJsPdf = async () => (await import("jspdf")).jsPDF;
const loadDocx = () => import("docx");

async function logoDataUrl() {
  const blob = await (await fetch("/maplab-logo.png")).blob();
  return new Promise<string | null>((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => resolve(null);
    r.readAsDataURL(blob);
  });
}

async function saveFile(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function NextOnePager({ s, aiEnabled }: { s: Submission; aiEnabled: boolean }) {
  const env: OnePagerEnv = {
    writeWithClaude: aiEnabled
      ? async (deal, opts) => {
          const res = await fetch("/api/onepager", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: deal.id, ...opts }) });
          const data = await res.json().catch(() => null);
          if (!res.ok) throw new Error(data?.message ?? "Claude couldn't write the one-pager.");
          return data;
        }
      : null,
    loadJsPdf,
    loadDocx,
    logoSrc: "/maplab-logo.png",
    logoDataUrl,
    saveFile,
    persist: (p) => persistOnePager(s.id, p),
  };
  return <OnePagerStudio s={s} env={env} />;
}

// No Gmail connector on the server version yet: copy, or open the email app.
const introEnv: IntroEnv = { loadJsPdf, logoDataUrl, gmailDraft: null, mailto: true };

export function NextIntroEmail({ s, m }: { s: Submission; m: ProviderMatch }) {
  return <IntroEmail s={s} m={m} env={introEnv} />;
}
