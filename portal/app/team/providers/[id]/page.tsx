import Link from "next/link";
import { notFound } from "next/navigation";
import { getProvider, listSubmissions } from "@/lib/db";
import { CAPITAL_TYPE_LABELS, SECTOR_LABELS, USE_OF_FUNDS_LABELS, money, multiple } from "@/lib/format";
import { evaluateProvider } from "@/lib/matching";
import { ScoreRing, StatusBadge } from "../../ui";
import { scoreSubmission } from "@/lib/scoring";

export const dynamic = "force-dynamic";

export default async function ProviderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = getProvider(id);
  if (!p) notFound();

  const evaluated = listSubmissions()
    .map((s) => ({ s, m: evaluateProvider(s, p), fit: scoreSubmission(s) }))
    .sort((a, b) => Number(b.m.eligible) - Number(a.m.eligible) || b.m.score - a.m.score);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb"><Link href="/team/providers">Capital providers</Link> / {p.name}</div>
          <h1>{p.name}</h1>
          <p>{p.type}{p.diverseFocus ? " · Mandate to back minority-owned businesses" : ""}</p>
        </div>
      </div>

      <div className="detail-grid">
        <div className="card table-wrap">
          <div className="panel" style={{ paddingBottom: 0 }}>
            <div className="panel-head"><h2>Every submission against this provider&apos;s criteria</h2></div>
          </div>
          <table className="data">
            <thead>
              <tr><th>Fit</th><th>Company</th><th className="num">Raise</th><th>Result</th><th>Status</th></tr>
            </thead>
            <tbody>
              {evaluated.map(({ s, m, fit }) => (
                <tr key={s.id}>
                  <td><ScoreRing score={fit.total} /></td>
                  <td>
                    <Link href={`/team/submissions/${s.id}`} className="name">{s.company.name}</Link>
                    <div className="muted">{CAPITAL_TYPE_LABELS[s.deal.capitalType]}</div>
                  </td>
                  <td className="num">{money(s.deal.amount)}</td>
                  <td style={{ fontSize: 13 }}>
                    {m.eligible ? (
                      <span className={`badge ${m.strength}`}>{m.strength} · {m.score}</span>
                    ) : (
                      <span className="req-miss">{m.requirements.filter((r) => !r.passed).map((r) => r.detail).join("; ")}</span>
                    )}
                  </td>
                  <td><StatusBadge status={s.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="stack">
          <div className="card panel">
            <div className="panel-head"><h2>Criteria</h2></div>
            <dl className="crit">
              <dt>Capital</dt><dd>{p.capitalTypes.map((c) => CAPITAL_TYPE_LABELS[c]).join(", ")}</dd>
              <dt>Check size</dt><dd>{money(p.checkMin)} to {money(p.checkMax)}</dd>
              <dt>Min EBITDA</dt><dd>{p.minEbitda > 0 ? money(p.minEbitda) : "None"}</dd>
              <dt>Min revenue</dt><dd>{money(p.minRevenue)}</dd>
              <dt>Max leverage</dt><dd>{p.maxLeverage !== null ? multiple(p.maxLeverage) : "Not applicable"}</dd>
              <dt>Geography</dt><dd>{p.geographies.join(", ")}</dd>
              <dt>Industries</dt>
              <dd>{p.sectorsPreferred.length ? `${p.sectorsOnly ? "Only " : "Prefers "}${p.sectorsPreferred.map((k) => SECTOR_LABELS[k] ?? k).join(", ")}` : "Agnostic"}</dd>
              {p.sectorsExcluded.length > 0 && (<><dt>Excludes</dt><dd>{p.sectorsExcluded.map((k) => SECTOR_LABELS[k] ?? k).join(", ")}</dd></>)}
              <dt>Use of funds</dt><dd>{p.useOfFunds.map((u) => USE_OF_FUNDS_LABELS[u]).join(", ")}</dd>
            </dl>
          </div>
          <div className="card panel">
            <div className="panel-head"><h2>Relationship</h2></div>
            <div className="contact-list">
              <strong>{p.contact.name}</strong>
              <a href={`mailto:${p.contact.email}`}>{p.contact.email}</a>
            </div>
            <p style={{ fontSize: 13.5, color: "var(--gray-2)", marginTop: 12 }}>{p.notes}</p>
          </div>
        </div>
      </div>
    </>
  );
}
