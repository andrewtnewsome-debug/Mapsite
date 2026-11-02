"use client";

import { useEffect, useRef, useState } from "react";
import type { jsPDF } from "jspdf";
import type * as Docx from "docx";
import { defaultCodeName, leaksIdentity } from "@/lib/anonymize";
import { applyClaudeText, draftOnePager, noDash, onePagerPrompt } from "@/lib/onepager";
import { buildOnePagerPdf, onePagerFileName } from "@/lib/onepagerPdf";
import { buildOnePagerDocx, onePagerWordName } from "@/lib/onepagerDocx";
import { chartSvg } from "@/lib/chartSvg";
import { dateTime } from "@/lib/format";
import type { OnePager, OnePagerChart, Submission } from "@/lib/types";

/**
 * The lender one-pager editor on the deal page. Shared by both versions of the app; what
 * differs (asking Claude, making and saving the PDF, persisting) comes in through `env`.
 */
export interface OnePagerEnv {
  /** Asks Claude for the one-pager text; resolves with the parsed JSON reply. Null hides the button. */
  writeWithClaude: ((s: Submission, opts: { blind: boolean; codeName: string }, prompt: string) => Promise<unknown>) | null;
  loadJsPdf: () => Promise<typeof jsPDF>;
  loadDocx: () => Promise<typeof Docx>;
  logoSrc: string;
  logoDataUrl: () => Promise<string | null>;
  saveFile: (filename: string, blob: Blob) => Promise<void>;
  persist: (p: OnePager) => void | Promise<void>;
}

function ChartSvg({ chart }: { chart: OnePagerChart }) {
  return <div className="op-chart" role="img" aria-label={chart.title} dangerouslySetInnerHTML={{ __html: chartSvg(chart) }} />;
}

/** An on-screen replica of the PDF page, scaled to fit its container. */
export function OnePagerPreview({ p, logoSrc }: { p: OnePager; logoSrc: string }) {
  const outer = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = outer.current;
    if (!el) return;
    const fit = () => setScale(Math.min(1, el.clientWidth / 612));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={outer} className="op-outer" style={{ height: 792 * scale }}>
      <div className="op-page" style={{ transform: `scale(${scale})` }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoSrc} alt="MAP Lab Center" className="op-logo" />
        <div className="op-rule" />
        <p className="op-ask">{p.capitalAsk}</p>
        <h4 className="op-h">Company Overview</h4>
        <ul className="op-list">{p.overview.map((t, i) => <li key={i}>{t}</li>)}</ul>
        <h4 className="op-h">Financial Highlights</h4>
        <ul className="op-list">{p.highlights.map((h, i) => <li key={i}><b>{h.bold}:</b> {h.text}</li>)}</ul>
        {p.charts.length > 0 && <div className={`op-charts n${Math.min(p.charts.length, 2)}`}>{p.charts.slice(0, 2).map((c) => <ChartSvg key={c.title} chart={c} />)}</div>}
        {p.footnotes.map((f, i) => <p key={i} className="op-foot">{f}</p>)}
        <p className="op-disc">{p.disclaimer}</p>
      </div>
    </div>
  );
}

const toLines = (text: string) => text.split("\n").map((l) => noDash(l.trim())).filter(Boolean);
const toHighlights = (text: string) =>
  toLines(text).map((l) => {
    const i = l.indexOf(":");
    return i > 0 ? { bold: l.slice(0, i).trim(), text: l.slice(i + 1).trim() } : { bold: l, text: "" };
  });

export default function OnePagerStudio({ s, env }: { s: Submission; env: OnePagerEnv }) {
  const [open, setOpen] = useState(false);
  const [p, setP] = useState<OnePager>(() => s.onePager ?? draftOnePager(s, { blind: true }));
  const [codeName, setCodeName] = useState(() => s.onePager?.codeName ?? defaultCodeName(s));
  const [busy, setBusy] = useState<"" | "claude" | "pdf" | "word">("");
  const [message, setMessage] = useState<{ tone: "ok" | "error" | "info"; text: string } | null>(null);
  const saved = s.onePager;

  function rebuild(blind: boolean, name = codeName) {
    setP(draftOnePager(s, { blind, codeName: name }));
    setMessage({ tone: "info", text: "Rebuilt from the deal data. Your edits were replaced." });
  }

  /** Swaps the old code name for the new one everywhere, keeping the team's edits. */
  function renameCode(next: string) {
    const name = next.trim();
    if (!name || name === p.codeName) return;
    const swap = (t: string) => t.split(p.codeName).join(name);
    setP({
      ...p,
      codeName: name,
      displayName: name,
      capitalAsk: swap(p.capitalAsk),
      overview: p.overview.map(swap),
      highlights: p.highlights.map((h) => ({ bold: swap(h.bold), text: swap(h.text) })),
      savedAt: new Date().toISOString(),
    });
  }

  async function writeWithClaude() {
    if (!env.writeWithClaude) return;
    setBusy("claude");
    setMessage({ tone: "info", text: "Claude is writing the one-pager. This usually takes under a minute…" });
    try {
      const base = draftOnePager(s, { blind: p.blind, codeName });
      const raw = await env.writeWithClaude(s, { blind: p.blind, codeName }, onePagerPrompt(s, { blind: p.blind, codeName }));
      const next = applyClaudeText(raw, base, s);
      setP(next);
      setMessage(next.writtenBy === "claude" ? { tone: "ok", text: "Claude wrote the text. Charts use the reported figures only. Review before saving." } : { tone: "error", text: "Claude's answer was incomplete, so the data-built version is shown." });
    } catch (e) {
      setMessage({ tone: "error", text: e instanceof Error ? e.message : "Claude couldn't write the one-pager. The data-built version is still here." });
    } finally {
      setBusy("");
    }
  }

  async function download(which: OnePager, format: "pdf" | "word" = "pdf") {
    setBusy(format);
    const name = format === "pdf" ? onePagerFileName(which) : onePagerWordName(which);
    try {
      const logo = await env.logoDataUrl();
      const blob = format === "pdf" ? await buildOnePagerPdf(await env.loadJsPdf(), which, logo) : await buildOnePagerDocx(await env.loadDocx(), which, logo);
      await env.saveFile(name, blob);
      setMessage({ tone: "ok", text: `Saved ${name}.` });
    } catch (e) {
      setMessage({ tone: "error", text: e instanceof Error ? e.message : `The ${format === "pdf" ? "PDF" : "Word file"} couldn't be saved.` });
    } finally {
      setBusy("");
    }
  }

  async function save() {
    const next = { ...p, savedAt: new Date().toISOString() };
    await env.persist(next);
    setP(next);
    setMessage({ tone: "ok", text: next.blind ? `Saved. Intro emails can now attach this blind teaser as ${next.codeName}.` : "Saved. Intro emails attach only blind teasers, so turn on Blind teaser for that." });
  }

  const leaks = p.blind && leaksIdentity([p.capitalAsk, ...p.overview, ...p.highlights.map((h) => `${h.bold} ${h.text}`), ...p.footnotes].join(" "), s);

  if (!open) {
    return (
      <div className="card panel">
        <div className="panel-head">
          <h2>Lender one-pager</h2>
          {saved && <span className={`badge ${saved.blind ? "Strong" : "Possible"}`}>{saved.blind ? `Blind · ${saved.codeName}` : "Names the company"}</span>}
        </div>
        <p className="small-gray">
          {saved
            ? `Saved ${dateTime(saved.savedAt)}${saved.writtenBy === "claude" ? ", written with Claude" : ""}.`
            : "Build the MAP Lab Center teaser for lenders and investors from this deal's form and CIM: capital ask, company overview, financial highlights and charts."}
        </p>
        <div className="op-actions">
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>{saved ? "Edit one-pager" : "Create one-pager"}</button>
          {saved && <button type="button" className="btn btn-secondary btn-sm" disabled={busy === "pdf"} onClick={() => download(saved)}>{busy === "pdf" ? "Making PDF…" : "Download PDF"}</button>}
          {saved && <button type="button" className="btn btn-secondary btn-sm" disabled={busy === "word"} onClick={() => download(saved, "word")}>{busy === "word" ? "Making Word file…" : "Download Word"}</button>}
        </div>
        {message && <p className={`op-msg ${message.tone}`}>{message.text}</p>}
      </div>
    );
  }

  return (
    <div className="card panel op-studio">
      <div className="panel-head">
        <h2>Lender one-pager</h2>
        <button type="button" className="link-quiet" onClick={() => setOpen(false)}>Close</button>
      </div>

      <div className="op-controls">
        <label className="check" htmlFor="op-blind">
          <input id="op-blind" type="checkbox" checked={p.blind} onChange={(e) => rebuild(e.target.checked)} />
          <span>Blind teaser<small>Uses a code name and hides the company name, city, website and people.</small></span>
        </label>
        {p.blind && (
          <div className="field">
            <label htmlFor="op-code">Code name</label>
            <input id="op-code" type="text" value={codeName} onChange={(e) => setCodeName(e.target.value)} onBlur={() => renameCode(codeName)} />
          </div>
        )}
      </div>

      <div className="op-actions">
        {env.writeWithClaude && (
          <button type="button" className="btn btn-primary btn-sm" disabled={!!busy} onClick={writeWithClaude}>{busy === "claude" ? "Writing…" : "Write with Claude"}</button>
        )}
        <button type="button" className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => rebuild(p.blind)}>Rebuild from deal data</button>
        <button type="button" className="btn btn-secondary btn-sm" disabled={!!busy} onClick={save}>Save</button>
        <button type="button" className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => download(p)}>{busy === "pdf" ? "Making PDF…" : "Download PDF"}</button>
        <button type="button" className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => download(p, "word")}>{busy === "word" ? "Making Word file…" : "Download Word"}</button>
      </div>
      {message && <p className={`op-msg ${message.tone}`} role="status">{message.text}</p>}
      {leaks && <p className="op-msg error">This text may still identify the company. Check the name, owners and places before sending.</p>}
      {p.blind && !leaks && <p className="muted small">Blind mode removes names, websites, cities, counties and the state. Read it once for anything else that could identify the business.</p>}

      <div className="op-grid">
        <div className="op-edit">
          <div className="field">
            <label htmlFor="op-ask">Capital ask (lead with amount and type)</label>
            <textarea id="op-ask" value={p.capitalAsk} onChange={(e) => setP({ ...p, capitalAsk: noDash(e.target.value) })} rows={3} />
          </div>
          <div className="field">
            <label htmlFor="op-overview">Company overview, one bullet per line</label>
            <textarea id="op-overview" defaultValue={p.overview.join("\n")} key={`o-${p.savedAt}`} onChange={(e) => setP({ ...p, overview: toLines(e.target.value) })} rows={7} />
          </div>
          <div className="field">
            <label htmlFor="op-highlights">Financial highlights, one per line as &quot;Lead-in: text&quot;</label>
            <textarea id="op-highlights" defaultValue={p.highlights.map((h) => `${h.bold}: ${h.text}`).join("\n")} key={`h-${p.savedAt}`} onChange={(e) => setP({ ...p, highlights: toHighlights(e.target.value) })} rows={7} />
          </div>
          <p className="muted small">Charts come from reported figures only{s.cim?.history?.length ? " (the CIM's financial table)" : " (prior year and LTM revenue; upload a CIM for more years)"}.</p>
        </div>
        <OnePagerPreview p={p} logoSrc={env.logoSrc} />
      </div>
    </div>
  );
}
