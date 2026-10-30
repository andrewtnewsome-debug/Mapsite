"use client";

import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { submitApplication } from "./actions";
import { CAPITAL_TYPE_LABELS, TIMELINE_LABELS, US_STATES, USE_OF_FUNDS_LABELS } from "@/lib/format";

const STEPS = ["Company", "Financials", "The raise", "Contact & review"];

const SAMPLE: Record<string, string | boolean> = {
  companyName: "Lakeside Electrical Services",
  website: "lakesideelectric.example",
  city: "Richmond",
  state: "VA",
  yearFounded: "2008",
  employees: "54",
  description:
    "Commercial electrical contractor handling wiring, service upgrades, and tenant build-outs for property managers and general contractors across central Virginia.",
  diverseOwned: true,
  ownerOperator: true,
  revenueLTM: "11,800,000",
  revenuePrior: "10,200,000",
  ebitdaLTM: "1,650,000",
  topCustomerPct: "16",
  existingDebt: "650,000",
  amount: "4,000,000",
  capitalType: "senior_debt",
  useOfFunds: "acquisition",
  timeline: "3-6",
  details: "Acquiring a Norfolk-based electrical contractor with $700K of EBITDA. Seller will carry a 10% note.",
  contactName: "Simone Carter",
  contactTitle: "Owner & CEO",
  contactEmail: "simone@lakesideelectric.example",
  contactPhone: "(804) 555-0110",
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending ? "Submitting…" : "Submit for review"}
    </button>
  );
}

export default function ApplyForm() {
  const [step, setStep] = useState(0);
  const [review, setReview] = useState<Record<string, string>>({});
  const formRef = useRef<HTMLFormElement>(null);
  const stepRefs = useRef<(HTMLFieldSetElement | null)[]>([]);

  function stepIsValid(i: number): boolean {
    const fields = stepRefs.current[i]?.querySelectorAll<HTMLInputElement>("input, select, textarea") ?? [];
    for (const el of fields) {
      if (!el.checkValidity()) {
        el.reportValidity();
        return false;
      }
    }
    return true;
  }

  function next() {
    if (!stepIsValid(step)) return;
    if (step === STEPS.length - 2 && formRef.current) {
      const fd = new FormData(formRef.current);
      setReview(Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)])));
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function back() {
    setStep((s) => Math.max(s - 1, 0));
  }

  function fillSample() {
    const form = formRef.current;
    if (!form) return;
    for (const [name, value] of Object.entries(SAMPLE)) {
      const el = form.elements.namedItem(name) as HTMLInputElement | null;
      if (!el) continue;
      if (el.type === "checkbox") el.checked = Boolean(value);
      else el.value = String(value);
    }
  }

  const r = (k: string) => review[k] || "—";

  return (
    <div className="form-shell">
      <ol className="stepper">
        {STEPS.map((label, i) => (
          <li key={label} className={i === step ? "active" : i < step ? "done" : ""}>
            <span className="dot">{i < step ? "✓" : i + 1}</span>
            <span className="label-text">{label}</span>
          </li>
        ))}
        <li style={{ marginTop: 12 }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={fillSample}>
            Fill sample answers
          </button>
        </li>
      </ol>

      <form ref={formRef} action={submitApplication} className="card form-card" noValidate={false}>
        <fieldset ref={(el) => { stepRefs.current[0] = el; }} hidden={step !== 0} style={{ border: 0, padding: 0, margin: 0 }}>
          <h2>About the company</h2>
          <p className="hint">The basics a lender or investor will ask first.</p>
          <div className="fields">
            <div className="field full">
              <label htmlFor="companyName">Company name</label>
              <input id="companyName" name="companyName" type="text" required />
            </div>
            <div className="field">
              <label htmlFor="website">Website</label>
              <input id="website" name="website" type="text" placeholder="yourcompany.com" />
            </div>
            <div className="field">
              <label htmlFor="yearFounded">Year founded</label>
              <input id="yearFounded" name="yearFounded" type="number" min={1900} max={2026} required />
            </div>
            <div className="field">
              <label htmlFor="city">City</label>
              <input id="city" name="city" type="text" required />
            </div>
            <div className="field">
              <label htmlFor="state">State</label>
              <select id="state" name="state" required defaultValue="">
                <option value="" disabled>Select a state</option>
                {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="employees">Employees</label>
              <input id="employees" name="employees" type="number" min={1} required />
            </div>
            <div className="field full">
              <label htmlFor="description">What does the company do?</label>
              <textarea id="description" name="description" required minLength={40}
                placeholder="Products or services, customers, and how you make money. Two or three sentences is plenty." />
              <span className="help">We use this to classify your industry.</span>
            </div>
            <div className="field full">
              <label>Ownership</label>
              <div className="checks">
                <label className="check">
                  <input type="checkbox" name="diverseOwned" />
                  <span>51% or more minority-owned<small>Some partners have a dedicated mandate for minority-owned businesses.</small></span>
                </label>
                <label className="check">
                  <input type="checkbox" name="ownerOperator" />
                  <span>An owner runs the business day to day</span>
                </label>
              </div>
            </div>
          </div>
        </fieldset>

        <fieldset ref={(el) => { stepRefs.current[1] = el; }} hidden={step !== 1} style={{ border: 0, padding: 0, margin: 0 }}>
          <h2>Financials</h2>
          <p className="hint">Round numbers are fine. Use the last twelve months (LTM) or your most recent fiscal year.</p>
          <div className="fields">
            <div className="field">
              <label htmlFor="revenueLTM">Revenue, last 12 months</label>
              <div className="money"><input id="revenueLTM" name="revenueLTM" type="text" inputMode="decimal" placeholder="8,500,000" required pattern="[0-9.,$ kKmM]+" /></div>
            </div>
            <div className="field">
              <label htmlFor="revenuePrior">Revenue, prior year</label>
              <div className="money"><input id="revenuePrior" name="revenuePrior" type="text" inputMode="decimal" placeholder="7,600,000" required pattern="[0-9.,$ kKmM]+" /></div>
            </div>
            <div className="field">
              <label htmlFor="ebitdaLTM">EBITDA, last 12 months</label>
              <div className="money"><input id="ebitdaLTM" name="ebitdaLTM" type="text" inputMode="decimal" placeholder="1,200,000" required pattern="-?[0-9.,$ kKmM]+" /></div>
              <span className="help">Adjusted EBITDA is fine; we&apos;ll ask about add-backs later.</span>
            </div>
            <div className="field">
              <label htmlFor="existingDebt">Existing debt outstanding</label>
              <div className="money"><input id="existingDebt" name="existingDebt" type="text" inputMode="decimal" placeholder="0" required pattern="[0-9.,$ kKmM]+" /></div>
            </div>
            <div className="field">
              <label htmlFor="topCustomerPct">Largest customer, % of revenue</label>
              <input id="topCustomerPct" name="topCustomerPct" type="number" min={0} max={100} required />
            </div>
          </div>
        </fieldset>

        <fieldset ref={(el) => { stepRefs.current[2] = el; }} hidden={step !== 2} style={{ border: 0, padding: 0, margin: 0 }}>
          <h2>The raise</h2>
          <p className="hint">How much you need, what kind, and what it&apos;s for. Not sure on type? Pick your best guess; we&apos;ll advise.</p>
          <div className="fields">
            <div className="field">
              <label htmlFor="amount">Amount sought</label>
              <div className="money"><input id="amount" name="amount" type="text" inputMode="decimal" placeholder="3,000,000" required pattern="[0-9.,$ kKmM]+" /></div>
            </div>
            <div className="field">
              <label htmlFor="capitalType">Type of capital</label>
              <select id="capitalType" name="capitalType" required defaultValue="">
                <option value="" disabled>Select one</option>
                {Object.entries(CAPITAL_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="useOfFunds">Use of funds</label>
              <select id="useOfFunds" name="useOfFunds" required defaultValue="">
                <option value="" disabled>Select one</option>
                {Object.entries(USE_OF_FUNDS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="timeline">Target timing</label>
              <select id="timeline" name="timeline" required defaultValue="">
                <option value="" disabled>Select one</option>
                {Object.entries(TIMELINE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="field full">
              <label htmlFor="details">Anything else about the deal?</label>
              <textarea id="details" name="details" placeholder="For an acquisition: target, price, seller note, equity you're bringing. For growth: what the capital unlocks." />
            </div>
          </div>
        </fieldset>

        <fieldset ref={(el) => { stepRefs.current[3] = el; }} hidden={step !== 3} style={{ border: 0, padding: 0, margin: 0 }}>
          <h2>Your contact details</h2>
          <p className="hint">Who should our team follow up with?</p>
          <div className="fields">
            <div className="field">
              <label htmlFor="contactName">Full name</label>
              <input id="contactName" name="contactName" type="text" required />
            </div>
            <div className="field">
              <label htmlFor="contactTitle">Title</label>
              <input id="contactTitle" name="contactTitle" type="text" required />
            </div>
            <div className="field">
              <label htmlFor="contactEmail">Email</label>
              <input id="contactEmail" name="contactEmail" type="email" required />
            </div>
            <div className="field">
              <label htmlFor="contactPhone">Phone</label>
              <input id="contactPhone" name="contactPhone" type="tel" />
            </div>
          </div>

          <div className="review-section">
            <h3>Review your submission</h3>
            <dl className="review-grid">
              <div><dt>Company</dt><dd>{r("companyName")}</dd></div>
              <div><dt>Location</dt><dd>{r("city")}, {r("state")}</dd></div>
              <div><dt>Founded / employees</dt><dd>{r("yearFounded")} · {r("employees")} people</dd></div>
              <div><dt>Ownership</dt><dd>{review.diverseOwned ? "Minority-owned" : "Not minority-owned"}{review.ownerOperator ? ", owner-operated" : ""}</dd></div>
              <div><dt>Revenue (LTM / prior)</dt><dd>${r("revenueLTM")} / ${r("revenuePrior")}</dd></div>
              <div><dt>EBITDA (LTM)</dt><dd>${r("ebitdaLTM")}</dd></div>
              <div><dt>Raise</dt><dd>${r("amount")} · {CAPITAL_TYPE_LABELS[review.capitalType as keyof typeof CAPITAL_TYPE_LABELS] ?? "—"}</dd></div>
              <div><dt>Use of funds</dt><dd>{USE_OF_FUNDS_LABELS[review.useOfFunds as keyof typeof USE_OF_FUNDS_LABELS] ?? "—"}</dd></div>
            </dl>
          </div>
        </fieldset>

        <div className="form-actions">
          {step > 0 ? (
            <button type="button" className="btn btn-secondary" onClick={back}>Back</button>
          ) : <span />}
          {step < STEPS.length - 1 ? (
            <button type="button" className="btn btn-primary" onClick={next}>Continue</button>
          ) : (
            <SubmitButton />
          )}
        </div>
      </form>
    </div>
  );
}
