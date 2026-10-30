import Link from "next/link";
import { notFound } from "next/navigation";
import { getSubmission, listProviders } from "@/lib/db";
import {
  CAPITAL_TYPE_LABELS,
  SECTOR_LABELS,
  STATUS_LABELS,
  TIMELINE_LABELS,
  USE_OF_FUNDS_LABELS,
  dateTime,
  growth,
  margin,
  money,
  pct,
  shortDate,
} from "@/lib/format";
import { matchProviders, type ProviderMatch } from "@/lib/matching";
import { scoreSubmission } from "@/lib/scoring";
import type { Status } from "@/lib/types";
import { introduce, postNote, updateStatus } from "../../actions";
import { ScoreRing, StatusBadge } from "../../ui";

export const dynamic = "force-dynamic";

const STATUSES = Object.keys(STATUS_LABELS) as Status[];

function MatchCard({
  m,
  submissionId,
  introducedAt,
}: {
  m: ProviderMatch;
  submissionId: string;
  introducedAt?: string;
}) {
  const misses = m.requirements.filter((r) => !r.passed);
  return (
    <div className="match">
      <div className="match-top">
        <div>
          <h3><Link href={`/team/providers/${m.provider.id}`}>{m.provider.name}</Link></h3>
          <div className="muted">
            {m.provider.type} · {money(m.provider.checkMin)} to {money(m.provider.checkMax)}
          </div>
        </div>
        <div className="match-score">
          {m.eligible ? (
            <>
              <strong>{m.score}</strong>
              <div><span className={`badge ${m.strength}`}>{m.strength}</span></div>
            </>
          ) : (
            <span className="badge Low">Near miss</span>
          )}
        </div>
      </div>
      <div className="why">
        {misses.map((r) => <span key={r.label} className="tag miss">{r.detail}</span>)}
        {m.reasons.map((r) => <span key={r} className="tag ok">{r}</span>)}
      </div>
      <details className="req">
        <summary>Requirements checked ({m.requirements.length - misses.length} of {m.requirements.length} met)</summary>
        <ul>
          {m.requirements.map((r) => (
            <li key={r.label} className={r.passed ? "req-ok" : "req-miss"}>
              {r.passed ? "✓" : "✕"} <strong>{r.label}:</strong> {r.detail}
            </li>
          ))}
        </ul>
      </details>
      {m.eligible && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <span className="muted">{m.provider.contact.name} · {m.provider.contact.email}</span>
          {introducedAt ? (
            <span className="badge introduced">Introduced {shortDate(introducedAt)}</span>
          ) : (
            <form action={introduce.bind(null, submissionId, m.provider.id)}>
              <button className="btn btn-secondary btn-sm">Log introduction</button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

export default async function SubmissionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = getSubmission(id);
  if (!s) notFound();

  const fit = scoreSubmission(s);
  const providers = listProviders();
  const { matches, nearMisses } = matchProviders(s, providers);
  const f = s.financials;
  const g = growth(f.revenueLTM, f.revenuePrior);
  const introduced = new Map(s.introductions.map((i) => [i.providerId, i.at]));

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb"><Link href="/team">Submissions</Link> / {s.company.name}</div>
          <h1>{s.company.name}</h1>
          <p>
            {s.company.city}, {s.company.state} · Founded {s.company.yearFounded} · {s.company.employees} employees ·
            Submitted {shortDate(s.createdAt)}
          </p>
        </div>
        <StatusBadge status={s.status} />
      </div>

      <div className="detail-grid">
        <div className="stack">
          <div className="card panel">
            <div className="panel-head">
              <h2>The raise</h2>
              <span className="muted">{TIMELINE_LABELS[s.deal.timeline]}</span>
            </div>
            <div className="kv">
              <div><span>Amount</span><strong>{money(s.deal.amount)}</strong></div>
              <div><span>Type</span><strong>{CAPITAL_TYPE_LABELS[s.deal.capitalType]}</strong></div>
              <div><span>Use of funds</span><strong>{USE_OF_FUNDS_LABELS[s.deal.useOfFunds]}</strong></div>
              <div><span>Revenue (LTM)</span><strong>{money(f.revenueLTM)}</strong></div>
              <div><span>EBITDA (LTM)</span><strong>{money(f.ebitdaLTM)} <span className="muted">{pct(margin(f.revenueLTM, f.ebitdaLTM), 1)}</span></strong></div>
              <div><span>Revenue growth</span><strong>{g === null ? "—" : `${g >= 0 ? "+" : ""}${pct(g, 1)}`}</strong></div>
            </div>
            {s.deal.details && <p style={{ marginTop: 16, fontSize: 14, color: "var(--gray-2)" }}>{s.deal.details}</p>}
          </div>

          <div className="card panel">
            <div className="panel-head">
              <h2>Deal summary</h2>
              <span className="badge ai">AI draft · placeholder</span>
            </div>
            <p className="summary-text">{s.ai.summary}</p>
            <div className="two-col">
              <div>
                <h4 className="h-good">Highlights</h4>
                <ul>{s.ai.highlights.map((h) => <li key={h}>{h}</li>)}</ul>
              </div>
              <div>
                <h4 className="h-risk">Watch items</h4>
                <ul>{s.ai.risks.map((h) => <li key={h}>{h}</li>)}</ul>
              </div>
            </div>
            <p className="placeholder-note">
              Placeholder text built from the submitted fields. In Phase 1 Claude writes this summary. Generated {dateTime(s.ai.generatedAt)}.
            </p>
          </div>

          <div className="card panel">
            <div className="panel-head">
              <h2>Matched capital providers</h2>
              <span className="muted">{matches.length} eligible of {providers.length}</span>
            </div>
            {matches.length === 0 && <p className="empty">No provider meets every requirement for this deal as submitted.</p>}
            {matches.map((m) => (
              <MatchCard key={m.provider.id} m={m} submissionId={s.id} introducedAt={introduced.get(m.provider.id)} />
            ))}
            {nearMisses.length > 0 && (
              <>
                <h3 style={{ fontSize: 14, margin: "22px 0 10px" }}>Near misses <span className="muted">(one requirement short; could work if the deal is resized)</span></h3>
                {nearMisses.map((m) => <MatchCard key={m.provider.id} m={m} submissionId={s.id} />)}
              </>
            )}
          </div>
        </div>

        <div className="stack">
          <div className="card panel">
            <div className="score-hero">
              <ScoreRing score={fit.total} size={72} />
              <div>
                <div className="muted">MAPlab fit score</div>
                <span className={`badge ${fit.tier}`}>{fit.tier} fit</span>
              </div>
            </div>
            {fit.factors.map((x) => (
              <div className="factor" key={x.key}>
                <span className="f-label">{x.label}</span>
                <span className="f-pts">{x.points} / {x.max}</span>
                <div className="bar"><i style={{ width: `${(x.points / x.max) * 100}%` }} /></div>
                <span className="f-detail">{x.detail}</span>
              </div>
            ))}
          </div>

          <div className="card panel">
            <div className="panel-head">
              <h2>Industry</h2>
              <span className="badge ai">AI draft · placeholder</span>
            </div>
            <div className="naics-code">{s.naics.code}</div>
            <div style={{ fontWeight: 600, fontSize: 14, margin: "2px 0 8px" }}>{s.naics.title}</div>
            <div className="muted" style={{ marginBottom: 8 }}>
              Sector: {SECTOR_LABELS[s.naics.sector] ?? s.naics.sector} · Confidence {Math.round(s.naics.confidence * 100)}%
            </div>
            <p style={{ fontSize: 13, color: "var(--gray-2)" }}>{s.naics.rationale}</p>
            {s.naics.alternates.length > 0 && (
              <p className="muted" style={{ marginTop: 8 }}>
                Also considered: {s.naics.alternates.map((a) => a.code).join(", ")}
              </p>
            )}
          </div>

          <div className="card panel">
            <div className="panel-head"><h2>Status</h2></div>
            <div className="status-buttons">
              {STATUSES.map((st) => (
                <form key={st} action={updateStatus.bind(null, s.id, st)}>
                  <button className={`btn btn-secondary btn-sm ${s.status === st ? "current" : ""}`} style={{ width: "100%" }}>
                    {STATUS_LABELS[st]}
                  </button>
                </form>
              ))}
            </div>
          </div>

          <div className="card panel">
            <div className="panel-head"><h2>Contact</h2></div>
            <div className="contact-list">
              <strong>{s.contact.name}</strong>
              <span>{s.contact.title}</span>
              <a href={`mailto:${s.contact.email}`}>{s.contact.email}</a>
              <span>{s.contact.phone}</span>
              {s.company.website && <span className="muted">{s.company.website}</span>}
            </div>
          </div>

          <div className="card panel">
            <div className="panel-head"><h2>Team notes</h2></div>
            <div className="notes">
              {s.notes.length === 0 && <p className="muted">No notes yet.</p>}
              {s.notes.map((n) => (
                <div className="note" key={n.at}>
                  <div className="meta">{n.author} · {dateTime(n.at)}</div>
                  {n.text}
                </div>
              ))}
            </div>
            <form action={postNote.bind(null, s.id)} style={{ display: "grid", gap: 8 }}>
              <textarea name="text" placeholder="Add a note for the team" style={{ minHeight: 70 }} required />
              <button className="btn btn-primary btn-sm" style={{ justifySelf: "end" }}>Add note</button>
            </form>
          </div>

          <div className="card panel">
            <div className="panel-head"><h2>Company description</h2></div>
            <p style={{ fontSize: 13.5, color: "var(--gray-2)" }}>{s.company.description}</p>
          </div>
        </div>
      </div>
    </>
  );
}
