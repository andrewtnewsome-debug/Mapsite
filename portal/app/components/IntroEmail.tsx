"use client";

import { useState } from "react";
import type { jsPDF } from "jspdf";
import { draftIntroEmail, type IntroEmail as Email } from "@/lib/intro";
import { buildOnePagerPdf, onePagerFileName } from "@/lib/onepagerPdf";
import type { ProviderMatch } from "@/lib/matching";
import type { Submission } from "@/lib/types";

/** "Draft intro email" on a matched provider. Shared by both versions; delivery comes in through `env`. */
export interface IntroEnv {
  loadJsPdf: () => Promise<typeof jsPDF>;
  logoDataUrl: () => Promise<string | null>;
  /** Saves the email to the viewer's Gmail drafts; resolves with the draft's link when known. Null hides the button. */
  gmailDraft: ((email: Email, attachment: { filename: string; base64: string } | null) => Promise<string | null>) | null;
  /** Whether a mailto: link works in this view (it often doesn't inside an artifact). */
  mailto: boolean;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => reject(new Error("The one-pager couldn't be attached."));
    r.readAsDataURL(blob);
  });
}

export default function IntroEmail({ s, m, env }: { s: Submission; m: ProviderMatch; env: IntroEnv }) {
  const teaser = s.onePager?.blind ? s.onePager : null;
  const [open, setOpen] = useState(false);
  const [attach, setAttach] = useState(!!teaser);
  const [email, setEmail] = useState<Email>(() => draftIntroEmail(s, m, { onePagerAttached: !!teaser }));
  const [edited, setEdited] = useState(false);
  const [status, setStatus] = useState<{ tone: "ok" | "error" | "info"; text: string; link?: string | null } | null>(null);
  const [busy, setBusy] = useState(false);

  /** Drafts fresh on every open, so a teaser saved since the page loaded is picked up. */
  function openDraft() {
    setAttach(!!teaser);
    setEmail(draftIntroEmail(s, m, { onePagerAttached: !!teaser }));
    setEdited(false);
    setStatus(null);
    setOpen(true);
  }

  function toggleAttach(on: boolean) {
    setAttach(on);
    // Keep the "attached" sentence in step with the checkbox unless the team has rewritten the email.
    if (!edited) setEmail(draftIntroEmail(s, m, { onePagerAttached: on }));
  }

  async function copy() {
    const text = `Subject: ${email.subject}\n\n${email.body}`;
    try {
      await navigator.clipboard.writeText(text);
      setStatus({ tone: "ok", text: "Copied. Paste it into a new email." });
    } catch {
      const area = document.getElementById(`intro-body-${m.provider.id}`) as HTMLTextAreaElement | null;
      area?.select();
      setStatus({ tone: "info", text: "Copy isn't allowed here; the email text is selected so you can copy it yourself." });
    }
  }

  async function toGmail() {
    if (!env.gmailDraft) return;
    setBusy(true);
    setStatus({ tone: "info", text: attach && teaser ? "Making the one-pager PDF and saving the draft…" : "Saving the draft…" });
    try {
      const attachment = attach && teaser
        ? { filename: onePagerFileName(teaser), base64: await blobToBase64(await buildOnePagerPdf(await env.loadJsPdf(), teaser, await env.logoDataUrl())) }
        : null;
      const link = await env.gmailDraft(email, attachment);
      setStatus({ tone: "ok", text: `Draft saved in Gmail${attachment ? " with the blind one-pager attached" : ""}. Log the introduction once you send it.`, link });
    } catch (e) {
      setStatus({ tone: "error", text: e instanceof Error ? e.message : "The Gmail draft couldn't be saved. Copy the email instead." });
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return <button type="button" className="btn btn-secondary btn-sm" onClick={openDraft}>Draft intro email</button>;
  }

  return (
    <div className="intro">
      <div className="intro-head">
        <strong>Intro email to {m.provider.name.split(" / ")[0]}</strong>
        <span className="badge Strong">Anonymized</span>
        <button type="button" className="link-quiet" onClick={() => setOpen(false)}>Close</button>
      </div>
      <div className="field">
        <label htmlFor={`intro-to-${m.provider.id}`}>To</label>
        <input
          id={`intro-to-${m.provider.id}`}
          type="text"
          placeholder="No contact on file: add the lender's email"
          value={email.to.join(", ")}
          onChange={(e) => setEmail({ ...email, to: e.target.value.split(/[,;\s]+/).filter(Boolean) })}
        />
      </div>
      <div className="field">
        <label htmlFor={`intro-subject-${m.provider.id}`}>Subject</label>
        <input id={`intro-subject-${m.provider.id}`} type="text" value={email.subject} onChange={(e) => { setEdited(true); setEmail({ ...email, subject: e.target.value }); }} />
      </div>
      <div className="field">
        <label htmlFor={`intro-body-${m.provider.id}`}>Email</label>
        <textarea id={`intro-body-${m.provider.id}`} rows={16} value={email.body} onChange={(e) => { setEdited(true); setEmail({ ...email, body: e.target.value }); }} />
      </div>
      <label className="check" htmlFor={`intro-attach-${m.provider.id}`}>
        <input id={`intro-attach-${m.provider.id}`} type="checkbox" checked={attach && !!teaser} disabled={!teaser} onChange={(e) => toggleAttach(e.target.checked)} />
        <span>
          Attach the blind one-pager{teaser ? ` (${teaser.codeName})` : ""}
          <small>{teaser ? "Built from the saved one-pager." : "Save a blind one-pager above to attach it."}</small>
        </span>
      </label>
      <div className="op-actions">
        {env.gmailDraft && (
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={toGmail}>{busy ? "Saving…" : "Save to Gmail drafts"}</button>
        )}
        <button type="button" className="btn btn-secondary btn-sm" onClick={copy}>Copy email</button>
        {env.mailto && (
          <a
            className="btn btn-secondary btn-sm"
            href={`mailto:${email.to.join(",")}?subject=${encodeURIComponent(email.subject)}&body=${encodeURIComponent(email.body)}`}
          >
            Open in email app
          </a>
        )}
      </div>
      {status && (
        <p className={`op-msg ${status.tone}`} role="status">
          {status.text}{" "}
          {status.link && <a href={status.link} target="_blank" rel="noreferrer">Open the draft</a>}
        </p>
      )}
    </div>
  );
}
