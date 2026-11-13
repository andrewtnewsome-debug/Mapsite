import * as store from "./store";
import { makeCimReader, CimError } from "../cim-browser";
import { CAPITAL_TYPE_LABELS, SECTOR_LABELS, US_STATES, USE_OF_FUNDS_LABELS, dateTime, margin, money, multiple, pct, range, shortDate, stateList } from "portal/lib/format";
import { dollars } from "portal/lib/formInput";
import { cimPageFor, parseJsonReply } from "portal/lib/cim";
import type { ProviderMatch } from "portal/lib/matching";
import { evaluateProvider } from "portal/lib/matching";
import {
  DEFAULT_MULTIPLE, OUTREACH_LABELS, PIECE_LABELS, defaultAcquisitionStack, isMatched, matchStack, newDeal, pieceId,
  pieceSubmission, stackLeverage, stackTotal, type Deal, type DealInput, type OutreachStatus, type PieceMatch, type PieceType, type StackPiece,
} from "portal/lib/stack";
import { LENDER_CATEGORIES, LENDER_INSTRUCTIONS, LENDER_TYPES, OWNERSHIP_LABELS, blankLender, lenderFromReply, lenderProblems, parseStates } from "portal/lib/lenders";
import { CimPanel } from "portal/app/components/DealPanels";
import type { CapitalType, CimExtraction, OwnershipRequirement, Provider, UseOfFunds } from "portal/lib/types";

declare const React: typeof import("react");
declare const ReactDOM: typeof import("react-dom/client");
declare const LOGO: string;
const { useState, useEffect, useRef } = React;

declare global {
  interface Window { claude?: { use(name: string): Promise<unknown> } }
}

// ── What this view can do: ask Claude, save files ──
interface Sample { json(input: string, options?: { modelTier?: "default" | "complex" | "quick" }): Promise<unknown> }
interface Downloads { save(req: { filename: string; data: Blob }): Promise<unknown> }
let caps: { sample: Sample | null; downloads: Downloads | null; ready: boolean } = { sample: null, downloads: null, ready: false };
const capListeners = new Set<() => void>();
if (typeof window !== "undefined") {
  const use = (n: string) => window.claude?.use(n).catch(() => null) ?? Promise.resolve(null);
  void Promise.all([use("sample"), use("downloads")]).then(([sample, downloads]) => {
    caps = { sample: sample as Sample | null, downloads: downloads as Downloads | null, ready: true };
    capListeners.forEach((l) => l());
  });
}
function useCaps() {
  const [, tick] = useState(0);
  useEffect(() => {
    const l = () => tick((t) => t + 1);
    capListeners.add(l);
    return () => { capListeners.delete(l); };
  }, []);
  return caps;
}

/** Display names for viewer ids, filled in after render. */
function useNames(ids: (string | null)[]) {
  const [names, setNames] = useState<Record<string, string>>({});
  const key = Array.from(new Set(ids.filter(Boolean))).sort().join(",");
  useEffect(() => {
    let live = true;
    void store.namesFor(key ? key.split(",") : []).then((n) => { if (live) setNames(n); });
    return () => { live = false; };
  }, [key]);
  return (id: string | null) => (id && id === store.myId() ? "You" : (id && names[id]) || "A teammate");
}

// ── Routing: plain #names ──
const dealHash = (id: string) => `#deal-${id.replace(/^deal_/, "")}`;
const lenderHash = (id: string) => `#lender-${id.replace(/^prov_/, "")}`;
const editHash = (id: string) => `#edit-${id.replace(/^prov_/, "")}`;
const go = (hash: string) => { if (location.hash === hash) window.scrollTo(0, 0); else location.hash = hash; };

const commas = (n: number | null | undefined) => (n === null || n === undefined || Number.isNaN(n) ? "" : Math.round(n).toLocaleString("en-US"));
const parseMoney = (s: string): number | null => (s.trim() ? dollars(s) : null);
const plainNumber = (s: string): number | null => {
  const n = Number(s.replace(/[^0-9.]/g, ""));
  return s.trim() && Number.isFinite(n) ? n : null;
};

// ── Shell ──
function Header({ tab }: { tab: "deals" | "lenders" | "new" }) {
  const st = store.getStatus();
  const pill =
    st.mode === "starting" || st.loading ? { cls: "", text: "Connecting…" }
      : st.mode === "local" ? { cls: "warn", text: "Saved in this browser only" }
        : st.readOnly ? { cls: "warn", text: "View only" }
          : st.slow ? { cls: "warn", text: "Reconnecting…" }
            : { cls: "ok", text: "Shared with your team" };
  return (
    <header className="site-header">
      <div className="container">
        <a href="#deals" className="brand" aria-label="Deals">
          <img src={LOGO} alt="MAP Lab Center" />
          <span className="brand-name">Capital Match</span>
        </a>
        <nav className="tool-nav" aria-label="Sections">
          <a href="#deals" className={tab === "deals" ? "active" : ""}>Deals</a>
          <a href="#lenders" className={tab === "lenders" ? "active" : ""}>Lenders</a>
          <a href="#new" className="btn btn-primary btn-sm new-btn">+ New deal</a>
        </nav>
      </div>
      <div className="tool-sub">
        <div className="container">
          <span>Internal · MAPlab team</span>
          <span className={`sync ${pill.cls}`}>{pill.text}</span>
        </div>
      </div>
    </header>
  );
}

function Notice() {
  const st = store.getStatus();
  if (!st.notice) return null;
  return (
    <div className="container">
      <div className="notice" role="status">
        <span>{st.notice}</span>
        <button className="link-quiet" onClick={store.dismissNotice}>Dismiss</button>
      </div>
    </div>
  );
}

function Loading({ what }: { what: string }) {
  return <div className="card empty-state"><p className="muted">Loading the team&apos;s {what}…</p></div>;
}

// ── Deals list ──
function stackLine(d: Deal) {
  return d.pieces.filter((p) => p.amount > 0).map((p) => `${money(p.amount)} ${PIECE_LABELS[p.type].replace(/ \/.*$/, "").toLowerCase()}`).join(" · ");
}

function DealsPage() {
  const [query, setQuery] = useState("");
  const st = store.getStatus();
  const lenders = store.activeLenders();
  const q = query.trim().toLowerCase();
  const rows = store.listDeals()
    .filter((d) => !q || [d.company.name, d.company.city, d.company.state, d.naics.title].join(" ").toLowerCase().includes(q))
    .map((d) => {
      const m = matchStack(d, lenders);
      return { d, confirmed: m.reduce((n, x) => n + x.result.confirmed.length, 0), possible: m.reduce((n, x) => n + x.result.possible.length, 0) };
    });
  const names = useNames(rows.map((r) => r.d.createdBy));
  const total = store.listDeals().length;
  return (
    <div className="container page">
      <div className="page-head">
        <div>
          <h1>Deals</h1>
          <p>Upload a CIM, set the capital stack, and see which lenders and investors to approach for each piece.</p>
        </div>
        <a href="#new" className="btn btn-primary">Upload a CIM</a>
      </div>
      {st.loading ? <Loading what="deals" /> : total === 0 ? (
        <div className="card empty-state">
          <h2>No deals yet</h2>
          <p>Start with a CIM or teaser. Claude reads the company and its financials, and the matching rules check every lender in the list.</p>
          <a href="#new" className="btn btn-primary">Upload the first CIM</a>
        </div>
      ) : (
        <>
          {total > 5 && (
            <div className="search" role="search">
              <input id="deal-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search deals by company, city or industry" aria-label="Search deals" />
            </div>
          )}
          <div className="card table-wrap">
            <table className="data">
              <thead><tr><th>Company</th><th className="num">Revenue</th><th className="num">EBITDA</th><th>Capital stack</th><th className="num">To approach</th><th>Updated</th></tr></thead>
              <tbody>
                {rows.map(({ d, confirmed, possible }) => (
                  <tr key={d.id} className="rowlink" onClick={() => go(dealHash(d.id))}>
                    <td>
                      <a href={dealHash(d.id)} className="name">{d.company.name}</a>
                      <div className="muted">{d.kind === "acquisition" ? "Acquisition" : "Company raise"} · {d.company.city}{d.company.state ? `, ${d.company.state}` : ""}</div>
                    </td>
                    <td className="num">{money(d.financials.revenueLTM)}</td>
                    <td className="num">{money(d.financials.ebitdaLTM)}<div className="muted">{pct(margin(d.financials.revenueLTM, d.financials.ebitdaLTM), 1)}</div></td>
                    <td className="small">{stackLine(d)}</td>
                    <td className="num"><strong>{confirmed}</strong>{possible > 0 && <div className="muted">+{possible} possible</div>}</td>
                    <td className="muted nowrap">{shortDate(d.updatedAt)}<div>{names(d.createdBy)}</div></td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={6} className="empty">No deals match that search.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ── New deal: CIM, then the figures and the deal ──
type Fields = Record<string, string>;
const COMPANY_FIELDS: [key: string, label: string, kind: "text" | "money" | "number" | "state" | "long"][] = [
  ["name", "Company name", "text"], ["city", "City", "text"], ["state", "State", "state"],
  ["yearFounded", "Year founded", "number"], ["employees", "Employees", "number"], ["website", "Website", "text"],
  ["revenueLTM", "Revenue, latest year", "money"], ["revenuePrior", "Revenue, year before", "money"], ["ebitdaLTM", "EBITDA, latest year", "money"],
  ["topCustomerPct", "Largest customer, % of revenue", "number"], ["existingDebt", "Debt outstanding", "money"],
  ["description", "What the company does", "long"],
];

function fieldsFromCim(cim: CimExtraction): Fields {
  const v = cim.values;
  const f: Fields = {
    name: v.companyName ?? "", city: v.city ?? "", state: v.state ?? "", website: v.website ?? "",
    yearFounded: v.yearFounded?.toString() ?? "", employees: v.employees?.toString() ?? "",
    revenueLTM: commas(v.revenueLTM), revenuePrior: commas(v.revenuePrior), ebitdaLTM: commas(v.ebitdaLTM),
    topCustomerPct: v.topCustomerPct?.toString() ?? "", existingDebt: commas(v.existingDebt),
    description: v.description ?? "",
  };
  if (v.askingPrice !== null) f.price = commas(v.askingPrice);
  return f;
}

function CimUpload({ onRead }: { onRead: (cim: CimExtraction) => void }) {
  const { sample, ready } = useCaps();
  const [state, setState] = useState<{ kind: "idle" | "reading" | "error"; text: string; detail?: string }>({ kind: "idle", text: "" });
  const [file, setFile] = useState<File | null>(null);
  const input = useRef<HTMLInputElement>(null);
  async function read(f: File) {
    if (!sample) return;
    setFile(f);
    setState({ kind: "reading", text: "Opening the PDF…" });
    try {
      const cim = await makeCimReader(sample)(f, (text) => setState({ kind: "reading", text }));
      onRead(cim);
    } catch (e) {
      setState({ kind: "error", text: e instanceof Error ? e.message : "The CIM couldn't be read.", detail: e instanceof CimError ? e.detail : undefined });
    }
  }
  const busy = state.kind === "reading";
  return (
    <div
      className={`drop ${busy ? "busy" : ""}`}
      onDragOver={(e) => { e.preventDefault(); }}
      onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f && !busy) void read(f); }}
    >
      <div>
        <h2>Upload the CIM</h2>
        <p>A PDF of the CIM, teaser or management deck. Claude reads the company, the financials and the asking price, with the page each figure came from. Nothing is sent to the company or anyone outside this link.</p>
      </div>
      <input ref={input} id="cim-file" type="file" accept="application/pdf,.pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void read(f); }} />
      {!ready ? <p className="muted">Checking whether Claude can read documents here…</p>
        : !sample ? <p className="muted">Claude can&apos;t read documents in this view of the page. Open the link in Claude, or enter the figures by hand below.</p>
          : (
            <div className="drop-actions">
              <button className="btn btn-primary" disabled={busy} onClick={() => input.current?.click()}>{busy ? "Reading…" : "Choose a PDF"}</button>
              <span className="muted">or drop it here</span>
            </div>
          )}
      {state.kind !== "idle" && (
        <div className={`cim-status ${state.kind === "error" ? "error" : "reading"}`} role="status">
          {state.text}
          {state.kind === "error" && file && (
            <div className="cim-retry">
              <button className="btn btn-secondary btn-sm" onClick={() => void read(file)}>Try again</button>
              {state.detail && <span className="muted">{state.detail}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NewDealPage() {
  const [cim, setCim] = useState<CimExtraction | null>(null);
  const [manual, setManual] = useState(false);
  const [f, setF] = useState<Fields>({});
  const [kind, setKind] = useState<Deal["kind"]>("acquisition");
  const [raiseType, setRaiseType] = useState<CapitalType>("senior_debt");
  const [use, setUse] = useState<UseOfFunds>("growth");
  const [diverse, setDiverse] = useState(false);
  const [error, setError] = useState("");
  const st = store.getStatus();
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));

  const ebitda = parseMoney(f.ebitdaLTM ?? "") ?? 0;
  const priceStated = cim?.values.askingPrice ?? null;
  const price = parseMoney(f.price ?? "") ?? (ebitda > 0 ? Math.round(ebitda * DEFAULT_MULTIPLE / 25_000) * 25_000 : null);
  const preview = kind === "acquisition" && price ? defaultAcquisitionStack(price, ebitda, cim?.values.sellerNote ?? null) : [];

  function create(e: React.FormEvent) {
    e.preventDefault();
    const revenue = parseMoney(f.revenueLTM ?? "");
    if (!f.name?.trim()) return setError("Add the company's name.");
    if (revenue === null || parseMoney(f.ebitdaLTM ?? "") === null) return setError("Add the latest revenue and EBITDA; the matching rules need both.");
    if (!/^[A-Z]{2}$/.test(f.state ?? "")) return setError("Pick the state the company is based in; lenders' areas are checked against it.");
    const amount = parseMoney(f.amount ?? "");
    if (kind === "raise" && !amount) return setError("Add how much the company is raising.");
    if (kind === "acquisition" && !price) return setError("Add a purchase price, or EBITDA so a placeholder price can be set.");
    const estimated = kind === "acquisition" && priceStated === null && !f.price?.trim();
    const input: DealInput = {
      kind,
      company: {
        name: f.name.trim(), website: f.website?.trim() ?? "", city: f.city?.trim() ?? "", state: f.state ?? "",
        yearFounded: Number(f.yearFounded) || new Date().getFullYear(), employees: Number(f.employees) || 0, description: f.description?.trim() ?? "",
      },
      financials: {
        revenueLTM: revenue, revenuePrior: parseMoney(f.revenuePrior ?? "") ?? revenue, ebitdaLTM: parseMoney(f.ebitdaLTM ?? "") ?? 0,
        topCustomerPct: plainNumber(f.topCustomerPct ?? "") ?? 0, existingDebt: parseMoney(f.existingDebt ?? "") ?? 0,
      },
      diverseOwned: diverse,
      useOfFunds: kind === "acquisition" ? "acquisition" : use,
      purchasePrice: kind === "acquisition" ? price : null,
      pieces: kind === "acquisition" ? preview : [{ id: pieceId(), type: raiseType, amount: amount ?? 0 }],
      details: estimated ? `Purchase price is a placeholder at ${DEFAULT_MULTIPLE.toFixed(1)}x EBITDA because ${cim ? "the CIM gives no asking price" : "none was entered"}. Change it above once it's known.` : "",
      cim,
    };
    const d = store.saveDeal(newDeal(input, store.myId()));
    go(dealHash(d.id));
  }

  const showForm = cim || manual;
  return (
    <div className="container page narrow">
      <div className="page-head"><div><div className="crumb"><a href="#deals">Deals</a> / New deal</div><h1>New deal</h1></div></div>
      {!cim && <CimUpload onRead={(c) => { setCim(c); setF(fieldsFromCim(c)); }} />}
      {!showForm && <p className="or-manual"><button className="link-quiet" onClick={() => setManual(true)}>No CIM? Enter the figures by hand</button></p>}
      {cim && (
        <div className="read-ok" role="status">
          <strong>Read {cim.fileName}.</strong> Check the figures below; each one Claude found shows its page. {cim.notFound.length > 0 && <>Not in the document: {cim.notFound.slice(0, 6).join(", ")}.</>}
        </div>
      )}
      {showForm && (
        <form className="card form-card deal-form" onSubmit={create} noValidate>
          <h2>The company</h2>
          <div className="fields">
            {COMPANY_FIELDS.map(([key, label, k]) => {
              const page = cim ? cimPageFor(cim, key === "name" ? "companyName" : key) : null;
              return (
                <div key={key} className={`field ${k === "long" ? "full" : ""}`}>
                  <label htmlFor={`f-${key}`}>{label}{page ? <span className="from-page">CIM p. {page}</span> : null}</label>
                  {k === "long" ? <textarea id={`f-${key}`} rows={3} value={f[key] ?? ""} onChange={(e) => set(key, e.target.value)} />
                    : k === "state" ? (
                      <select id={`f-${key}`} value={f[key] ?? ""} onChange={(e) => set(key, e.target.value)}>
                        <option value="">Choose…</option>
                        {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    ) : (
                      <input id={`f-${key}`} type="text" inputMode={k === "text" ? "text" : "decimal"} value={f[key] ?? ""}
                        onChange={(e) => set(key, e.target.value)}
                        onBlur={() => { if (k === "money" && f[key]) set(key, commas(parseMoney(f[key]))); }}
                        placeholder={k === "money" ? "$" : ""} />
                    )}
                </div>
              );
            })}
          </div>

          <h2>The deal</h2>
          <div className="toggle" role="radiogroup" aria-label="Kind of deal">
            <label className="toggle-opt"><input type="radio" name="kind" checked={kind === "acquisition"} onChange={() => setKind("acquisition")} /> A buyer is acquiring this company</label>
            <label className="toggle-opt"><input type="radio" name="kind" checked={kind === "raise"} onChange={() => setKind("raise")} /> The company is raising capital</label>
          </div>
          {kind === "acquisition" ? (
            <div className="fields">
              <div className="field">
                <label htmlFor="f-price">Purchase price{cim?.values.askingPrice != null && cimPageFor(cim, "purchasePrice") ? <span className="from-page">CIM p. {cimPageFor(cim, "purchasePrice")}</span> : null}</label>
                <input id="f-price" type="text" inputMode="decimal" value={f.price ?? ""} placeholder={price ? commas(price) : "$"}
                  onChange={(e) => set("price", e.target.value)} onBlur={() => { if (f.price) set("price", commas(parseMoney(f.price))); }} />
                {!f.price && price ? <span className="help">No price given, so this starts at {DEFAULT_MULTIPLE.toFixed(1)}x EBITDA. Change it any time.</span> : null}
              </div>
              <label className="check field-check"><input type="checkbox" checked={diverse} onChange={(e) => setDiverse(e.target.checked)} /> The buyer is minority-owned <span className="help">Opens mission-driven lenders and investors.</span></label>
              {preview.length > 0 && (
                <div className="field full stack-preview">
                  <span className="help">Starting stack, which you can change on the next screen:</span>
                  <ul>{preview.map((p) => <li key={p.id}><strong>{money(p.amount)}</strong> {PIECE_LABELS[p.type].toLowerCase()}{p.type === "senior_debt" && ebitda > 0 ? ` (${multiple(p.amount / ebitda)} EBITDA)` : ""}</li>)}</ul>
                </div>
              )}
            </div>
          ) : (
            <div className="fields">
              <div className="field">
                <label htmlFor="f-amount">Amount to raise</label>
                <input id="f-amount" type="text" inputMode="decimal" value={f.amount ?? ""} placeholder="$" onChange={(e) => set("amount", e.target.value)} onBlur={() => { if (f.amount) set("amount", commas(parseMoney(f.amount))); }} />
              </div>
              <div className="field">
                <label htmlFor="f-type">Kind of capital</label>
                <select id="f-type" value={raiseType} onChange={(e) => setRaiseType(e.target.value as CapitalType)}>
                  {(Object.keys(CAPITAL_TYPE_LABELS) as CapitalType[]).map((t) => <option key={t} value={t}>{CAPITAL_TYPE_LABELS[t]}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="f-use">Use of funds</label>
                <select id="f-use" value={use} onChange={(e) => setUse(e.target.value as UseOfFunds)}>
                  {(Object.keys(USE_OF_FUNDS_LABELS) as UseOfFunds[]).filter((u) => u !== "acquisition").map((u) => <option key={u} value={u}>{USE_OF_FUNDS_LABELS[u]}</option>)}
                </select>
              </div>
              <label className="check field-check"><input type="checkbox" checked={diverse} onChange={(e) => setDiverse(e.target.checked)} /> The company is minority-owned</label>
            </div>
          )}
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="form-actions">
            <a href="#deals" className="btn btn-secondary">Cancel</a>
            <button className="btn btn-primary" disabled={st.readOnly}>Find lenders and investors</button>
          </div>
          {st.mode === "local" && <p className="placeholder-note">This view isn&apos;t connected to the team&apos;s shared list, so the deal saves in this browser only.</p>}
        </form>
      )}
    </div>
  );
}

// ── Deal page ──
function MoneyInput({ id, value, onCommit, label }: { id: string; value: number | null; onCommit: (n: number | null) => void; label: string }) {
  const [text, setText] = useState(commas(value));
  useEffect(() => setText(commas(value)), [value]);
  const commit = () => { const n = parseMoney(text); if (n !== value) onCommit(n); else setText(commas(value)); };
  return (
    <input id={id} aria-label={label} type="text" inputMode="decimal" className="money-in" value={text}
      onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } }} />
  );
}

function StackEditor({ d, readOnly }: { d: Deal; readOnly: boolean }) {
  const e = d.financials.ebitdaLTM;
  const lev = stackLeverage(d);
  const total = stackTotal(d.pieces);
  const save = (change: Partial<Deal>) => store.saveDeal({ ...d, ...change });
  const setPiece = (id: string, p: Partial<StackPiece>) => save({ pieces: d.pieces.map((x) => (x.id === id ? { ...x, ...p } : x)) });
  const gap = d.kind === "acquisition" && d.purchasePrice ? d.purchasePrice - total : 0;
  return (
    <div className="card panel stack-card">
      <div className="panel-head">
        <h2>Capital stack <span className="muted">change any piece and the lenders below update</span></h2>
        {lev && <span className="muted">Senior {multiple(lev.senior)} · total debt {multiple(lev.total)} EBITDA</span>}
      </div>
      <div className="stack-rows">
        {d.kind === "acquisition" && (
          <div className="stack-row price-row">
            <label htmlFor="price">Purchase price</label>
            <MoneyInput id="price" label="Purchase price" value={d.purchasePrice} onCommit={(n) => save({ purchasePrice: n })} />
            <span className="muted">{d.purchasePrice && e > 0 ? `${multiple(d.purchasePrice / e)} EBITDA` : ""}</span>
            <span />
          </div>
        )}
        {d.pieces.map((p) => (
          <div className="stack-row" key={p.id}>
            <select aria-label="Piece of the stack" value={p.type} disabled={readOnly} onChange={(ev) => setPiece(p.id, { type: ev.target.value as PieceType })}>
              {(Object.keys(PIECE_LABELS) as PieceType[]).map((t) => <option key={t} value={t}>{PIECE_LABELS[t]}</option>)}
            </select>
            <MoneyInput id={`amt-${p.id}`} label={`${PIECE_LABELS[p.type]} amount`} value={p.amount} onCommit={(n) => setPiece(p.id, { amount: n ?? 0 })} />
            <span className="muted">{e > 0 && p.amount > 0 ? `${multiple(p.amount / e)}` : ""}{isMatched(p.type) ? "" : " · not matched"}</span>
            <button className="icon-btn" aria-label={`Remove ${PIECE_LABELS[p.type]}`} disabled={readOnly || d.pieces.length === 1} onClick={() => save({ pieces: d.pieces.filter((x) => x.id !== p.id) })}>×</button>
          </div>
        ))}
      </div>
      <div className="stack-foot">
        <div className="stack-actions">
          <button className="btn btn-secondary btn-sm" disabled={readOnly} onClick={() => save({ pieces: [...d.pieces, { id: pieceId(), type: "mezzanine", amount: 0 }] })}>+ Add a piece</button>
          {d.kind === "acquisition" && d.purchasePrice && (
            <button className="link-quiet" disabled={readOnly} onClick={() => save({ pieces: defaultAcquisitionStack(d.purchasePrice!, e, d.cim?.values.sellerNote ?? null) })}>Reset to the suggested stack</button>
          )}
        </div>
        <div className={`stack-total ${gap !== 0 && d.kind === "acquisition" ? "off" : ""}`}>
          Total {money(total)}
          {d.kind === "acquisition" && d.purchasePrice ? (gap === 0 ? " · matches the price" : gap > 0 ? ` · ${money(gap)} short of the price` : ` · ${money(-gap)} over the price`) : ""}
        </div>
      </div>
      <label className="check owner-check">
        <input type="checkbox" checked={d.diverseOwned} disabled={readOnly} onChange={(ev) => save({ diverseOwned: ev.target.checked })} />
        {d.kind === "acquisition" ? "The buyer is minority-owned" : "The company is minority-owned"}
      </label>
      {d.details && <p className="placeholder-note">{d.details}</p>}
    </div>
  );
}

const OUTCOME_ICON = { pass: "✓", fail: "✕", confirm: "?" } as const;

function LenderRow({ m, d, readOnly, names }: { m: ProviderMatch; d: Deal; readOnly: boolean; names: (id: string | null) => string }) {
  const p = m.provider;
  const fails = m.requirements.filter((r) => r.outcome === "fail");
  const o = d.outreach[p.id];
  function setOutreach(v: string) {
    const outreach = { ...d.outreach };
    if (v) outreach[p.id] = { status: v as OutreachStatus, at: new Date().toISOString(), by: store.myId() };
    else delete outreach[p.id];
    store.saveDeal({ ...d, outreach });
  }
  return (
    <div className={`lrow ${o ? `o-${o.status}` : ""}`}>
      <div className="lrow-main">
        <div className="lrow-name">
          <a href={lenderHash(p.id)}>{p.name}</a>
          {m.eligible ? <span className={`badge ${m.strength}`}>{m.strength} · {m.score}</span> : <span className="badge Low">Near miss</span>}
        </div>
        <div className="muted">{p.type || "Lender"} · {range(p.checkMin, p.checkMax) ?? "Check size not published"}{p.contact?.name || p.contact?.email ? ` · ${[p.contact.name, p.contact.email].filter(Boolean).join(", ")}` : ""}</div>
        <div className="why">
          {fails.map((r) => <span key={r.label} className="tag miss">{r.detail}</span>)}
          {m.toConfirm.map((r) => <span key={r.label} className="tag confirm">{r.label}: {r.detail}</span>)}
          {m.reasons.map((r) => <span key={r} className="tag ok">{r}</span>)}
        </div>
        {p.nextQuestion && m.eligible && <div className="ask"><strong>Ask first:</strong> {p.nextQuestion}</div>}
        <details className="req">
          <summary>All requirements</summary>
          <ul>{m.requirements.map((r) => <li key={r.label} className={`req-${r.outcome}`}>{OUTCOME_ICON[r.outcome]} <strong>{r.label}:</strong> {r.detail}</li>)}</ul>
        </details>
      </div>
      <div className="lrow-side">
        <select aria-label={`Outreach to ${p.name}`} value={o?.status ?? ""} disabled={readOnly} onChange={(e) => setOutreach(e.target.value)}>
          <option value="">Not contacted</option>
          {(Object.keys(OUTREACH_LABELS) as OutreachStatus[]).map((s) => <option key={s} value={s}>{OUTREACH_LABELS[s]}</option>)}
        </select>
        {o && <span className="muted small">{names(o.by)} · {shortDate(o.at)}</span>}
      </div>
    </div>
  );
}

function PieceSection({ pm, d, readOnly, names }: { pm: PieceMatch; d: Deal; readOnly: boolean; names: (id: string | null) => string }) {
  const { confirmed, possible, nearMisses } = pm.result;
  const e = d.financials.ebitdaLTM;
  return (
    <section className="card panel piece" id={`piece-${pm.piece.id}`}>
      <div className="panel-head">
        <h2>{CAPITAL_TYPE_LABELS[pm.piece.type]} · {money(pm.piece.amount)}{e > 0 && pm.piece.type !== "minority_equity" && pm.piece.type !== "majority_equity" ? <span className="muted"> ({multiple(pm.piece.amount / e)} EBITDA)</span> : null}</h2>
        <span className="muted">{confirmed.length} to approach · {possible.length} possible</span>
      </div>
      {confirmed.length === 0 && possible.length === 0 && (
        <p className="empty">No lender in the list fits this piece as structured.{nearMisses.length > 0 ? " The near misses below are one requirement short." : " Try a different amount or kind of capital, or add lenders who do this."}</p>
      )}
      {confirmed.length > 0 && <h3 className="group-head">Approach first <span className="muted">meets every published criterion</span></h3>}
      {confirmed.map((m) => <LenderRow key={m.provider.id} m={m} d={d} readOnly={readOnly} names={names} />)}
      {possible.length > 0 && (
        <details className="group" open={confirmed.length < 3}>
          <summary>Worth a call, confirm first <span className="muted">({possible.length}; some criteria unpublished or need a conversation)</span></summary>
          {possible.map((m) => <LenderRow key={m.provider.id} m={m} d={d} readOnly={readOnly} names={names} />)}
        </details>
      )}
      {nearMisses.length > 0 && (
        <details className="group">
          <summary>Near misses <span className="muted">({nearMisses.length}; one size requirement short)</span></summary>
          {nearMisses.map((m) => <LenderRow key={m.provider.id} m={m} d={d} readOnly={readOnly} names={names} />)}
        </details>
      )}
    </section>
  );
}

function csvCell(v: string | number) {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function dealCsv(d: Deal, matches: PieceMatch[], names: (id: string | null) => string) {
  const head = ["Piece", "Piece amount", "Lender", "Type", "Group", "Score", "Check size", "Why it fits", "To confirm", "Not met", "Ask first", "Contact", "Outreach", "Outreach by", "Outreach date"];
  const rows: (string | number)[][] = [];
  for (const pm of matches) {
    const groups: [string, ProviderMatch[]][] = [["Approach first", pm.result.confirmed], ["Confirm first", pm.result.possible], ["Near miss", pm.result.nearMisses]];
    for (const [group, list] of groups) {
      for (const m of list) {
        const p = m.provider;
        const o = d.outreach[p.id];
        rows.push([
          CAPITAL_TYPE_LABELS[pm.piece.type], pm.piece.amount, p.name, p.type, group, m.eligible ? m.score : "",
          range(p.checkMin, p.checkMax) ?? "Not published", m.reasons.join("; "), m.toConfirm.map((r) => `${r.label}: ${r.detail}`).join("; "),
          m.requirements.filter((r) => r.outcome === "fail").map((r) => r.detail).join("; "), p.nextQuestion,
          [p.contact?.name, p.contact?.email].filter(Boolean).join(", "), o ? OUTREACH_LABELS[o.status] : "", o ? names(o.by) : "", o ? o.at.slice(0, 10) : "",
        ]);
      }
    }
  }
  return "﻿" + [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
}

function dealText(d: Deal, matches: PieceMatch[]) {
  const lines = [`${d.company.name}: who to approach`, `${d.company.city}, ${d.company.state} · Revenue ${money(d.financials.revenueLTM)} · EBITDA ${money(d.financials.ebitdaLTM)}`, ""];
  for (const pm of matches) {
    lines.push(`${CAPITAL_TYPE_LABELS[pm.piece.type]}, ${money(pm.piece.amount)}`);
    if (pm.result.confirmed.length) lines.push(`  Approach first: ${pm.result.confirmed.map((m) => m.provider.name).join("; ")}`);
    if (pm.result.possible.length) lines.push(`  Confirm first: ${pm.result.possible.map((m) => m.provider.name).join("; ")}`);
    if (!pm.result.confirmed.length && !pm.result.possible.length) lines.push("  No lender in the list fits as structured.");
    lines.push("");
  }
  return lines.join("\n").trim();
}

function ExportBar({ d, matches, names }: { d: Deal; matches: PieceMatch[]; names: (id: string | null) => string }) {
  const { downloads } = useCaps();
  const [msg, setMsg] = useState("");
  async function save() {
    if (!downloads) return setMsg("Downloads aren't available in this view. Use Copy list instead.");
    try {
      const slug = d.company.name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "deal";
      await downloads.save({ filename: `${slug}-lenders.csv`, data: new Blob([dealCsv(d, matches, names)], { type: "text/csv" }) });
      setMsg("Saved. It opens in Excel.");
    } catch (e) {
      const code = (e as { code?: string })?.code;
      setMsg(code === "declined" ? "Download cancelled." : "The file couldn't be saved here. Use Copy list instead.");
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(dealText(d, matches));
      setMsg("Copied. Paste it into an email or Slack.");
    } catch {
      setMsg("Copying isn't allowed in this view.");
    }
  }
  return (
    <div className="export-bar">
      <button className="btn btn-secondary btn-sm" onClick={() => void save()}>Download for Excel</button>
      <button className="btn btn-secondary btn-sm" onClick={() => void copy()}>Copy list</button>
      {msg && <span className="muted small" role="status">{msg}</span>}
    </div>
  );
}

function NotesPanel({ d, readOnly, names }: { d: Deal; readOnly: boolean; names: (id: string | null) => string }) {
  const [text, setText] = useState("");
  return (
    <div className="card panel">
      <div className="panel-head"><h2>Team notes</h2></div>
      <div className="notes">
        {d.notes.length === 0 && <p className="muted">No notes yet.</p>}
        {d.notes.map((n, i) => <div className="note" key={`${n.at}-${i}`}><div className="meta">{n.by ? names(n.by) : "MAPlab team"} · {dateTime(n.at)}</div>{n.text}</div>)}
      </div>
      {!readOnly && (
        <form className="note-form" onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          store.saveDeal({ ...d, notes: [...d.notes, { at: new Date().toISOString(), by: store.myId(), text: text.trim() }] });
          setText("");
        }}>
          <textarea id="note-text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a note for the team" />
          <button className="btn btn-primary btn-sm">Add note</button>
        </form>
      )}
    </div>
  );
}

function CompanyPanel({ d }: { d: Deal }) {
  const fromClaude = d.summary.model === "claude";
  const f = d.financials;
  return (
    <div className="card panel">
      <div className="panel-head"><h2>Company</h2><span className={`badge ${fromClaude ? "ai-real" : "ai"}`}>{fromClaude ? "Read by Claude" : "Entered by hand"}</span></div>
      <div className="kv">
        <div><span>Revenue{d.cim?.labels.revenueLTM ? `, ${d.cim.labels.revenueLTM}` : ""}</span><strong>{money(f.revenueLTM)}</strong></div>
        <div><span>{d.cim?.labels.ebitdaLTM ?? "EBITDA"}</span><strong>{money(f.ebitdaLTM)} <span className="muted">{pct(margin(f.revenueLTM, f.ebitdaLTM), 1)}</span></strong></div>
        <div><span>Revenue growth</span><strong>{f.revenuePrior > 0 ? `${f.revenueLTM >= f.revenuePrior ? "+" : ""}${pct((f.revenueLTM - f.revenuePrior) / f.revenuePrior * 100, 1)}` : "Not given"}</strong></div>
        <div><span>Largest customer</span><strong>{f.topCustomerPct ? `${f.topCustomerPct}% of revenue` : "Not given"}</strong></div>
        <div><span>Founded</span><strong>{d.company.yearFounded}</strong></div>
        <div><span>Employees</span><strong>{d.company.employees || "Not given"}</strong></div>
      </div>
      <p className="summary-text">{d.cim?.summary || d.company.description}</p>
      {d.summary.highlights.length > 0 && fromClaude && (
        <div className="two-col">
          <div><h4 className="h-good">Highlights</h4><ul>{d.summary.highlights.map((h) => <li key={h}>{h}</li>)}</ul></div>
          <div><h4 className="h-risk">Watch items</h4><ul>{d.summary.risks.map((h) => <li key={h}>{h}</li>)}</ul></div>
        </div>
      )}
      <p className="muted small">Industry: {d.naics.code} {d.naics.title} ({SECTOR_LABELS[d.naics.sector] ?? d.naics.sector}). Lenders&apos; industry rules are checked against this sector.</p>
    </div>
  );
}

function DealPage({ id }: { id: string }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const st = store.getStatus();
  const d = store.getDeal(id);
  const lenders = store.activeLenders();
  const matches = d ? matchStack(d, lenders) : [];
  const names = useNames([...(d ? Object.values(d.outreach).map((o) => o.by) : []), ...(d?.notes.map((n) => n.by) ?? [])]);
  if (st.loading && !d) return <div className="container page"><Loading what="deals" /></div>;
  if (!d) return <div className="container page"><div className="card empty-state"><h2>Deal not found</h2><p>It may have been deleted by a teammate.</p><a className="btn btn-primary" href="#deals">Back to deals</a></div></div>;
  const readOnly = st.readOnly;
  const asSubmission = pieceSubmission(d, { id: "view", type: "senior_debt", amount: stackTotal(d.pieces) });
  const contacted = Object.keys(d.outreach).length;
  return (
    <div className="container page">
      <div className="page-head">
        <div>
          <div className="crumb"><a href="#deals">Deals</a> / {d.company.name}</div>
          <h1>{d.company.name}</h1>
          <p>{d.kind === "acquisition" ? "Acquisition" : USE_OF_FUNDS_LABELS[d.useOfFunds]} · {d.company.city}{d.company.state ? `, ${d.company.state}` : ""} · {d.naics.title.replace(/\s*\(.*\)$/, "")} · Revenue {money(d.financials.revenueLTM)} · EBITDA {money(d.financials.ebitdaLTM)}</p>
        </div>
        <ExportBar d={d} matches={matches} names={names} />
      </div>

      <div className="summary-strip">
        {matches.map((pm) => (
          <a key={pm.piece.id} href={`#deal-${d.id.replace(/^deal_/, "")}`} onClick={(e) => { e.preventDefault(); document.getElementById(`piece-${pm.piece.id}`)?.scrollIntoView({ behavior: "smooth" }); }} className="strip-item">
            <span className="strip-label">{CAPITAL_TYPE_LABELS[pm.piece.type]} · {money(pm.piece.amount)}</span>
            <span className="strip-n"><strong>{pm.result.confirmed.length}</strong> to approach{pm.result.possible.length ? `, ${pm.result.possible.length} possible` : ""}</span>
          </a>
        ))}
        {matches.length === 0 && <span className="muted">Add a debt or equity piece to the stack to see who to approach.</span>}
        {contacted > 0 && <span className="strip-item quiet"><span className="strip-label">Outreach</span><span className="strip-n"><strong>{contacted}</strong> contacted</span></span>}
      </div>

      <StackEditor d={d} readOnly={readOnly} />
      <div className="detail-grid">
        <div className="stack">
          {matches.map((pm) => <PieceSection key={pm.piece.id} pm={pm} d={d} readOnly={readOnly} names={names} />)}
        </div>
        <div className="stack">
          <CompanyPanel d={d} />
          <CimPanel s={asSubmission} />
          <NotesPanel d={d} readOnly={readOnly} names={names} />
          {!readOnly && (
            <div className="danger-zone">
              {confirmDelete ? (
                <span>Delete this deal for everyone? <button className="link-quiet danger" onClick={() => { store.deleteDeal(d.id); go("#deals"); }}>Yes, delete</button> <button className="link-quiet" onClick={() => setConfirmDelete(false)}>Cancel</button></span>
              ) : <button className="link-quiet" onClick={() => setConfirmDelete(true)}>Delete deal</button>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Lenders ──
const sectorList = (keys: string[]) => keys.map((k) => SECTOR_LABELS[k] ?? k).join(", ");
const geoShort = (p: Provider) => (p.geographies.includes("National") ? "National" : p.geographies.length > 8 ? `${p.geographies.length} states` : p.geographies.join(", "));
const CAP_FILTERS = Object.keys(CAPITAL_TYPE_LABELS) as CapitalType[];
const SHORT_CAP: Record<CapitalType, string> = {
  senior_debt: "Senior debt", sba_7a: "SBA 7(a)", mezzanine: "Mezzanine", revenue_based: "Revenue-based", minority_equity: "Minority equity", majority_equity: "Majority equity",
};

function LendersPage() {
  const [filter, setFilter] = useState<CapitalType | "all" | "team" | "removed">("all");
  const [query, setQuery] = useState("");
  const st = store.getStatus();
  const all = store.allLenders();
  const deals = store.listDeals();
  const q = query.trim().toLowerCase();
  const shown = all.filter((l) => {
    if (filter === "removed") return l.record?.removed;
    if (l.record?.removed) return false;
    if (filter === "team") return !!l.record;
    return filter === "all" || l.provider.capitalTypes.includes(filter);
  }).filter((l) => !q || [l.provider.name, l.provider.fund, l.provider.type, l.provider.relevance].join(" ").toLowerCase().includes(q));
  const names = useNames(shown.map((l) => l.record?.updatedBy ?? null));
  const active = all.filter((l) => !l.record?.removed);
  const fits = (p: Provider) => deals.filter((d) => matchStack(d, [p]).some((pm) => pm.result.matches.length > 0)).length;
  const count = (f: typeof filter) => all.filter((l) => (f === "removed" ? l.record?.removed : !l.record?.removed && (f === "all" || (f === "team" ? !!l.record : l.provider.capitalTypes.includes(f))))).length;
  return (
    <div className="container page">
      <div className="page-head">
        <div>
          <h1>Lenders &amp; investors</h1>
          <p>{active.length} in the list. Every deal is matched against their criteria. Add a lender as soon as you learn what they do; paste their website or your call notes and Claude fills in the form.</p>
        </div>
        <a href="#add-lender" className="btn btn-primary">+ Add a lender</a>
      </div>
      <div className="search" role="search">
        <input id="lender-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name, fund or type" aria-label="Search lenders" />
      </div>
      <div className="filters">
        <button className={`chip ${filter === "all" ? "active" : ""}`} onClick={() => setFilter("all")}>All<span className="n">{count("all")}</span></button>
        {CAP_FILTERS.map((c) => <button key={c} className={`chip ${filter === c ? "active" : ""}`} onClick={() => setFilter(c)}>{SHORT_CAP[c]}<span className="n">{count(c)}</span></button>)}
        <button className={`chip ${filter === "team" ? "active" : ""}`} onClick={() => setFilter("team")}>Added or edited by the team<span className="n">{count("team")}</span></button>
        {count("removed") > 0 && <button className={`chip ${filter === "removed" ? "active" : ""}`} onClick={() => setFilter("removed")}>Removed<span className="n">{count("removed")}</span></button>}
      </div>
      {st.loading ? <Loading what="lenders" /> : (
        <div className="card table-wrap">
          <table className="data lenders">
            <thead><tr><th>Lender</th><th>Provides</th><th>Check size</th><th>EBITDA</th><th>Where</th><th className="num">Fits deals</th></tr></thead>
            <tbody>
              {shown.map(({ provider: p, record, builtIn }) => (
                <tr key={p.id} className="rowlink" onClick={() => go(lenderHash(p.id))}>
                  <td>
                    <a href={lenderHash(p.id)} className="name">{p.name}</a>
                    <div className="muted">{p.type || "Lender"}{p.diverseFocus ? " · Minority-business mandate" : ""}</div>
                    {record && <div className="muted team-mark">{builtIn ? "Edited" : "Added"} by {names(record.updatedBy)} · {shortDate(record.updatedAt)}</div>}
                  </td>
                  <td className="small">{p.capitalTypes.map((c) => SHORT_CAP[c]).join(", ")}</td>
                  <td className="small nowrap">{range(p.checkMin, p.checkMax) ?? <span className="muted">Not published</span>}</td>
                  <td className="small nowrap">{range(p.ebitdaMin, p.ebitdaMax) ?? <span className="muted">{p.requiresPositiveEbitda ? "Positive" : "Not published"}</span>}</td>
                  <td className="small">{geoShort(p)}</td>
                  <td className="num">{fits(p) || <span className="muted">0</span>}</td>
                </tr>
              ))}
              {shown.length === 0 && <tr><td colSpan={6} className="empty">No lenders match.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, note }: { label: string; value: React.ReactNode; note?: string }) {
  return (<><dt>{label}</dt><dd>{value}{note && <span className="note">{note}</span>}</dd></>);
}

function LenderPage({ id }: { id: string }) {
  const [confirm, setConfirm] = useState<"" | "remove" | "reset">("");
  const st = store.getStatus();
  const l = store.getLender(id);
  const names = useNames([l?.record?.updatedBy ?? null]);
  if (!l) return <div className="container page">{st.loading ? <Loading what="lenders" /> : <div className="card empty-state"><h2>Lender not found</h2><a className="btn btn-primary" href="#lenders">Back to lenders</a></div>}</div>;
  const p = l.provider;
  const deals = store.listDeals().flatMap((d) =>
    d.pieces.filter((pc) => isMatched(pc.type) && pc.amount > 0).map((pc) => ({ d, pc, m: evaluateProvider(pieceSubmission(d, pc as StackPiece & { type: CapitalType }), p) })),
  ).sort((a, b) => Number(b.m.eligible) - Number(a.m.eligible) || b.m.score - a.m.score);
  const geoNote = [
    p.geographiesConfirm.length ? `To confirm: ${p.geographiesConfirm.length > 10 ? "all other states" : p.geographiesConfirm.join(", ")}.` : "",
    p.geographyConfirm ? `${p.geographyConfirm}.` : "",
    p.geographyNote,
  ].filter(Boolean).join(" ");
  const readOnly = st.readOnly;
  return (
    <div className="container page">
      <div className="page-head">
        <div>
          <div className="crumb"><a href="#lenders">Lenders</a> / {p.name}</div>
          <h1>{p.name}</h1>
          <p>{[p.fund, p.type, p.relevance].filter(Boolean).join(" · ")}</p>
          {l.record && <p className="muted small">{l.builtIn ? "Edited" : "Added"} by {names(l.record.updatedBy)} on {shortDate(l.record.updatedAt)}{l.record.removed ? " · Removed from matching" : ""}</p>}
        </div>
        {!readOnly && (
          <div className="head-actions">
            <a className="btn btn-primary btn-sm" href={editHash(p.id)}>Edit</a>
            {confirm === "remove" ? (
              <span className="small">Stop matching deals to this lender? <button className="link-quiet danger" onClick={() => { store.setLenderRemoved(p.id, true); setConfirm(""); }}>Remove</button> <button className="link-quiet" onClick={() => setConfirm("")}>Cancel</button></span>
            ) : confirm === "reset" ? (
              <span className="small">Undo the team&apos;s edits? <button className="link-quiet danger" onClick={() => { store.resetLender(p.id); setConfirm(""); }}>Go back to the research version</button> <button className="link-quiet" onClick={() => setConfirm("")}>Cancel</button></span>
            ) : (
              <>
                {l.record?.removed
                  ? <button className="btn btn-secondary btn-sm" onClick={() => store.setLenderRemoved(p.id, false)}>Restore</button>
                  : <button className="btn btn-secondary btn-sm" onClick={() => setConfirm("remove")}>Remove</button>}
                {l.builtIn && l.record && !l.record.removed && <button className="link-quiet" onClick={() => setConfirm("reset")}>Undo edits</button>}
              </>
            )}
          </div>
        )}
      </div>
      <div className="detail-grid">
        <div className="stack">
          <div className="card panel">
            <div className="panel-head"><h2>Before you reach out</h2></div>
            <dl className="crit">
              {p.contact && (p.contact.name || p.contact.email) && <Row label="Contact" value={<span className="select">{[p.contact.name, p.contact.email].filter(Boolean).join(" · ")}</span>} />}
              {p.nextQuestion && <Row label="Ask first" value={p.nextQuestion} />}
              {p.strategyNote && <Row label="What they do" value={p.strategyNote} />}
              {p.acquisitionNote && <Row label="Acquisitions" value={p.acquisitionNote} />}
              {p.controlNote && <Row label="Control" value={p.controlNote} />}
              {p.status && <Row label="Availability" value={p.status} />}
            </dl>
          </div>
          <div className="card table-wrap">
            <div className="panel"><div className="panel-head flush"><h2>The team&apos;s deals against this lender</h2></div></div>
            <table className="data">
              <thead><tr><th>Deal</th><th>Piece</th><th>Result</th></tr></thead>
              <tbody>
                {deals.map(({ d, pc, m }) => (
                  <tr key={`${d.id}-${pc.id}`} className="rowlink" onClick={() => go(dealHash(d.id))}>
                    <td><a href={dealHash(d.id)} className="name">{d.company.name}</a></td>
                    <td className="small">{PIECE_LABELS[pc.type]} · {money(pc.amount)}</td>
                    <td className="small">{m.eligible
                      ? <><span className={`badge ${m.strength}`}>{m.toConfirm.length ? "Confirm first" : "Approach"} · {m.score}</span></>
                      : <span className="req-fail">{m.requirements.filter((r) => r.outcome === "fail").map((r) => r.detail).join("; ")}</span>}</td>
                  </tr>
                ))}
                {deals.length === 0 && <tr><td colSpan={3} className="empty">No deals yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
        <div className="stack">
          <div className="card panel">
            <div className="panel-head"><h2>Matching criteria</h2></div>
            <dl className="crit">
              <Row label="Capital" value={p.capitalTypes.map((c) => CAPITAL_TYPE_LABELS[c]).join(", ") || "None set"} />
              <Row label="Check size" value={range(p.checkMin, p.checkMax) ?? "Not published"} note={p.checkNote} />
              <Row label="EBITDA" value={range(p.ebitdaMin, p.ebitdaMax) ?? (p.requiresPositiveEbitda ? "Positive EBITDA" : "Not published")} note={p.ebitdaNote} />
              <Row label="Revenue" value={range(p.revenueMin, p.revenueMax) ?? "No screen applied"} note={p.revenueNote} />
              {p.minYears !== null && <Row label="Years operating" value={`${p.minYears}+`} />}
              {p.maxLeverage !== null && <Row label="Max leverage" value={multiple(p.maxLeverage)} />}
              <Row label="Geography" value={stateList(p.geographies)} note={geoNote} />
              <Row label="Industries" value={p.sectorsPreferred.length ? `${p.sectorsOnly ? "Only " : "Prefers "}${sectorList(p.sectorsPreferred)}` : "No stated preference"} note={p.industriesNote} />
              <Row label="Excludes" value={p.sectorsExcluded.length ? sectorList(p.sectorsExcluded) : "None applied"} note={p.exclusionsNote} />
              <Row label="Use of funds" value={p.useOfFunds.map((u) => USE_OF_FUNDS_LABELS[u]).join(", ")} note={p.useOfFundsConfirm.length ? `To confirm: ${p.useOfFundsConfirm.map((u) => USE_OF_FUNDS_LABELS[u]).join(", ")}` : undefined} />
              <Row label="Ownership" value={p.ownershipRequirement === "specific" ? p.ownershipLabel ?? "Specific group" : OWNERSHIP_LABELS[p.ownershipRequirement]} note={p.diverseFocus ? "Has a mandate to back minority-owned businesses." : undefined} />
            </dl>
          </div>
          {p.interpretations.length > 0 && (
            <div className="card panel">
              <div className="panel-head"><h2>How their criteria were read</h2></div>
              <ul className="prose-list">{p.interpretations.map((t) => <li key={t}>{t}</li>)}</ul>
            </div>
          )}
          <div className="card panel">
            <div className="panel-head"><h2>Sources</h2><span className="muted">{p.sourceQuality}</span></div>
            {p.sources.length ? <ul className="source-list">{p.sources.map((u) => <li key={u}><a href={u} target="_blank" rel="noreferrer">{u.replace(/^https?:\/\//, "")}</a></li>)}</ul> : <p className="muted">No links saved.</p>}
            {p.researchChecked && <p className="placeholder-note">{p.ref === "Team" ? "Entered" : `Research ${p.ref}, checked`} {p.researchChecked}.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Add or edit a lender ──
function NumField({ id, label, value, onChange, kind = "money", help }: { id: string; label: string; value: number | null; onChange: (n: number | null) => void; kind?: "money" | "number" | "multiple"; help?: string }) {
  const show = (n: number | null) => (n === null ? "" : kind === "money" ? commas(n) : String(n));
  const [text, setText] = useState(show(value));
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="text" inputMode="decimal" value={text} placeholder={kind === "money" ? "$ not published" : kind === "multiple" ? "e.g. 4.0" : ""}
        onChange={(e) => { setText(e.target.value); onChange(kind === "money" ? parseMoney(e.target.value) : plainNumber(e.target.value)); }}
        onBlur={() => setText(show(kind === "money" ? parseMoney(text) : plainNumber(text)))} />
      {help && <span className="help">{help}</span>}
    </div>
  );
}

function Checks<T extends string>({ legend, options, selected, onChange }: { legend: string; options: [T, string][]; selected: T[]; onChange: (v: T[]) => void }) {
  return (
    <fieldset className="field full checkset">
      <legend>{legend}</legend>
      <div className="check-chips">
        {options.map(([k, label]) => (
          <label key={k} className={`check-chip ${selected.includes(k) ? "on" : ""}`}>
            <input type="checkbox" checked={selected.includes(k)} onChange={(e) => onChange(e.target.checked ? [...selected, k] : selected.filter((x) => x !== k))} />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const NOTE_ERRORS: Record<string, string> = {
  not_granted: "Claude wasn't allowed to run on this page. Fill in the form by hand.",
  sampling_disabled: "Claude isn't available on this account. Fill in the form by hand.",
  rate_limited: "Claude is limiting requests right now. Wait a few minutes and try again, or fill in the form by hand.",
  prompt_too_large: "Those notes are too long. Paste just the part about their criteria.",
  invalid_json: "Claude's answer couldn't be read. Try again.",
  session_expired: "Your Claude session expired. Sign in again, then try again.",
};

function FillFromNotes({ base, onFill }: { base: Provider; onFill: (p: Provider) => void }) {
  const { sample, ready } = useCaps();
  const [notes, setNotes] = useState("");
  const [state, setState] = useState<{ kind: "idle" | "busy" | "done" | "error"; text: string }>({ kind: "idle", text: "" });
  if (ready && !sample) return null;
  async function fill() {
    if (!sample || !notes.trim()) return;
    setState({ kind: "busy", text: "Claude is reading the notes…" });
    try {
      const raw = await sample.json(`${LENDER_INSTRUCTIONS}\n\n<notes>\n${notes.slice(0, 60_000)}\n</notes>`, { modelTier: "default" });
      const value = typeof raw === "string" ? parseJsonReply(raw) : raw;
      const next = lenderFromReply(value, base);
      onFill(next);
      setState({ kind: "done", text: "Filled in from the notes. Check every field below before saving; anything the notes didn't say is left as it was." });
    } catch (e) {
      const code = (e as { code?: string })?.code ?? "";
      setState({ kind: "error", text: NOTE_ERRORS[code] ?? "Claude couldn't read the notes. Try again, or fill in the form by hand." });
    }
  }
  return (
    <div className="card panel fill-notes">
      <div className="panel-head"><h2>Fill from notes</h2><span className="badge ai-real">Claude</span></div>
      <p className="muted">Paste their criteria page, a term sheet, an email or your call notes. Claude turns it into the matching rules below for you to check.</p>
      <textarea id="lender-notes" rows={5} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. First Midwest Bank, SBA preferred lender. 7(a) up to $5MM for acquisitions in OH, IN, KY; needs 1.25x DSCR, 10% equity injection, 2+ years history…" />
      <div className="fill-actions">
        <button type="button" className="btn btn-primary btn-sm" disabled={!sample || !notes.trim() || state.kind === "busy"} onClick={() => void fill()}>{state.kind === "busy" ? "Reading…" : "Fill the form"}</button>
        {state.text && <span className={`small ${state.kind === "error" ? "req-fail" : state.kind === "done" ? "ok-text" : "muted"}`} role="status">{state.text}</span>}
      </div>
    </div>
  );
}

function LenderForm({ id }: { id: string | null }) {
  const existing = id ? store.getLender(id) : null;
  const [p, setP] = useState<Provider>(() => (existing ? JSON.parse(JSON.stringify(existing.provider)) : blankLender()));
  const [version, setVersion] = useState(0);
  const [geoText, setGeoText] = useState(p.geographies.join(", "));
  const [geoConfirmText, setGeoConfirmText] = useState(p.geographiesConfirm.join(", "));
  const [sourcesText, setSourcesText] = useState(p.sources.join("\n"));
  const [tried, setTried] = useState(false);
  const st = store.getStatus();
  if (id && !existing) return <div className="container page">{st.loading ? <Loading what="lenders" /> : <div className="card empty-state"><h2>Lender not found</h2><a className="btn btn-primary" href="#lenders">Back to lenders</a></div>}</div>;
  const set = <K extends keyof Provider>(k: K, v: Provider[K]) => setP((x) => ({ ...x, [k]: v }));
  const problems = lenderProblems(p);

  function filled(next: Provider) {
    setP(next);
    setGeoText(next.geographies.join(", "));
    setGeoConfirmText(next.geographiesConfirm.join(", "));
    setSourcesText(next.sources.join("\n"));
    setVersion((v) => v + 1);
  }
  function save(e: React.FormEvent) {
    e.preventDefault();
    setTried(true);
    if (problems.length) return;
    const clean: Provider = { ...p, name: p.name.trim(), contact: p.contact && (p.contact.name.trim() || p.contact.email.trim()) ? { name: p.contact.name.trim(), email: p.contact.email.trim() } : null, researchChecked: existing ? p.researchChecked : new Date().toISOString().slice(0, 10) };
    store.saveLender(clean);
    go(lenderHash(clean.id));
  }
  const sectorOptions = Object.entries(SECTOR_LABELS) as [string, string][];
  return (
    <div className="container page narrow">
      <div className="page-head"><div>
        <div className="crumb"><a href="#lenders">Lenders</a> / {existing ? <><a href={lenderHash(existing.provider.id)}>{existing.provider.name}</a> / Edit</> : "Add a lender"}</div>
        <h1>{existing ? `Edit ${existing.provider.name}` : "Add a lender"}</h1>
        {existing?.builtIn && <p className="muted">Your edit replaces the researched profile for the whole team. You can undo it from the lender&apos;s page.</p>}
      </div></div>
      <FillFromNotes base={p} onFill={filled} />
      <form className="card form-card lender-form" onSubmit={save} noValidate key={version}>
        <h2>Who they are</h2>
        <div className="fields">
          <div className="field"><label htmlFor="l-name">Name</label><input id="l-name" type="text" value={p.name} onChange={(e) => set("name", e.target.value)} /></div>
          <div className="field"><label htmlFor="l-fund">Fund or program</label><input id="l-fund" type="text" value={p.fund} onChange={(e) => set("fund", e.target.value)} /></div>
          <div className="field">
            <label htmlFor="l-type">Type</label>
            <input id="l-type" type="text" list="lender-types" value={p.type} onChange={(e) => set("type", e.target.value)} placeholder="Bank, SBA lender, private credit…" />
            <datalist id="lender-types">{LENDER_TYPES.map((t) => <option key={t} value={t} />)}</datalist>
          </div>
          <div className="field">
            <label htmlFor="l-cat">Group</label>
            <select id="l-cat" value={p.category} onChange={(e) => set("category", e.target.value)}>
              {Array.from(new Set([...LENDER_CATEGORIES, p.category])).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="field"><label htmlFor="l-cname">Contact name</label><input id="l-cname" type="text" value={p.contact?.name ?? ""} onChange={(e) => set("contact", { name: e.target.value, email: p.contact?.email ?? "" })} /></div>
          <div className="field"><label htmlFor="l-cemail">Contact email</label><input id="l-cemail" type="email" value={p.contact?.email ?? ""} onChange={(e) => set("contact", { name: p.contact?.name ?? "", email: e.target.value })} /></div>
          <div className="field full"><label htmlFor="l-rel">Focus, in a few words</label><input id="l-rel" type="text" value={p.relevance} onChange={(e) => set("relevance", e.target.value)} placeholder="e.g. SBA acquisition loans in the Midwest" /></div>
        </div>

        <h2>What they provide</h2>
        <div className="fields">
          <Checks legend="Kinds of capital" options={CAP_FILTERS.map((c) => [c, CAPITAL_TYPE_LABELS[c]])} selected={p.capitalTypes} onChange={(v) => set("capitalTypes", v)} />
          <Checks legend="Uses of funds they finance" options={(Object.keys(USE_OF_FUNDS_LABELS) as UseOfFunds[]).map((u) => [u, USE_OF_FUNDS_LABELS[u]])} selected={p.useOfFunds} onChange={(v) => set("useOfFunds", v)} />
        </div>

        <h2>Size</h2>
        <p className="muted form-note">Leave a box empty when they don&apos;t say. Empty means &ldquo;confirm with them&rdquo;, never zero.</p>
        <div className="fields three">
          <NumField id="l-cmin" label="Smallest check" value={p.checkMin} onChange={(n) => set("checkMin", n)} />
          <NumField id="l-cmax" label="Largest check" value={p.checkMax} onChange={(n) => set("checkMax", n)} />
          <NumField id="l-years" label="Years in business, at least" kind="number" value={p.minYears} onChange={(n) => set("minYears", n === null ? null : Math.round(n))} />
          <NumField id="l-emin" label="EBITDA, at least" value={p.ebitdaMin} onChange={(n) => set("ebitdaMin", n)} />
          <NumField id="l-emax" label="EBITDA, at most" value={p.ebitdaMax} onChange={(n) => set("ebitdaMax", n)} />
          <NumField id="l-lev" label="Max debt / EBITDA" kind="multiple" value={p.maxLeverage} onChange={(n) => set("maxLeverage", n)} help="Debt pieces only" />
          <NumField id="l-rmin" label="Revenue, at least" value={p.revenueMin} onChange={(n) => set("revenueMin", n)} />
          <NumField id="l-rmax" label="Revenue, at most" value={p.revenueMax} onChange={(n) => set("revenueMax", n)} />
          <label className="check field-check"><input type="checkbox" checked={p.requiresPositiveEbitda} onChange={(e) => set("requiresPositiveEbitda", e.target.checked)} /> Requires positive EBITDA</label>
        </div>

        <h2>Where and what</h2>
        <div className="fields">
          <div className="field">
            <label htmlFor="l-geo">Where they lend</label>
            <input id="l-geo" type="text" value={geoText} onChange={(e) => { setGeoText(e.target.value); set("geographies", parseStates(e.target.value)); }} placeholder="National, or OH, KY, IN" />
            <span className="help">{p.geographies.length ? `Reads as: ${stateList(p.geographies)}` : "Type National or state codes."}</span>
          </div>
          <div className="field">
            <label htmlFor="l-geoc">Other states, to confirm</label>
            <input id="l-geoc" type="text" value={geoConfirmText} onChange={(e) => { setGeoConfirmText(e.target.value); set("geographiesConfirm", parseStates(e.target.value).filter((s) => s !== "National")); }} placeholder="Optional" />
          </div>
          <Checks legend="Industries they prefer" options={sectorOptions} selected={p.sectorsPreferred} onChange={(v) => set("sectorsPreferred", v)} />
          <label className="check field-check full"><input type="checkbox" checked={p.sectorsOnly} onChange={(e) => set("sectorsOnly", e.target.checked)} /> Only these industries</label>
          <Checks legend="Industries they won't do" options={sectorOptions} selected={p.sectorsExcluded} onChange={(v) => set("sectorsExcluded", v)} />
        </div>

        <h2>Ownership</h2>
        <div className="fields">
          <div className="field">
            <label htmlFor="l-own">Ownership requirement</label>
            <select id="l-own" value={p.ownershipRequirement} onChange={(e) => set("ownershipRequirement", e.target.value as OwnershipRequirement)}>
              {(Object.keys(OWNERSHIP_LABELS) as OwnershipRequirement[]).map((k) => <option key={k} value={k}>{OWNERSHIP_LABELS[k]}</option>)}
            </select>
          </div>
          {p.ownershipRequirement === "specific" && <div className="field"><label htmlFor="l-ownl">Which group</label><input id="l-ownl" type="text" value={p.ownershipLabel ?? ""} onChange={(e) => set("ownershipLabel", e.target.value)} placeholder="e.g. Native American or tribal ownership" /></div>}
          <label className="check field-check full"><input type="checkbox" checked={p.diverseFocus} onChange={(e) => set("diverseFocus", e.target.checked)} /> Has a mandate to back minority-owned businesses (ranks them higher for those deals)</label>
        </div>

        <h2>Notes for the team</h2>
        <div className="fields">
          <div className="field full"><label htmlFor="l-ask">Ask first</label><input id="l-ask" type="text" value={p.nextQuestion} onChange={(e) => set("nextQuestion", e.target.value)} placeholder="The one question to ask before sending a deal" /></div>
          <div className="field full"><label htmlFor="l-strat">What they do</label><textarea id="l-strat" rows={3} value={p.strategyNote} onChange={(e) => set("strategyNote", e.target.value)} /></div>
          <div className="field full"><label htmlFor="l-src">Links</label><textarea id="l-src" rows={2} value={sourcesText} onChange={(e) => { setSourcesText(e.target.value); set("sources", e.target.value.split(/\s+/).filter((u) => /^https?:\/\//.test(u))); }} placeholder="One web address per line" /></div>
        </div>

        {tried && problems.length > 0 && <ul className="form-error" role="alert">{problems.map((x) => <li key={x}>{x}</li>)}</ul>}
        <div className="form-actions">
          <a href={existing ? lenderHash(existing.provider.id) : "#lenders"} className="btn btn-secondary">Cancel</a>
          <button className="btn btn-primary" disabled={st.readOnly}>{existing ? "Save changes" : "Add to the list"}</button>
        </div>
      </form>
    </div>
  );
}

// ── App ──
function App() {
  const [hash, setHash] = useState(location.hash);
  const [, setVersion] = useState(0);
  useEffect(() => {
    const onHash = () => { setHash(location.hash); window.scrollTo(0, 0); };
    window.addEventListener("hashchange", onHash);
    const unsub = store.subscribe(() => setVersion((v) => v + 1));
    return () => { window.removeEventListener("hashchange", onHash); unsub(); };
  }, []);
  const h = hash.replace(/^#/, "");
  let tab: "deals" | "lenders" | "new" = "deals";
  let page: React.ReactNode;
  if (h === "new") { tab = "new"; page = <NewDealPage />; }
  else if (h.startsWith("deal-")) page = <DealPage key={h} id={`deal_${h.slice(5)}`} />;
  else if (h === "lenders") { tab = "lenders"; page = <LendersPage />; }
  else if (h === "add-lender") { tab = "lenders"; page = <LenderForm key="add" id={null} />; }
  // Remount once the team's edits arrive, so the form starts from the latest version.
  else if (h.startsWith("edit-")) { tab = "lenders"; page = <LenderForm key={`${h}-${store.getStatus().loading}`} id={`prov_${h.slice(5)}`} />; }
  else if (h.startsWith("lender-")) { tab = "lenders"; page = <LenderPage key={h} id={`prov_${h.slice(7)}`} />; }
  else page = <DealsPage />;
  return (
    <>
      <Header tab={tab} />
      <Notice />
      <main>{page}</main>
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
