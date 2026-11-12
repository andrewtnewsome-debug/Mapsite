import * as store from "./store";
import { makeCimReader } from "./cim-browser";
import {
  CAPITAL_TYPE_LABELS, SECTOR_LABELS, STATUS_LABELS, TIMELINE_LABELS, USE_OF_FUNDS_LABELS,
  dateTime, growth, margin, money, pct, range, shortDate, stateList,
} from "portal/lib/format";
import { evaluateProvider, matchProviders, type ProviderMatch } from "portal/lib/matching";
import { scoreSubmission } from "portal/lib/scoring";
import { parseSubmission } from "portal/lib/formInput";
import type { Provider, Status } from "portal/lib/types";
import ApplyForm, { type ReadCim } from "portal/app/apply/ApplyForm";
import { AcquisitionTerms, BuyerPanel, CimPanel, IndustryPanel, NextSteps, SummaryPanel } from "portal/app/components/DealPanels";
import OnePagerStudio from "portal/app/components/OnePagerStudio";
import IntroEmail from "portal/app/components/IntroEmail";
import { useLinkEnv } from "./link-env";
import type { Submission } from "portal/lib/types";

declare const React: typeof import("react");
declare const ReactDOM: typeof import("react-dom/client");
declare const LOGO: string;
const { useState, useEffect, useRef } = React;

// ── Routing: plain #names only (#home, #apply, #team, #deal-seed01, #partner-unity) ──
const dealHash = (id: string) => `#deal-${id.replace(/^sub_/, "")}`;
const partnerHash = (id: string) => `#partner-${id.replace(/^prov_/, "")}`;
function go(hash: string) {
  if (location.hash === hash) window.scrollTo(0, 0);
  else location.hash = hash;
}

function SiteHeader() {
  function how(e: React.MouseEvent) {
    e.preventDefault();
    if (location.hash && location.hash !== "#home") location.hash = "#home";
    setTimeout(() => document.getElementById("how")?.scrollIntoView({ behavior: "smooth" }), 60);
  }
  return (
    <header className="site-header">
      <div className="container">
        <a href="#home" aria-label="MAP Lab Center home"><img src={LOGO} alt="MAP Lab Center" /></a>
        <nav className="site-nav">
          <a href="#home" onClick={how} className="hide-sm">How it works</a>
          <a href="#apply" className="btn btn-primary btn-sm" style={{ color: "#fff" }}>Submit your raise</a>
          <a href="#team" className="team-link">Team view</a>
        </nav>
      </div>
    </header>
  );
}

function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container">
        <span>© 2026 MAP Lab Center. Information you submit is kept confidential.</span>
        <a href="#team">Team view</a>
      </div>
    </footer>
  );
}

// ── Public ──
function Home() {
  const providers = store.listProviders();
  const mins = providers.flatMap((p) => (p.checkMin === null ? [] : [p.checkMin]));
  const maxes = providers.flatMap((p) => (p.checkMax === null ? [] : [p.checkMax]));
  const mission = providers.filter((p) => p.diverseFocus).length;
  const byType = (Object.keys(CAPITAL_TYPE_LABELS) as CapitalType[]).map((t) => {
    const offering = providers.filter((p) => p.capitalTypes.includes(t));
    const lo = offering.flatMap((p) => (p.checkMin === null ? [] : [p.checkMin]));
    const hi = offering.flatMap((p) => (p.checkMax === null ? [] : [p.checkMax]));
    return { t, count: offering.length, span: range(lo.length ? Math.min(...lo) : null, hi.length ? Math.max(...hi) : null) };
  }).filter((x) => x.count > 0);
  return (
    <>
      <section className="hero">
        <div className="container hero-grid">
          <div>
            <div className="eyebrow">MAP Lab Center · Capital Raise Portal</div>
            <h1>Put your raise in front of the <em>right capital</em>, not every capital.</h1>
            <p className="lede">
              Tell us about your company and the capital you need. Our team reviews every submission, sizes the
              opportunity, and makes targeted introductions to the banks, lenders, and equity investors in our network
              that actually fit your deal.
            </p>
            <div className="hero-actions">
              <a href="#apply" className="btn btn-primary">Submit your raise</a>
              <a href="#home" className="btn btn-secondary" onClick={(e) => { e.preventDefault(); document.getElementById("how")?.scrollIntoView({ behavior: "smooth" }); }}>How it works</a>
            </div>
          </div>
          <div className="hero-panel">
            <h3>Capital we arrange</h3>
            <ul className="capital-list">
              {byType.map(({ t, count, span }) => (
                <li key={t}>{CAPITAL_TYPE_LABELS[t]} <span>{count} {count === 1 ? "partner" : "partners"}</span></li>
              ))}
            </ul>
          </div>
        </div>
      </section>
      <section className="band" id="how">
        <div className="container">
          <div className="eyebrow">How it works</div>
          <h2>Three steps from submission to introduction</h2>
          <p className="sub">The form takes about ten minutes. Have last year&apos;s revenue and EBITDA handy.</p>
          <div className="steps">
            <div className="step"><div className="step-num">1</div><h3>Tell us about the deal</h3><p>Company basics, headline financials, and what the capital is for. No data room needed yet.</p></div>
            <div className="step"><div className="step-num">2</div><h3>We review and size it</h3><p>Our team scores fit, classifies the business, and identifies which capital providers can say yes.</p></div>
            <div className="step"><div className="step-num">3</div><h3>Warm introductions</h3><p>We make direct introductions to the best-fit lenders and investors, with a one-page teaser.</p></div>
          </div>
          <div className="stats-row">
            <div className="stat-big"><strong>{providers.length}</strong><span>Capital partners in our network</span></div>
            <div className="stat-big"><strong>{byType.length}</strong><span>Kinds of capital, from SBA loans to majority equity</span></div>
            <div className="stat-big"><strong>{mission}</strong><span>Partners with a mandate for minority-owned businesses</span></div>
            <div className="stat-big"><strong>5 days</strong><span>Target time to first review</span></div>
          </div>
        </div>
      </section>
      <section className="cta-band">
        <div className="container">
          <div>
            <h2>Raising debt or equity in the next 12 months?</h2>
            <p>Start with a short submission. There is no cost to apply.</p>
          </div>
          <a href="#apply" className="btn btn-primary">Submit your raise</a>
        </div>
      </section>
    </>
  );
}

let lastRef = "";

declare global {
  interface Window { claude?: { use(name: string): Promise<unknown> } }
}

function ApplyPage() {
  const [readCim, setReadCim] = useState<ReadCim | null>(null);
  // CIM upload appears once this view can ask Claude (it can't outside a Claude viewer).
  useEffect(() => {
    let live = true;
    window.claude?.use("sample").then((sample) => {
      if (live && sample) setReadCim(() => makeCimReader(sample as Parameters<typeof makeCimReader>[0]));
    });
    return () => { live = false; };
  }, []);
  return (
    <div className="container">
      <ApplyForm
        readCim={readCim}
        onSubmit={(fd) => {
          lastRef = store.createSubmission(parseSubmission(fd)).id;
          go("#thanks");
        }}
      />
    </div>
  );
}

function Thanks() {
  return (
    <div className="container">
      <div className="card thanks">
        <div className="check-icon">✓</div>
        <h1>Thanks, we have your submission</h1>
        <p>Reference <span className="ref">{lastRef || "pending"}</span></p>
        <ol>
          <li>A confirmation email is on its way to you.</li>
          <li>Our team reviews your deal within five business days.</li>
          <li>If there&apos;s a fit, we&apos;ll schedule a call and prepare introductions to matched capital providers.</li>
        </ol>
        <div className="row-center">
          <a href="#home" className="btn btn-secondary">Back to home</a>
          {lastRef && <a href={dealHash(lastRef)} className="btn btn-primary">See it in Team view</a>}
        </div>
        <p className="placeholder-note">Prototype: no email is sent yet. Confirmation emails arrive when Resend is connected.</p>
      </div>
    </div>
  );
}

// ── Team view ──
function ScoreRing({ score, size = 38 }: { score: number; size?: number }) {
  const color = score >= 75 ? "var(--green)" : score >= 55 ? "#e0a43a" : "#d9604f";
  return (
    <span className="score-ring" style={{ width: size, height: size, background: `conic-gradient(${color} ${score * 3.6}deg, #eceeea 0deg)`, padding: 4 }}>
      <span className="score-inner" style={{ fontSize: size > 50 ? 20 : 13 }}>{score}</span>
    </span>
  );
}
const StatusBadge = ({ status }: { status: Status }) => <span className={`badge ${status}`}>{STATUS_LABELS[status]}</span>;

function TeamShell({ tab, children }: { tab: "subs" | "providers"; children: React.ReactNode }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <div className="team-bar">
        <div className="container">
          <nav className="team-tabs">
            <a href="#team" className={tab === "subs" ? "active" : ""}>Submissions</a>
            <a href="#providers" className={tab === "providers" ? "active" : ""}>Capital providers</a>
          </nav>
          <div className="team-bar-right">
            <span className="proto-pill">Prototype · no login</span>
            {confirm ? (
              <span className="reset-confirm">
                Erase your changes?
                <button className="link-btn" onClick={() => { store.resetData(); setConfirm(false); }}>Yes, reset</button>
                <button className="link-btn" onClick={() => setConfirm(false)}>Cancel</button>
              </span>
            ) : (
              <button className="link-btn" onClick={() => setConfirm(true)}>Reset sample data</button>
            )}
          </div>
        </div>
      </div>
      <div className="container">{children}</div>
    </>
  );
}

const FILTERS: (Status | "all")[] = ["all", "new", "in_review", "introduced", "closed", "declined"];

function Dashboard() {
  const [status, setStatusFilter] = useState<Status | "all">("all");
  const [sort, setSort] = useState<"date" | "score">("date");
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const providers = store.listProviders();
  const all = store.listSubmissions().map((s) => ({ s, fit: scoreSubmission(s), match: matchProviders(s, providers) }));
  const rows = all
    .filter((r) => status === "all" || r.s.status === status)
    .filter((r) => !q || [r.s.company.name, r.s.company.city, r.s.naics.title, r.s.acquirer?.current?.name ?? ""].join(" ").toLowerCase().includes(q))
    .sort((a, b) => (sort === "score" ? b.fit.total - a.fit.total : b.s.createdAt.localeCompare(a.s.createdAt)));
  const open = all.filter((r) => r.s.status === "new" || r.s.status === "in_review");
  const avg = Math.round(all.reduce((n, r) => n + r.fit.total, 0) / Math.max(all.length, 1));
  const count = (f: Status | "all") => (f === "all" ? all.length : all.filter((r) => r.s.status === f).length);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Submissions</h1>
          <p>Every inbound raise, scored for fit and matched against the capital provider network.</p>
        </div>
        <a href="#apply" className="btn btn-primary btn-sm" style={{ color: "#fff" }}>+ Add a deal</a>
      </div>
      <div className="tiles">
        <div className="card tile"><div className="label">Awaiting action</div><div className="value">{open.length}</div><div className="foot">New or in review</div></div>
        <div className="card tile"><div className="label">Capital requested (open)</div><div className="value">{money(open.reduce((n, r) => n + r.s.deal.amount, 0))}</div><div className="foot">Across {open.length} deals</div></div>
        <div className="card tile"><div className="label">Average fit score</div><div className="value">{avg}</div><div className="foot">Out of 100</div></div>
        <div className="card tile"><div className="label">Strong fits</div><div className="value">{all.filter((r) => r.fit.tier === "Strong").length}</div><div className="foot">Score 75 or higher</div></div>
      </div>
      <div className="search" role="search">
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search deals by company, buyer, city or industry" aria-label="Search deals" />
      </div>
      <div className="filter-row">
        <div className="filters">
          {FILTERS.map((f) => (
            <button key={f} onClick={() => setStatusFilter(f)} className={`chip ${status === f ? "active" : ""}`}>
              {f === "all" ? "All" : STATUS_LABELS[f]}<span className="n">{count(f)}</span>
            </button>
          ))}
        </div>
        <div className="filters">
          <button onClick={() => setSort("date")} className={`chip ${sort === "date" ? "active" : ""}`}>Newest</button>
          <button onClick={() => setSort("score")} className={`chip ${sort === "score" ? "active" : ""}`}>Highest fit</button>
        </div>
      </div>
      <div className="card table-wrap page-end">
        <table className="data deals">
          <thead>
            <tr><th>Fit</th><th>Company</th><th>Industry (NAICS)</th><th className="num">Raise</th><th>Top match</th><th className="num">Confirmed matches</th><th>Status</th><th>Submitted</th></tr>
          </thead>
          <tbody>
            {rows.map(({ s, fit, match }) => (
              <tr key={s.id} className="rowlink" onClick={() => go(dealHash(s.id))}>
                <td><ScoreRing score={fit.total} /></td>
                <td>
                  <a href={dealHash(s.id)} className="name">{s.company.name}</a><div className="muted">{s.company.city}, {s.company.state}</div>
                  {s.acquirer && <div className="muted">Buyer: {s.acquirer.current?.name ?? "first-time buyer"}{s.acquirer.combine ? " (add-on)" : ""}</div>}
                </td>
                <td><div className="small">{s.naics.title.replace(/\s*\(.*\)$/, "")}</div><div className="muted">{s.naics.code}</div></td>
                <td className="num"><strong>{money(s.deal.amount)}</strong><div className="muted">{CAPITAL_TYPE_LABELS[s.deal.capitalType]}</div></td>
                <td className="small">
                  {match.matches[0] ? match.matches[0].provider.name : <span className="muted">No eligible provider</span>}
                  {match.matches[0] && match.matches[0].toConfirm.length > 0 && <div className="muted">To confirm</div>}
                </td>
                <td className="num">{match.confirmed.length}{match.possible.length > 0 && <div className="muted">+{match.possible.length} possible</div>}</td>
                <td><StatusBadge status={s.status} /></td>
                <td className="muted nowrap">{shortDate(s.createdAt)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={8} className="empty">No deals match.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

const OUTCOME_ICON = { pass: "✓", fail: "✕", confirm: "?" } as const;

function MatchCard({ m, s, introducedAt }: { m: ProviderMatch; s: Submission; introducedAt?: string }) {
  const submissionId = s.id;
  const env = useLinkEnv();
  const p = m.provider;
  const fails = m.requirements.filter((r) => r.outcome === "fail");
  const met = m.requirements.filter((r) => r.outcome === "pass").length;
  return (
    <div className="match">
      <div className="match-top">
        <div>
          <h3><a href={partnerHash(p.id)}>{p.name}</a></h3>
          <div className="muted">{p.fund} · {p.type} · {range(p.checkMin, p.checkMax) ?? "Check size not published"}</div>
        </div>
        <div className="match-score">
          {m.eligible ? (<><strong>{m.score}</strong><div><span className={`badge ${m.strength}`}>{m.strength}</span></div></>) : <span className="badge Low">Near miss</span>}
        </div>
      </div>
      <div className="why">
        {fails.map((r) => <span key={r.label} className="tag miss">{r.detail}</span>)}
        {m.toConfirm.map((r) => <span key={r.label} className="tag confirm">{r.label}: {r.detail}</span>)}
        {m.reasons.map((r) => <span key={r} className="tag ok">{r}</span>)}
      </div>
      <details className="req">
        <summary>Requirements: {met} met{m.toConfirm.length > 0 && `, ${m.toConfirm.length} to confirm`}{fails.length > 0 && `, ${fails.length} not met`}</summary>
        <ul>
          {m.requirements.map((r) => (
            <li key={r.label} className={`req-${r.outcome}`}>{OUTCOME_ICON[r.outcome]} <strong>{r.label}:</strong> {r.detail}</li>
          ))}
        </ul>
      </details>
      {m.eligible && (
        <div className="match-foot">
          <span className="muted">Ask first: {p.nextQuestion}</span>
          <div className="match-buttons">
            <IntroEmail s={s} m={m} env={env.intro} />
            {introducedAt
              ? <span className="badge introduced">Introduced {shortDate(introducedAt)}</span>
              : <button className="btn btn-secondary btn-sm" onClick={() => store.logIntroduction(submissionId, p.id)}>Log introduction</button>}
          </div>
        </div>
      )}
    </div>
  );
}

function NotFound({ what }: { what: string }) {
  return <div className="card thanks"><h1>{what} not found</h1><p>It may have been removed when the sample data was reset.</p><div className="row-center"><a className="btn btn-primary" href="#team">Back to submissions</a></div></div>;
}

function OnePagerBand({ s }: { s: Submission }) {
  const env = useLinkEnv();
  return (
    <div className="op-band">
      <OnePagerStudio key={s.id} s={s} env={{ ...env.onePager, persist: (p) => store.saveOnePager(s.id, p) }} />
    </div>
  );
}

function SubmissionPage({ id }: { id: string }) {
  const [note, setNote] = useState("");
  const s = store.getSubmission(id);
  if (!s) return <NotFound what="Submission" />;
  const fit = scoreSubmission(s);
  const providers = store.listProviders();
  const { matches, confirmed, possible, nearMisses } = matchProviders(s, providers);
  const f = s.financials;
  const g = growth(f.revenueLTM, f.revenuePrior);
  const introduced = new Map(s.introductions.map((i) => [i.providerId, i.at]));

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb"><a href="#team">Submissions</a> / {s.company.name}</div>
          <h1>{s.company.name}</h1>
          <p>{s.acquirer && <>Acquisition by {s.acquirer.current?.name ?? "a first-time buyer"} · </>}{s.company.city}, {s.company.state} · Founded {s.company.yearFounded} · {s.company.employees} employees · Submitted {shortDate(s.createdAt)}</p>
        </div>
        <div className="status-row" aria-label="Status">
          {(Object.keys(STATUS_LABELS) as Status[]).map((st) => (
            <button key={st} className={`chip ${s.status === st ? `active ${st}` : ""}`} onClick={() => store.setStatus(s.id, st)}>{STATUS_LABELS[st]}</button>
          ))}
        </div>
      </div>

      <NextSteps s={s} confirmed={confirmed.length} possible={possible.length} />
      <OnePagerBand s={s} />
      <div className="detail-grid">
        <div className="stack">
          <div className="card panel">
            <div className="panel-head"><h2>The raise</h2><span className="muted">{TIMELINE_LABELS[s.deal.timeline]}</span></div>
            <div className="kv">
              <div><span>Amount</span><strong>{money(s.deal.amount)}</strong></div>
              <div><span>Type</span><strong>{CAPITAL_TYPE_LABELS[s.deal.capitalType]}</strong></div>
              <div><span>Use of funds</span><strong>{USE_OF_FUNDS_LABELS[s.deal.useOfFunds]}</strong></div>
              <div><span>{s.acquirer ? "Target revenue (LTM)" : "Revenue (LTM)"}</span><strong>{money(f.revenueLTM)}</strong></div>
              <div><span>{s.acquirer ? "Target EBITDA (LTM)" : "EBITDA (LTM)"}</span><strong>{money(f.ebitdaLTM)} <span className="muted">{pct(margin(f.revenueLTM, f.ebitdaLTM), 1)}</span></strong></div>
              <div><span>Revenue growth</span><strong>{g === null ? "—" : `${g >= 0 ? "+" : ""}${pct(g, 1)}`}</strong></div>
            </div>
            {s.deal.details && <p className="deal-details">{s.deal.details}</p>}
            <AcquisitionTerms s={s} />
          </div>

          <BuyerPanel s={s} />
          <CimPanel s={s} />
          <SummaryPanel s={s} />

          <div className="card panel">
            <div className="panel-head"><h2>Matched capital providers</h2><span className="muted">{confirmed.length} confirmed · {possible.length} possible · {providers.length} checked</span></div>
            {matches.length === 0 && <p className="empty">No provider meets every requirement for this deal as submitted.</p>}
            {confirmed.length > 0 && <h3 className="group-head">Meets every published criterion <span className="muted">({confirmed.length})</span></h3>}
            {confirmed.map((m) => <MatchCard key={m.provider.id} m={m} s={s} introducedAt={introduced.get(m.provider.id)} />)}
            {possible.length > 0 && (
              <details className="group" open={confirmed.length === 0}>
                <summary>Possible, confirm first <span className="muted">({possible.length}; some criteria unpublished or not checkable from the form)</span></summary>
                {possible.map((m) => <MatchCard key={m.provider.id} m={m} s={s} introducedAt={introduced.get(m.provider.id)} />)}
              </details>
            )}
            {nearMisses.length > 0 && (
              <details className="group">
                <summary>Near misses <span className="muted">({nearMisses.length}; one requirement short, could work if the deal is resized)</span></summary>
                {nearMisses.map((m) => <MatchCard key={m.provider.id} m={m} s={s} />)}
              </details>
            )}
          </div>
        </div>

        <div className="stack">
          <div className="card panel">
            <div className="score-hero">
              <ScoreRing score={fit.total} size={72} />
              <div><div className="muted">MAPlab fit score</div><span className={`badge ${fit.tier}`}>{fit.tier} fit</span></div>
            </div>
            <p className="muted basis-note">Scored on {fit.basis.label}.</p>
            {fit.factors.map((x) => (
              <div className="factor" key={x.key}>
                <span className="f-label">{x.label}</span>
                <span className="f-pts">{x.points} / {x.max}</span>
                <div className="bar"><i style={{ width: `${(x.points / x.max) * 100}%` }} /></div>
                <span className="f-detail">{x.detail}</span>
              </div>
            ))}
          </div>

          <IndustryPanel s={s} />

          <div className="card panel">
            <div className="panel-head"><h2>Contact</h2></div>
            <div className="contact-list">
              <strong>{s.contact.name}</strong><span>{s.contact.title}</span><span className="select">{s.contact.email}</span><span>{s.contact.phone}</span>
              {s.company.website && <span className="muted">{s.company.website}</span>}
            </div>
          </div>

          <div className="card panel">
            <div className="panel-head"><h2>Team notes</h2></div>
            <div className="notes">
              {s.notes.length === 0 && <p className="muted">No notes yet.</p>}
              {s.notes.map((n) => <div className="note" key={n.at}><div className="meta">{n.author} · {dateTime(n.at)}</div>{n.text}</div>)}
            </div>
            <form className="note-form" onSubmit={(e) => {
              e.preventDefault();
              if (!note.trim()) return;
              store.addNote(s.id, { at: new Date().toISOString(), author: "You (MAPlab)", text: note.trim() });
              setNote("");
            }}>
              <textarea id="note-text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note for the team" required />
              <button className="btn btn-primary btn-sm">Add note</button>
            </form>
          </div>

          <div className="card panel">
            <div className="panel-head"><h2>Company description</h2></div>
            <p className="small-gray">{s.company.description}</p>
          </div>
        </div>
      </div>
    </>
  );
}

function geoShort(p: Provider) {
  return p.geographies.includes("National") ? "National" : p.geographies.length > 8 ? `${p.geographies.length} states` : p.geographies.join(", ");
}
const sectorList = (keys: string[]) => keys.map((k) => SECTOR_LABELS[k] ?? k).join(", ");

function ProvidersPage() {
  const [group, setGroup] = useState("all");
  const all = store.listProviders();
  const groups = Array.from(new Set(all.map((p) => p.category)));
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const providers = all.filter((p) => (group === "all" || p.category === group) && (!q || [p.name, p.fund, p.type, p.ref].join(" ").toLowerCase().includes(q)));
  const open = store.listSubmissions().filter((s) => s.status === "new" || s.status === "in_review");
  return (
    <>
      <div className="page-head">
        <div><h1>Capital providers</h1><p>{all.length} profiles from the Minority Business Investor Database. Their published criteria drive the matching on every submission.</p></div>
      </div>
      <div className="search" role="search">
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search providers by name, fund or type" aria-label="Search providers" />
      </div>
      <div className="filters">
        <button className={`chip ${group === "all" ? "active" : ""}`} onClick={() => setGroup("all")}>All<span className="n">{all.length}</span></button>
        {groups.map((g) => (
          <button key={g} className={`chip ${group === g ? "active" : ""}`} onClick={() => setGroup(g)}>{g}<span className="n">{all.filter((p) => p.category === g).length}</span></button>
        ))}
      </div>
      <div className="provider-grid">
        {providers.map((p) => {
          const live = open.filter((s) => evaluateProvider(s, p).eligible).length;
          return (
            <a key={p.id} href={partnerHash(p.id)} className="card provider-card">
              <div className="pc-top">
                <div><h3>{p.name}</h3><div className="type">{p.ref} · {p.fund}</div></div>
                <span className={`badge ${live > 0 ? "Strong" : "Possible"}`}>{live} open {live === 1 ? "match" : "matches"}</span>
              </div>
              <dl className="crit">
                <dt>Type</dt><dd>{p.type}</dd>
                <dt>Focus</dt><dd>{p.relevance}</dd>
                <dt>Capital</dt><dd>{p.capitalTypes.map((c) => CAPITAL_TYPE_LABELS[c]).join(", ")}</dd>
                <dt>Check size</dt><dd>{range(p.checkMin, p.checkMax) ?? "Not published"}</dd>
                <dt>EBITDA</dt><dd>{range(p.ebitdaMin, p.ebitdaMax) ?? (p.requiresPositiveEbitda ? "Positive" : "Not published")}</dd>
                <dt>Geography</dt><dd>{geoShort(p)}</dd>
                <dt>Industries</dt><dd>{p.sectorsPreferred.length ? `${p.sectorsOnly ? "Only " : ""}${sectorList(p.sectorsPreferred)}` : "No stated preference"}</dd>
              </dl>
            </a>
          );
        })}
      </div>
    </>
  );
}

function Row({ label, value, note }: { label: string; value: React.ReactNode; note?: string }) {
  return (<><dt>{label}</dt><dd>{value}{note && <span className="note">{note}</span>}</dd></>);
}

function ProviderPage({ id }: { id: string }) {
  const p = store.getProvider(id);
  if (!p) return <NotFound what="Provider" />;
  const evaluated = store.listSubmissions()
    .map((s) => ({ s, m: evaluateProvider(s, p), fit: scoreSubmission(s) }))
    .sort((a, b) => Number(b.m.eligible) - Number(a.m.eligible) || b.m.score - a.m.score);
  const ownershipRule = {
    none: "No ownership requirement",
    minority: "Minority-owned businesses only",
    minority_or_women: "Minority- or women-owned businesses only",
    specific: p.ownershipLabel ?? "Specific ownership group",
  }[p.ownershipRequirement];
  const geoNote = [
    p.geographiesConfirm.length ? `To confirm: ${p.geographiesConfirm.length > 10 ? "all other states" : p.geographiesConfirm.join(", ")}.` : "",
    p.geographyConfirm ? `${p.geographyConfirm}.` : "",
    p.geographyNote,
  ].filter(Boolean).join(" ");
  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb"><a href="#providers">Capital providers</a> / {p.ref}</div>
          <h1>{p.name}</h1>
          <p>{p.fund} · {p.type}</p>
        </div>
        <span className={`badge ${p.diverseFocus ? "Strong" : "Possible"}`}>{p.relevance}</span>
      </div>
      <div className="detail-grid">
        <div className="stack">
          <div className="card panel">
            <div className="panel-head"><h2>Before you reach out</h2></div>
            <dl className="crit">
              <Row label="Ask first" value={p.nextQuestion} />
              <Row label="Availability" value={p.status} />
              <Row label="Strategy" value={p.strategyNote} />
              <Row label="Acquisitions" value={p.acquisitionNote} />
              <Row label="Control" value={p.controlNote} />
              <Row label="Eligibility" value={p.ownershipNote} />
            </dl>
          </div>
          <div className="card table-wrap">
            <div className="panel"><div className="panel-head flush"><h2>Every submission against this provider&apos;s criteria</h2></div></div>
            <table className="data">
              <thead><tr><th>Fit</th><th>Company</th><th className="num">Raise</th><th>Result</th><th>Status</th></tr></thead>
              <tbody>
                {evaluated.map(({ s, m, fit }) => (
                  <tr key={s.id} className="rowlink" onClick={() => go(dealHash(s.id))}>
                    <td><ScoreRing score={fit.total} /></td>
                    <td><a href={dealHash(s.id)} className="name">{s.company.name}</a><div className="muted">{CAPITAL_TYPE_LABELS[s.deal.capitalType]}</div></td>
                    <td className="num">{money(s.deal.amount)}</td>
                    <td className="small">
                      {m.eligible
                        ? <><span className={`badge ${m.strength}`}>{m.strength} · {m.score}</span>{m.toConfirm.length > 0 && <div className="muted">{m.toConfirm.length} to confirm</div>}</>
                        : <span className="req-fail">{m.requirements.filter((r) => r.outcome === "fail").map((r) => r.detail).join("; ")}</span>}
                    </td>
                    <td><StatusBadge status={s.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="stack">
          <div className="card panel">
            <div className="panel-head"><h2>Matching criteria</h2></div>
            <dl className="crit">
              <Row label="Capital" value={p.capitalTypes.map((c) => CAPITAL_TYPE_LABELS[c]).join(", ")} />
              <Row label="Check size" value={range(p.checkMin, p.checkMax) ?? "Not published"} note={p.checkNote} />
              <Row label="EBITDA" value={range(p.ebitdaMin, p.ebitdaMax) ?? (p.requiresPositiveEbitda ? "Positive EBITDA" : "Not published")} note={p.ebitdaNote} />
              <Row label="Revenue" value={range(p.revenueMin, p.revenueMax) ?? "No screen applied"} note={p.revenueNote} />
              {p.minYears !== null && <Row label="Years operating" value={`${p.minYears}+`} />}
              <Row label="Geography" value={stateList(p.geographies)} note={geoNote} />
              <Row label="Industries" value={p.sectorsPreferred.length ? `${p.sectorsOnly ? "Only " : "Prefers "}${sectorList(p.sectorsPreferred)}` : "No stated preference"} note={p.industriesNote} />
              <Row label="Excludes" value={p.sectorsExcluded.length ? sectorList(p.sectorsExcluded) : "None applied"} note={p.exclusionsNote} />
              <Row label="Use of funds" value={p.useOfFunds.map((u) => USE_OF_FUNDS_LABELS[u]).join(", ")}
                note={p.useOfFundsConfirm.length ? `To confirm: ${p.useOfFundsConfirm.map((u) => USE_OF_FUNDS_LABELS[u]).join(", ")}` : undefined} />
              <Row label="Ownership" value={ownershipRule} />
            </dl>
          </div>
          {p.interpretations.length > 0 && (
            <div className="card panel">
              <div className="panel-head"><h2>How we read their criteria</h2></div>
              <ul className="prose-list">{p.interpretations.map((t) => <li key={t}>{t}</li>)}</ul>
            </div>
          )}
          <div className="card panel">
            <div className="panel-head"><h2>Sources</h2><span className="muted">{p.sourceQuality}</span></div>
            <ul className="source-list">
              {p.sources.map((u) => <li key={u}><a href={u} target="_blank" rel="noreferrer">{u.replace(/^https?:\/\//, "")}</a></li>)}
            </ul>
            <p className="placeholder-note">Research {p.ref}{p.researchChecked ? `, checked ${p.researchChecked}` : ""}. No manager was contacted.</p>
          </div>
        </div>
      </div>
    </>
  );
}

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
  let page: React.ReactNode;
  if (h === "apply") page = <ApplyPage />;
  else if (h === "thanks") page = <Thanks />;
  else if (h === "team") page = <TeamShell tab="subs"><Dashboard /></TeamShell>;
  else if (h === "providers") page = <TeamShell tab="providers"><ProvidersPage /></TeamShell>;
  else if (h.startsWith("deal-")) page = <TeamShell tab="subs"><SubmissionPage key={h} id={`sub_${h.slice(5)}`} /></TeamShell>;
  else if (h.startsWith("partner-")) page = <TeamShell tab="providers"><ProviderPage id={`prov_${h.slice(8)}`} /></TeamShell>;
  else page = <Home />;

  const isTeam = ["team", "providers"].includes(h) || h.startsWith("deal-") || h.startsWith("partner-");
  return (
    <>
      <SiteHeader />
      <main>{page}</main>
      {!isTeam && <SiteFooter />}
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
