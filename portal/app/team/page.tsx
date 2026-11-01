import Link from "next/link";
import { listProviders, listSubmissions } from "@/lib/db";
import { CAPITAL_TYPE_LABELS, STATUS_LABELS, money, shortDate } from "@/lib/format";
import { matchProviders } from "@/lib/matching";
import { scoreSubmission } from "@/lib/scoring";
import type { Status } from "@/lib/types";
import { ScoreRing, StatusBadge } from "./ui";

export const dynamic = "force-dynamic";

const FILTERS: (Status | "all")[] = ["all", "new", "in_review", "introduced", "closed", "declined"];

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; sort?: string }>;
}) {
  const { status = "all", sort = "date" } = await searchParams;
  const providers = listProviders();
  const all = listSubmissions().map((s) => ({
    s,
    fit: scoreSubmission(s),
    match: matchProviders(s, providers),
  }));

  const rows = all
    .filter((r) => status === "all" || r.s.status === status)
    .sort((a, b) => (sort === "score" ? b.fit.total - a.fit.total : b.s.createdAt.localeCompare(a.s.createdAt)));

  const open = all.filter((r) => r.s.status === "new" || r.s.status === "in_review");
  const avg = Math.round(all.reduce((n, r) => n + r.fit.total, 0) / Math.max(all.length, 1));
  const strong = all.filter((r) => r.fit.tier === "Strong").length;
  const requested = open.reduce((n, r) => n + r.s.deal.amount, 0);
  const count = (f: Status | "all") => (f === "all" ? all.length : all.filter((r) => r.s.status === f).length);
  const qs = (next: Record<string, string>) => {
    const p = new URLSearchParams({ status, sort, ...next });
    return `/team?${p.toString()}`;
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Submissions</h1>
          <p>Every inbound raise, scored for fit and matched against the capital provider network.</p>
        </div>
        <Link href="/apply" className="btn btn-secondary btn-sm">+ New test submission</Link>
      </div>

      <div className="tiles">
        <div className="card tile">
          <div className="label">Awaiting action</div>
          <div className="value">{open.length}</div>
          <div className="foot">New or in review</div>
        </div>
        <div className="card tile">
          <div className="label">Capital requested (open)</div>
          <div className="value">{money(requested)}</div>
          <div className="foot">Across {open.length} deals</div>
        </div>
        <div className="card tile">
          <div className="label">Average fit score</div>
          <div className="value">{avg}</div>
          <div className="foot">Out of 100</div>
        </div>
        <div className="card tile">
          <div className="label">Strong fits</div>
          <div className="value">{strong}</div>
          <div className="foot">Score 75 or higher</div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div className="filters">
          {FILTERS.map((f) => (
            <Link key={f} href={qs({ status: f })} className={`chip ${status === f ? "active" : ""}`}>
              {f === "all" ? "All" : STATUS_LABELS[f]}
              <span className="n">{count(f)}</span>
            </Link>
          ))}
        </div>
        <div className="filters">
          <Link href={qs({ sort: "date" })} className={`chip ${sort !== "score" ? "active" : ""}`}>Newest</Link>
          <Link href={qs({ sort: "score" })} className={`chip ${sort === "score" ? "active" : ""}`}>Highest fit</Link>
        </div>
      </div>

      <div className="card table-wrap" style={{ marginBottom: 64 }}>
        <table className="data">
          <thead>
            <tr>
              <th>Fit</th>
              <th>Company</th>
              <th>Industry (NAICS)</th>
              <th className="num">Raise</th>
              <th>Top match</th>
              <th className="num">Confirmed matches</th>
              <th>Status</th>
              <th>Submitted</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ s, fit, match }) => (
              <tr key={s.id}>
                <td><ScoreRing score={fit.total} /></td>
                <td>
                  <Link href={`/team/submissions/${s.id}`} className="name">{s.company.name}</Link>
                  <div className="muted">{s.company.city}, {s.company.state}</div>
                  {s.acquirer && <div className="muted">Buyer: {s.acquirer.current?.name ?? "first-time buyer"}{s.acquirer.combine ? " (add-on)" : ""}</div>}
                </td>
                <td>
                  <div style={{ fontSize: 13 }}>{s.naics.title.replace(/\s*\(.*\)$/, "")}</div>
                  <div className="muted">{s.naics.code}</div>
                </td>
                <td className="num">
                  <strong>{money(s.deal.amount)}</strong>
                  <div className="muted">{CAPITAL_TYPE_LABELS[s.deal.capitalType]}</div>
                </td>
                <td style={{ fontSize: 13 }}>
                  {match.matches[0] ? match.matches[0].provider.name : <span className="muted">No eligible provider</span>}
                  {match.matches[0] && match.matches[0].toConfirm.length > 0 && <div className="muted">To confirm</div>}
                </td>
                <td className="num">
                  {match.confirmed.length}
                  {match.possible.length > 0 && <div className="muted">+{match.possible.length} possible</div>}
                </td>
                <td><StatusBadge status={s.status} /></td>
                <td className="muted">{shortDate(s.createdAt)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={8} className="empty">No submissions with this status.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
