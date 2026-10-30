import Link from "next/link";
import { notFound } from "next/navigation";
import { getProvider, listSubmissions } from "@/lib/db";
import { CAPITAL_TYPE_LABELS, SECTOR_LABELS, USE_OF_FUNDS_LABELS, money, range, stateList } from "@/lib/format";
import { evaluateProvider } from "@/lib/matching";
import { scoreSubmission } from "@/lib/scoring";
import { ScoreRing, StatusBadge } from "../../ui";

export const dynamic = "force-dynamic";

function Row({ label, value, note }: { label: string; value: React.ReactNode; note?: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}{note && <span className="note">{note}</span>}</dd>
    </>
  );
}

export default async function ProviderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = getProvider(id);
  if (!p) notFound();

  const evaluated = listSubmissions()
    .map((s) => ({ s, m: evaluateProvider(s, p), fit: scoreSubmission(s) }))
    .sort((a, b) => Number(b.m.eligible) - Number(a.m.eligible) || b.m.score - a.m.score);
  const sectors = (keys: string[]) => keys.map((k) => SECTOR_LABELS[k] ?? k).join(", ");
  const ownershipRule = {
    none: "No ownership requirement",
    minority: "Minority-owned businesses only",
    minority_or_women: "Minority- or women-owned businesses only",
    specific: p.ownershipLabel ?? "Specific ownership group",
  }[p.ownershipRequirement];

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb"><Link href="/team/providers">Capital providers</Link> / {p.ref}</div>
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
                        <>
                          <span className={`badge ${m.strength}`}>{m.strength} · {m.score}</span>
                          {m.toConfirm.length > 0 && <div className="muted">{m.toConfirm.length} to confirm</div>}
                        </>
                      ) : (
                        <span className="req-fail">{m.requirements.filter((r) => r.outcome === "fail").map((r) => r.detail).join("; ")}</span>
                      )}
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
              <Row
                label="Geography"
                value={stateList(p.geographies)}
                note={[
                  p.geographiesConfirm.length ? `To confirm: ${p.geographiesConfirm.length > 10 ? "all other states" : p.geographiesConfirm.join(", ")}.` : "",
                  p.geographyConfirm ? `${p.geographyConfirm}.` : "",
                  p.geographyNote,
                ].filter(Boolean).join(" ")}
              />
              <Row label="Industries" value={p.sectorsPreferred.length ? `${p.sectorsOnly ? "Only " : "Prefers "}${sectors(p.sectorsPreferred)}` : "No stated preference"} note={p.industriesNote} />
              <Row label="Excludes" value={p.sectorsExcluded.length ? sectors(p.sectorsExcluded) : "None applied"} note={p.exclusionsNote} />
              <Row
                label="Use of funds"
                value={p.useOfFunds.map((u) => USE_OF_FUNDS_LABELS[u]).join(", ")}
                note={p.useOfFundsConfirm.length ? `To confirm: ${p.useOfFundsConfirm.map((u) => USE_OF_FUNDS_LABELS[u]).join(", ")}` : undefined}
              />
              <Row label="Ownership" value={ownershipRule} />
            </dl>
          </div>

          {p.interpretations.length > 0 && (
            <div className="card panel">
              <div className="panel-head"><h2>How we read their criteria</h2></div>
              <ul className="prose-list">{p.interpretations.map((t) => <li key={t}>{t}</li>)}</ul>
              <p className="placeholder-note">Edit these in scripts/import_providers.py and re-run the import.</p>
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
