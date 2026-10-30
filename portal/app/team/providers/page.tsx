import Link from "next/link";
import { listProviders, listSubmissions } from "@/lib/db";
import { CAPITAL_TYPE_LABELS, SECTOR_LABELS, range } from "@/lib/format";
import { evaluateProvider } from "@/lib/matching";

export const dynamic = "force-dynamic";

export default async function ProvidersPage({ searchParams }: { searchParams: Promise<{ group?: string }> }) {
  const { group = "all" } = await searchParams;
  const all = listProviders();
  const groups = [...new Set(all.map((p) => p.category))];
  const providers = all.filter((p) => group === "all" || p.category === group);
  const open = listSubmissions().filter((s) => s.status === "new" || s.status === "in_review");

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Capital providers</h1>
          <p>
            {all.length} profiles from the Minority Business Investor Database. Their published criteria drive the
            matching on every submission.
          </p>
        </div>
      </div>
      <div className="filters">
        <Link href="/team/providers" className={`chip ${group === "all" ? "active" : ""}`}>
          All<span className="n">{all.length}</span>
        </Link>
        {groups.map((g) => (
          <Link key={g} href={`/team/providers?group=${encodeURIComponent(g)}`} className={`chip ${group === g ? "active" : ""}`}>
            {g}<span className="n">{all.filter((p) => p.category === g).length}</span>
          </Link>
        ))}
      </div>
      <div className="provider-grid">
        {providers.map((p) => {
          const live = open.filter((s) => evaluateProvider(s, p).eligible).length;
          return (
            <Link key={p.id} href={`/team/providers/${p.id}`} className="card provider-card">
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <div>
                  <h3>{p.name}</h3>
                  <div className="type">{p.ref} · {p.fund}</div>
                </div>
                <span className={`badge ${live > 0 ? "Strong" : "Possible"}`} title="Open submissions this provider is eligible for">
                  {live} open {live === 1 ? "match" : "matches"}
                </span>
              </div>
              <dl className="crit">
                <dt>Type</dt><dd>{p.type}</dd>
                <dt>Focus</dt><dd>{p.relevance}</dd>
                <dt>Capital</dt><dd>{p.capitalTypes.map((c) => CAPITAL_TYPE_LABELS[c]).join(", ")}</dd>
                <dt>Check size</dt><dd>{range(p.checkMin, p.checkMax) ?? "Not published"}</dd>
                <dt>EBITDA</dt><dd>{range(p.ebitdaMin, p.ebitdaMax) ?? (p.requiresPositiveEbitda ? "Positive" : "Not published")}</dd>
                <dt>Geography</dt><dd>{p.geographies.includes("National") ? "National" : p.geographies.length > 8 ? `${p.geographies.length} states` : p.geographies.join(", ")}</dd>
                <dt>Industries</dt>
                <dd>{p.sectorsPreferred.length ? `${p.sectorsOnly ? "Only " : ""}${p.sectorsPreferred.map((k) => SECTOR_LABELS[k] ?? k).join(", ")}` : "No stated preference"}</dd>
              </dl>
            </Link>
          );
        })}
      </div>
    </>
  );
}
