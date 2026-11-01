import { CAPITAL_TYPE_LABELS, SECTOR_LABELS, dateTime, growth, margin, money, pct } from "@/lib/format";
import { cimDifferences } from "@/lib/cim";
import { underwriting } from "@/lib/scoring";
import type { Submission } from "@/lib/types";

/** Deal-page panels shared by the Next.js app and the browser-only version. Plain markup, no data access. */

/** Purchase price, how it's funded, and whether the sources cover it. Acquisitions only. */
export function AcquisitionTerms({ s }: { s: Submission }) {
  const d = s.deal;
  if (d.useOfFunds !== "acquisition") return null;
  const sources: [string, number][] = [
    [`${CAPITAL_TYPE_LABELS[d.capitalType]} (this raise)`, d.amount],
    ...(d.sellerNote ? ([["Seller financing", d.sellerNote]] as [string, number][]) : []),
    ...(d.buyerEquity ? ([["Buyer equity", d.buyerEquity]] as [string, number][]) : []),
  ];
  const total = sources.reduce((n, [, v]) => n + v, 0);
  const price = d.purchasePrice ?? null;
  const gap = price !== null ? total - price : null;
  const ebitda = s.financials.ebitdaLTM;
  return (
    <div className="terms">
      <h3>Sources &amp; uses</h3>
      <table className="mini">
        <tbody>
          {sources.map(([label, v]) => (
            <tr key={label}><td>{label}</td><td className="num">{money(v)}</td><td className="num muted">{price ? pct((v / price) * 100) : ""}</td></tr>
          ))}
          <tr className="total"><td>Total sources</td><td className="num">{money(total)}</td><td /></tr>
          <tr><td>Purchase price</td><td className="num">{price !== null ? money(price) : "Not agreed yet"}</td><td className="num muted">{price && ebitda > 0 ? `${(price / ebitda).toFixed(1)}x EBITDA` : ""}</td></tr>
        </tbody>
      </table>
      {gap !== null && Math.abs(gap) >= 1000 && (
        <p className={gap < 0 ? "req-fail small" : "muted"}>
          {gap < 0
            ? `Sources are ${money(-gap)} short of the purchase price. Ask where the rest comes from.`
            : `Sources exceed the price by ${money(gap)}, likely fees or working capital. Confirm.`}
        </p>
      )}
    </div>
  );
}

export function BuyerPanel({ s }: { s: Submission }) {
  const a = s.acquirer;
  if (!a) return null;
  const c = a.current;
  const u = underwriting(s);
  return (
    <div className="card panel">
      <div className="panel-head">
        <h2>The buyer</h2>
        <span className={`badge ${a.ownsBusiness ? "Strong" : "Possible"}`}>{a.ownsBusiness ? "Current business owner" : "First-time buyer"}</span>
      </div>
      {c ? (
        <>
          <div className="buyer-name"><strong>{c.name}</strong> <span className="muted">· {c.city}, {c.state} · founded {c.yearFounded} · {c.employees} employees · {c.ownershipPct}% owned by the buyer</span></div>
          <p className="small-gray">{c.description}</p>
          <div className="kv">
            <div><span>Revenue (LTM)</span><strong>{money(c.revenueLTM)}</strong></div>
            <div><span>EBITDA (LTM)</span><strong>{money(c.ebitdaLTM)} <span className="muted">{pct(margin(c.revenueLTM, c.ebitdaLTM), 1)}</span></strong></div>
            <div><span>Debt</span><strong>{money(c.existingDebt)}</strong></div>
          </div>
          {a.combine ? (
            <div className="combined">
              <strong>Add-on: scored and matched on combined figures</strong>
              <div className="kv">
                <div><span>Combined revenue</span><strong>{money(u.revenueLTM)}</strong></div>
                <div><span>Combined EBITDA</span><strong>{money(u.ebitdaLTM)}</strong></div>
                <div><span>Combined growth</span><strong>{(() => { const g = growth(u.revenueLTM, u.revenuePrior); return g === null ? "—" : `${g >= 0 ? "+" : ""}${pct(g, 1)}`; })()}</strong></div>
              </div>
            </div>
          ) : (
            <p className="muted">Will run the acquired business separately, so it is scored on its own figures.</p>
          )}
        </>
      ) : (
        <p className="small-gray">Does not own a business today. Lenders will weigh the buyer&apos;s experience and equity heavily.</p>
      )}
      {a.background && (
        <>
          <h3 className="group-head">Background</h3>
          <p className="small-gray">{a.background}</p>
        </>
      )}
    </div>
  );
}

const FIELD_LABELS: Record<string, string> = {
  name: "Company name", companyName: "Company name", website: "Website", city: "City", state: "State",
  yearFounded: "Year founded", employees: "Employees", description: "Description",
  revenueLTM: "Revenue (LTM)", revenuePrior: "Revenue (prior year)", ebitdaLTM: "EBITDA",
  topCustomerPct: "Largest customer %", existingDebt: "Debt", askingPrice: "Asking price", sellerNote: "Seller financing",
};
const fieldLabel = (f: string) => FIELD_LABELS[f.split(".").pop() ?? f] ?? f;

export function CimPanel({ s }: { s: Submission }) {
  const cim = s.cim;
  if (!cim) return null;
  const diffs = cimDifferences(s);
  return (
    <div className="card panel">
      <div className="panel-head">
        <h2>From the CIM</h2>
        <span className="badge ai-real">Read by Claude</span>
      </div>
      <p className="muted">
        {cim.fileName}
        {cim.pageCount ? ` · ${cim.pageCount} pages` : ""}
        {cim.pagesRead && cim.pageCount && cim.pagesRead < cim.pageCount ? ` (first ${cim.pagesRead} read)` : ""}
        {` · ${dateTime(cim.extractedAt)}`}
      </p>
      {diffs.length > 0 && (
        <div className="diffs">
          <strong>Entered figures that differ from the CIM</strong>
          <ul>
            {diffs.map((d) => (
              <li key={d.label}>
                {d.label}: entered {d.label.includes("%") || d.label === "Employees" ? d.entered : money(d.entered)}, CIM says{" "}
                {d.label.includes("%") || d.label === "Employees" ? d.cim : money(d.cim)}
                {d.cimLabel ? ` (${d.cimLabel})` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
      <dl className="crit">
        {cim.labels.revenueLTM && <><dt>Revenue basis</dt><dd>{cim.labels.revenueLTM}</dd></>}
        {cim.labels.ebitdaLTM && <><dt>EBITDA basis</dt><dd>{cim.labels.ebitdaLTM}</dd></>}
        {cim.values.askingPrice !== null && <><dt>Asking price</dt><dd>{money(cim.values.askingPrice)}</dd></>}
        {cim.values.existingDebt !== null && (
          <><dt>{s.acquirer ? "Seller's debt" : "Debt"}</dt><dd>{money(cim.values.existingDebt)}{s.acquirer ? " (usually repaid at closing)" : ""}</dd></>
        )}
        {cim.reasonForSale && <><dt>Reason for sale</dt><dd>{cim.reasonForSale}</dd></>}
        {cim.notFound.length > 0 && <><dt>Not in the CIM</dt><dd>{cim.notFound.map(fieldLabel).join(", ")}</dd></>}
      </dl>
      {cim.sources.length > 0 && (
        <details className="req">
          <summary>Where each figure came from ({cim.sources.length})</summary>
          <ul className="source-quotes">
            {cim.sources.map((src, i) => (
              <li key={i}><strong>{fieldLabel(src.field)}</strong>{src.page ? ` · p. ${src.page}` : ""}{src.quote ? <>: <q>{src.quote}</q></> : null}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export function SummaryPanel({ s }: { s: Submission }) {
  const fromClaude = s.ai.model === "claude";
  return (
    <div className="card panel">
      <div className="panel-head">
        <h2>Deal summary</h2>
        <span className={`badge ${fromClaude ? "ai-real" : "ai"}`}>{fromClaude ? "Claude · from the CIM" : "AI draft · placeholder"}</span>
      </div>
      <p className="summary-text">{s.ai.summary}</p>
      <div className="two-col">
        <div><h4 className="h-good">Highlights</h4><ul>{s.ai.highlights.map((h) => <li key={h}>{h}</li>)}</ul></div>
        <div><h4 className="h-risk">Watch items</h4><ul>{s.ai.risks.map((h) => <li key={h}>{h}</li>)}</ul></div>
      </div>
      <p className="placeholder-note">
        {fromClaude
          ? `Written by Claude from the uploaded CIM; the last sentences restate the ask from the form. Generated ${dateTime(s.ai.generatedAt)}.`
          : `Placeholder text built from the submitted fields. Upload a CIM and Claude writes this instead. Generated ${dateTime(s.ai.generatedAt)}.`}
      </p>
    </div>
  );
}

export function IndustryPanel({ s }: { s: Submission }) {
  const fromClaude = s.naics.confidence === null;
  return (
    <div className="card panel">
      <div className="panel-head">
        <h2>Industry</h2>
        <span className={`badge ${fromClaude ? "ai-real" : "ai"}`}>{fromClaude ? "Claude · from the CIM" : "AI draft · placeholder"}</span>
      </div>
      <div className="naics-code">{s.naics.code}</div>
      <div className="naics-title">{s.naics.title}</div>
      <div className="muted">
        Sector: {SECTOR_LABELS[s.naics.sector] ?? s.naics.sector}
        {s.naics.confidence !== null ? ` · Confidence ${Math.round(s.naics.confidence * 100)}%` : ""}
      </div>
      <p className="small-gray">{s.naics.rationale}</p>
      {s.naics.alternates.length > 0 && <p className="muted">Also considered: {s.naics.alternates.map((a) => a.code).join(", ")}</p>}
    </div>
  );
}
