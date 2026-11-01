"use client";

import { useEffect, useRef, useState } from "react";
import { CAPITAL_TYPE_LABELS, TIMELINE_LABELS, US_STATES, USE_OF_FUNDS_LABELS } from "@/lib/format";
import { cimFormValues, cimPageFor } from "@/lib/cim";
import type { CapitalType, CimExtraction, UseOfFunds } from "@/lib/types";

/**
 * The apply form. Shared by the Next.js app and the browser-only version, so it takes its
 * two outside actions as props: how to submit, and how to read a CIM (null hides the upload).
 */

export type ReadCim = (file: File, progress: (message: string) => void) => Promise<CimExtraction>;

const SAMPLE: Record<string, string | boolean> = {
  amount: "2,400,000",
  capitalType: "senior_debt",
  useOfFunds: "acquisition",
  timeline: "3-6",
  purchasePrice: "3,200,000",
  sellerNote: "320,000",
  buyerEquity: "480,000",
  details: "Buying a retiring owner's electrical contractor in Norfolk to extend our service area into Hampton Roads.",
  ownsBusiness: "yes",
  curName: "Lakeside Electrical Services",
  curWebsite: "lakesideelectric.example",
  curCity: "Richmond",
  curState: "VA",
  curYearFounded: "2008",
  curEmployees: "54",
  curDescription: "Commercial electrical contractor handling wiring, service upgrades and tenant build-outs for property managers across central Virginia.",
  curRevenueLTM: "11,800,000",
  curRevenuePrior: "10,200,000",
  curEbitdaLTM: "1,650,000",
  curExistingDebt: "650,000",
  curOwnershipPct: "100",
  combine: true,
  background: "Founded Lakeside in 2008 after 12 years as a licensed master electrician; completed one prior tuck-in acquisition in 2021.",
  diverseOwned: true,
  ownerOperator: true,
  companyName: "Tidewater Electric Co.",
  website: "tidewaterelectric.example",
  city: "Norfolk",
  state: "VA",
  yearFounded: "1996",
  employees: "31",
  description: "Commercial electrical contractor providing wiring, service upgrades and maintenance for property managers and general contractors in Hampton Roads.",
  revenueLTM: "5,400,000",
  revenuePrior: "5,000,000",
  ebitdaLTM: "700,000",
  topCustomerPct: "18",
  existingDebt: "0",
  contactName: "Simone Carter",
  contactTitle: "Owner & CEO, Lakeside Electrical Services",
  contactEmail: "simone@lakesideelectric.example",
  contactPhone: "(804) 555-0110",
};

const fs = { border: 0, padding: 0, margin: 0, minWidth: 0 };
const MONEY = "[0-9.,$ kKmM]+";

function MoneyInput({ name, placeholder, required = true, negative = false }: { name: string; placeholder: string; required?: boolean; negative?: boolean }) {
  return (
    <div className="money">
      <input id={name} name={name} type="text" inputMode="decimal" placeholder={placeholder} required={required} pattern={negative ? `-?${MONEY}` : MONEY} />
    </div>
  );
}

function StateSelect({ name }: { name: string }) {
  return (
    <select id={name} name={name} required defaultValue="">
      <option value="" disabled>Select a state</option>
      {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
    </select>
  );
}

function OptionSelect({ name, options, onChange }: { name: string; options: Record<string, string>; onChange?: (v: string) => void }) {
  return (
    <select id={name} name={name} required defaultValue="" onChange={(e) => onChange?.(e.target.value)}>
      <option value="" disabled>Select one</option>
      {Object.entries(options).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

function CimUpload({ read, onRead, what, acquisition }: { read: ReadCim; onRead: (cim: CimExtraction) => void; what: string; acquisition: boolean }) {
  const [state, setState] = useState<{ phase: "idle" | "reading" | "done" | "error"; message: string }>({ phase: "idle", message: "" });

  async function pick(file: File | undefined) {
    if (!file) return;
    setState({ phase: "reading", message: "Uploading…" });
    try {
      const cim = await read(file, (message) => setState({ phase: "reading", message }));
      onRead(cim);
      const found = Object.keys(cimFormValues(cim, { acquisition })).length;
      setState({
        phase: "done",
        message:
          `Filled ${found} field${found === 1 ? "" : "s"} from ${cim.fileName}` +
          (cim.pagesRead && cim.pageCount && cim.pagesRead < cim.pageCount ? ` (read the first ${cim.pagesRead} of ${cim.pageCount} pages)` : "") +
          ". Check each one before you continue." +
          (cim.notFound.length ? ` Not in the document: ${cim.notFound.slice(0, 6).join(", ")}.` : ""),
      });
    } catch (e) {
      setState({ phase: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <div className={`cim-upload ${state.phase}`}>
      <div>
        <strong>Have a CIM or teaser?</strong>
        <p>Upload the PDF and we&apos;ll fill in {what} for you. You can edit anything before submitting.</p>
      </div>
      <label className="btn btn-secondary btn-sm cim-pick">
        {state.phase === "reading" ? "Reading…" : state.phase === "done" ? "Upload a different file" : "Upload CIM (PDF)"}
        <input
          type="file"
          accept=".pdf,application/pdf"
          hidden
          disabled={state.phase === "reading"}
          onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }}
        />
      </label>
      {state.message && <p className={`cim-status ${state.phase}`} role="status">{state.message}</p>}
    </div>
  );
}

export default function ApplyForm({ onSubmit, readCim }: { onSubmit: (fd: FormData) => void | Promise<void>; readCim: ReadCim | null }) {
  const [step, setStep] = useState(0);
  const [useOfFunds, setUseOfFunds] = useState<UseOfFunds | "">("");
  const [owns, setOwns] = useState<"" | "yes" | "no">("");
  const [review, setReview] = useState<Record<string, string>>({});
  const [cim, setCim] = useState<CimExtraction | null>(null);
  const [pendingFill, setPendingFill] = useState<{ values: Record<string, string | boolean>; onlyEmpty: boolean } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const stepRefs = useRef<(HTMLFieldSetElement | null)[]>([]);

  const acq = useOfFunds === "acquisition";
  const steps = ["The raise", acq ? "About you" : "Your company", acq ? "Business you're buying" : "Financials", "Contact & review"];
  const last = steps.length - 1;

  // Values are written after React has rendered the fields they belong to.
  useEffect(() => {
    const form = formRef.current;
    if (!pendingFill || !form) return;
    for (const [name, value] of Object.entries(pendingFill.values)) {
      const el = form.elements.namedItem(name);
      if (!el) continue;
      if (el instanceof RadioNodeList) el.value = String(value);
      else if (el instanceof HTMLInputElement && el.type === "checkbox") el.checked = Boolean(value);
      else if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
        if (!pendingFill.onlyEmpty || !el.value) el.value = String(value);
      }
    }
    setPendingFill(null);
  }, [pendingFill]);

  function stepIsValid(i: number) {
    const fields = stepRefs.current[i]?.querySelectorAll<HTMLInputElement>("input, select, textarea") ?? [];
    for (const el of Array.from(fields)) {
      if (el.type !== "file" && !el.checkValidity()) {
        el.reportValidity();
        return false;
      }
    }
    return true;
  }

  function next() {
    if (!stepIsValid(step)) return;
    if (step === last - 1 && formRef.current) {
      const fd = new FormData(formRef.current);
      setReview(Object.fromEntries(Array.from(fd.entries()).map(([k, v]) => [k, String(v)])));
    }
    setStep((s) => Math.min(s + 1, last));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function fillSample() {
    setUseOfFunds("acquisition");
    setOwns("yes");
    setPendingFill({ values: SAMPLE, onlyEmpty: false });
  }

  function applyCim(c: CimExtraction) {
    setCim(c);
    setPendingFill({ values: cimFormValues(c, { acquisition: acq }), onlyEmpty: true });
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (step < last) return next();
    if (!stepIsValid(step) || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(new FormData(e.currentTarget));
    } finally {
      setSubmitting(false);
    }
  }

  /** "From CIM p. 12 · LTM Jun-26" under a field Claude filled in. */
  function Hint({ name, help }: { name: string; help?: string }) {
    const page = cim ? cimPageFor(cim, name) : null;
    const filled = cim && name in cimFormValues(cim, { acquisition: acq });
    const label = cim && (name === "revenueLTM" || name === "revenuePrior" || name === "ebitdaLTM") ? cim.labels[name] : null;
    if (filled) return <span className="help from-cim">From CIM{page ? ` p. ${page}` : ""}{label ? ` · ${label}` : ""}</span>;
    return help ? <span className="help">{help}</span> : null;
  }

  const r = (k: string) => review[k] || "—";

  const companyFields = (
    <>
      <div className="field full">
        <label htmlFor="companyName">{acq ? "Name of the business you're buying" : "Company name"}</label>
        <input id="companyName" name="companyName" type="text" required />
        <Hint name="companyName" help={acq ? "A code name is fine if the deal is confidential." : undefined} />
      </div>
      <div className="field"><label htmlFor="website">Website</label><input id="website" name="website" type="text" placeholder="company.com" /><Hint name="website" /></div>
      <div className="field"><label htmlFor="yearFounded">Year founded</label><input id="yearFounded" name="yearFounded" type="number" min={1800} max={2026} required /><Hint name="yearFounded" /></div>
      <div className="field"><label htmlFor="city">City</label><input id="city" name="city" type="text" required /><Hint name="city" /></div>
      <div className="field"><label htmlFor="state">State</label><StateSelect name="state" /><Hint name="state" /></div>
      <div className="field"><label htmlFor="employees">Employees</label><input id="employees" name="employees" type="number" min={1} required /><Hint name="employees" /></div>
      <div className="field full">
        <label htmlFor="description">What does {acq ? "the business" : "the company"} do?</label>
        <textarea id="description" name="description" required minLength={40} placeholder="Products or services, customers, and how it makes money. Two or three sentences is plenty." />
        <Hint name="description" help="We use this to classify the industry." />
      </div>
    </>
  );

  const financialFields = (
    <>
      <div className="field"><label htmlFor="revenueLTM">Revenue, last 12 months</label><MoneyInput name="revenueLTM" placeholder="8,500,000" /><Hint name="revenueLTM" /></div>
      <div className="field"><label htmlFor="revenuePrior">Revenue, prior year</label><MoneyInput name="revenuePrior" placeholder="7,600,000" /><Hint name="revenuePrior" /></div>
      <div className="field">
        <label htmlFor="ebitdaLTM">EBITDA, last 12 months</label>
        <MoneyInput name="ebitdaLTM" placeholder="1,200,000" negative />
        <Hint name="ebitdaLTM" help="Adjusted EBITDA is fine; we'll ask about add-backs later." />
      </div>
      <div className="field">
        <label htmlFor="existingDebt">{acq ? "Debt the buyer will assume" : "Existing debt outstanding"}</label>
        <MoneyInput name="existingDebt" placeholder="0" />
        <Hint name="existingDebt" help={acq ? "Usually 0: most deals close cash-free, debt-free." : undefined} />
      </div>
      <div className="field"><label htmlFor="topCustomerPct">Largest customer, % of revenue</label><input id="topCustomerPct" name="topCustomerPct" type="number" min={0} max={100} required /><Hint name="topCustomerPct" /></div>
    </>
  );

  const ownershipChecks = (
    <div className="field full">
      <label>{acq ? "Ownership after closing" : "Ownership"}</label>
      <div className="checks">
        <label className="check" htmlFor="diverseOwned">
          <input type="checkbox" id="diverseOwned" name="diverseOwned" />
          <span>{acq ? "The business will be 51% or more minority-owned" : "51% or more minority-owned"}<small>Some partners have a dedicated mandate for minority-owned businesses.</small></span>
        </label>
        <label className="check" htmlFor="ownerOperator">
          <input type="checkbox" id="ownerOperator" name="ownerOperator" />
          <span>{acq ? "An owner will run it day to day" : "An owner runs the business day to day"}</span>
        </label>
      </div>
    </div>
  );

  return (
    <div className="form-shell">
      <ol className="stepper">
        {steps.map((label, i) => (
          <li key={label} className={i === step ? "active" : i < step ? "done" : ""}>
            <span className="dot">{i < step ? "✓" : i + 1}</span>
            <span className="label-text">{label}</span>
          </li>
        ))}
        <li className="sample-li">
          <button type="button" className="btn btn-secondary btn-sm" onClick={fillSample}>Fill sample answers</button>
        </li>
      </ol>

      <form ref={formRef} onSubmit={submit} className="card form-card" noValidate>
        {cim && <input type="hidden" name="cimJson" value={JSON.stringify(cim)} />}

        <fieldset ref={(el) => { stepRefs.current[0] = el; }} hidden={step !== 0} style={fs}>
          <h2>The raise</h2>
          <p className="hint">How much you need, what kind, and what it&apos;s for. Not sure on type? Pick your best guess; we&apos;ll advise.</p>
          <div className="fields">
            <div className="field"><label htmlFor="amount">Amount sought</label><MoneyInput name="amount" placeholder="3,000,000" /></div>
            <div className="field"><label htmlFor="capitalType">Type of capital</label><OptionSelect name="capitalType" options={CAPITAL_TYPE_LABELS} /></div>
            <div className="field">
              <label htmlFor="useOfFunds">Use of funds</label>
              <OptionSelect name="useOfFunds" options={USE_OF_FUNDS_LABELS} onChange={(v) => setUseOfFunds(v as UseOfFunds)} />
            </div>
            <div className="field"><label htmlFor="timeline">Target timing</label><OptionSelect name="timeline" options={TIMELINE_LABELS} /></div>
            {acq && (
              <>
                <div className="field"><label htmlFor="purchasePrice">Purchase price</label><MoneyInput name="purchasePrice" placeholder="5,000,000" required={false} /><Hint name="purchasePrice" help="Leave blank if not agreed yet." /></div>
                <div className="field"><label htmlFor="sellerNote">Seller financing</label><MoneyInput name="sellerNote" placeholder="500,000" required={false} /><Hint name="sellerNote" help="Amount the seller will carry, if any." /></div>
                <div className="field"><label htmlFor="buyerEquity">Equity you&apos;re putting in</label><MoneyInput name="buyerEquity" placeholder="500,000" required={false} /><span className="help">Your cash plus any investor equity.</span></div>
              </>
            )}
            <div className="field full">
              <label htmlFor="details">Anything else about the deal?</label>
              <textarea id="details" name="details" placeholder={acq ? "Why this business, how the deal is structured, where the rest of the money comes from." : "What the capital unlocks and how you'll use it."} />
            </div>
          </div>
        </fieldset>

        <fieldset ref={(el) => { stepRefs.current[1] = el; }} hidden={step !== 1} style={fs}>
          {acq ? (
            <>
              <h2>About you, the buyer</h2>
              <p className="hint">Lenders look at who is buying as closely as what is being bought.</p>
              <div className="fields">
                <div className="field full">
                  <label>Do you currently own a business?</label>
                  <div className="toggle" role="radiogroup" aria-label="Do you currently own a business?">
                    <label className={`toggle-opt ${owns === "yes" ? "on" : ""}`}>
                      <input type="radio" name="ownsBusiness" value="yes" required checked={owns === "yes"} onChange={() => setOwns("yes")} /> Yes
                    </label>
                    <label className={`toggle-opt ${owns === "no" ? "on" : ""}`}>
                      <input type="radio" name="ownsBusiness" value="no" required checked={owns === "no"} onChange={() => setOwns("no")} /> No, this is my first
                    </label>
                  </div>
                </div>
                {owns === "yes" && (
                  <div className="field full sub-block">
                    <h3>Your current business</h3>
                    <div className="fields">
                      <div className="field full"><label htmlFor="curName">Company name</label><input id="curName" name="curName" type="text" required /></div>
                      <div className="field"><label htmlFor="curWebsite">Website</label><input id="curWebsite" name="curWebsite" type="text" placeholder="yourcompany.com" /></div>
                      <div className="field"><label htmlFor="curYearFounded">Year founded</label><input id="curYearFounded" name="curYearFounded" type="number" min={1800} max={2026} required /></div>
                      <div className="field"><label htmlFor="curCity">City</label><input id="curCity" name="curCity" type="text" required /></div>
                      <div className="field"><label htmlFor="curState">State</label><StateSelect name="curState" /></div>
                      <div className="field"><label htmlFor="curEmployees">Employees</label><input id="curEmployees" name="curEmployees" type="number" min={1} required /></div>
                      <div className="field"><label htmlFor="curOwnershipPct">Your ownership, %</label><input id="curOwnershipPct" name="curOwnershipPct" type="number" min={1} max={100} required /></div>
                      <div className="field full"><label htmlFor="curDescription">What does it do?</label><textarea id="curDescription" name="curDescription" required minLength={20} /></div>
                      <div className="field"><label htmlFor="curRevenueLTM">Revenue, last 12 months</label><MoneyInput name="curRevenueLTM" placeholder="10,000,000" /></div>
                      <div className="field"><label htmlFor="curRevenuePrior">Revenue, prior year</label><MoneyInput name="curRevenuePrior" placeholder="9,000,000" /></div>
                      <div className="field"><label htmlFor="curEbitdaLTM">EBITDA, last 12 months</label><MoneyInput name="curEbitdaLTM" placeholder="1,500,000" negative /></div>
                      <div className="field"><label htmlFor="curExistingDebt">Debt outstanding</label><MoneyInput name="curExistingDebt" placeholder="0" /></div>
                      <div className="field full">
                        <label className="check" htmlFor="combine">
                          <input type="checkbox" id="combine" name="combine" />
                          <span>The business I&apos;m buying will be combined with this one<small>An add-on. Lenders then look at both businesses together, so we match on combined figures.</small></span>
                        </label>
                      </div>
                    </div>
                  </div>
                )}
                <div className="field full">
                  <label htmlFor="background">Your background</label>
                  <textarea id="background" name="background" placeholder="Operating and industry experience, prior acquisitions, and who else is on the deal team." />
                </div>
                {ownershipChecks}
              </div>
            </>
          ) : (
            <>
              <h2>About the company</h2>
              <p className="hint">The basics a lender or investor will ask first.</p>
              {readCim && <CimUpload read={readCim} onRead={applyCim} what="this step and the financials" acquisition={false} />}
              <div className="fields">
                {companyFields}
                {ownershipChecks}
              </div>
            </>
          )}
        </fieldset>

        <fieldset ref={(el) => { stepRefs.current[2] = el; }} hidden={step !== 2} style={fs}>
          {acq ? (
            <>
              <h2>The business you&apos;re buying</h2>
              <p className="hint">Use the seller&apos;s figures. Round numbers are fine.</p>
              {readCim && <CimUpload read={readCim} onRead={applyCim} what="this page and the purchase terms" acquisition />}
              <div className="fields">
                {companyFields}
                {financialFields}
              </div>
            </>
          ) : (
            <>
              <h2>Financials</h2>
              <p className="hint">Round numbers are fine. Use the last twelve months (LTM) or your most recent fiscal year.</p>
              <div className="fields">{financialFields}</div>
            </>
          )}
        </fieldset>

        <fieldset ref={(el) => { stepRefs.current[3] = el; }} hidden={step !== 3} style={fs}>
          <h2>Your contact details</h2>
          <p className="hint">Who should our team follow up with?</p>
          <div className="fields">
            <div className="field"><label htmlFor="contactName">Full name</label><input id="contactName" name="contactName" type="text" required /></div>
            <div className="field"><label htmlFor="contactTitle">Title</label><input id="contactTitle" name="contactTitle" type="text" required /></div>
            <div className="field"><label htmlFor="contactEmail">Email</label><input id="contactEmail" name="contactEmail" type="email" required /></div>
            <div className="field"><label htmlFor="contactPhone">Phone</label><input id="contactPhone" name="contactPhone" type="tel" /></div>
          </div>
          <div className="review-section">
            <h3>Review your submission</h3>
            <dl className="review-grid">
              <div><dt>Raise</dt><dd>${r("amount")} · {CAPITAL_TYPE_LABELS[review.capitalType as CapitalType] ?? "—"}</dd></div>
              <div><dt>Use of funds</dt><dd>{USE_OF_FUNDS_LABELS[review.useOfFunds as UseOfFunds] ?? "—"}</dd></div>
              {acq && <div><dt>Purchase price</dt><dd>{review.purchasePrice ? `$${review.purchasePrice}` : "Not agreed yet"}</dd></div>}
              {acq && (
                <div>
                  <dt>Buyer</dt>
                  <dd>{review.ownsBusiness === "yes" ? `Owns ${r("curName")}${review.combine ? ", combining the two" : ""}` : "First-time buyer"}</dd>
                </div>
              )}
              <div><dt>{acq ? "Business being bought" : "Company"}</dt><dd>{r("companyName")}</dd></div>
              <div><dt>Location</dt><dd>{r("city")}, {r("state")}</dd></div>
              <div><dt>Revenue (LTM / prior)</dt><dd>${r("revenueLTM")} / ${r("revenuePrior")}</dd></div>
              <div><dt>EBITDA (LTM)</dt><dd>${r("ebitdaLTM")}</dd></div>
              <div><dt>Ownership</dt><dd>{review.diverseOwned ? "Minority-owned" : "Not minority-owned"}{review.ownerOperator ? ", owner-operated" : ""}</dd></div>
              {cim && <div><dt>CIM</dt><dd>{cim.fileName}, read by Claude</dd></div>}
            </dl>
          </div>
        </fieldset>

        <div className="form-actions">
          {step > 0 ? <button type="button" className="btn btn-secondary" onClick={() => setStep((s) => s - 1)}>Back</button> : <span />}
          {step < last ? (
            <button key="next" type="button" className="btn btn-primary" onClick={next}>Continue</button>
          ) : (
            <button key="submit" type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? "Submitting…" : "Submit for review"}</button>
          )}
        </div>
      </form>
    </div>
  );
}
