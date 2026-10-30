import Link from "next/link";
import { listProviders, listSubmissions } from "@/lib/db";
import { CAPITAL_TYPE_LABELS, SECTOR_LABELS, money, multiple } from "@/lib/format";
import { evaluateProvider } from "@/lib/matching";

export const dynamic = "force-dynamic";

export default function ProvidersPage() {
  const providers = listProviders();
  const open = listSubmissions().filter((s) => s.status === "new" || s.status === "in_review");

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Capital providers</h1>
          <p>{providers.length} lenders and investors. Their criteria drive the matching on every submission.</p>
        </div>
      </div>
      <div className="provider-grid">
        {providers.map((p) => {
          const live = open.filter((s) => evaluateProvider(s, p).eligible).length;
          return (
            <Link key={p.id} href={`/team/providers/${p.id}`} className="card provider-card">
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <div>
                  <h3>{p.name}</h3>
                  <div className="type">{p.type}{p.diverseFocus ? " · Minority-owned mandate" : ""}</div>
                </div>
                <span className={`badge ${live > 0 ? "Strong" : "Possible"}`} title="Open submissions this provider is eligible for">
                  {live} open {live === 1 ? "match" : "matches"}
                </span>
              </div>
              <dl className="crit">
                <dt>Capital</dt><dd>{p.capitalTypes.map((c) => CAPITAL_TYPE_LABELS[c]).join(", ")}</dd>
                <dt>Check size</dt><dd>{money(p.checkMin)} to {money(p.checkMax)}</dd>
                <dt>Min EBITDA</dt><dd>{p.minEbitda > 0 ? money(p.minEbitda) : "None"}</dd>
                {p.maxLeverage !== null && (<><dt>Max leverage</dt><dd>{multiple(p.maxLeverage)}</dd></>)}
                <dt>Geography</dt><dd>{p.geographies.join(", ")}</dd>
                <dt>Industries</dt>
                <dd>{p.sectorsPreferred.length ? `${p.sectorsOnly ? "Only " : ""}${p.sectorsPreferred.map((k) => SECTOR_LABELS[k] ?? k).join(", ")}` : "Agnostic"}</dd>
              </dl>
            </Link>
          );
        })}
      </div>
    </>
  );
}
