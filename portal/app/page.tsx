import Link from "next/link";
import SiteHeader from "./components/SiteHeader";
import SiteFooter from "./components/SiteFooter";
import { listProviders } from "@/lib/db";
import { money } from "@/lib/format";

export const dynamic = "force-dynamic";

export default function Home() {
  const providers = listProviders();
  const minCheck = Math.min(...providers.map((p) => p.checkMin));
  const maxCheck = Math.max(...providers.map((p) => p.checkMax));
  const mission = providers.filter((p) => p.diverseFocus).length;

  return (
    <>
      <SiteHeader />
      <section className="hero">
        <div className="container hero-grid">
          <div>
            <div className="eyebrow">MAP Lab Center · Capital Raise Portal</div>
            <h1>
              Put your raise in front of the <em>right capital</em>, not every capital.
            </h1>
            <p className="lede">
              Tell us about your company and the capital you need. Our team reviews every submission, sizes the
              opportunity, and makes targeted introductions to the banks, lenders, and equity investors in our network
              that actually fit your deal.
            </p>
            <div className="hero-actions">
              <Link href="/apply" className="btn btn-primary">Submit your raise</Link>
              <Link href="#how" className="btn btn-secondary">How it works</Link>
            </div>
          </div>
          <div className="hero-panel">
            <h3>Capital we arrange</h3>
            <ul className="capital-list">
              <li>Senior term loans <span>$1M to $25M</span></li>
              <li>SBA 7(a) loans <span>up to $5M</span></li>
              <li>Mezzanine &amp; unitranche <span>$3M to $40M</span></li>
              <li>Growth &amp; minority equity <span>$2M to $10M</span></li>
              <li>Majority recaps &amp; buyouts <span>$5M to $30M</span></li>
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
            <div className="step">
              <div className="step-num">1</div>
              <h3>Tell us about the deal</h3>
              <p>Company basics, headline financials, and what the capital is for. No data room needed yet.</p>
            </div>
            <div className="step">
              <div className="step-num">2</div>
              <h3>We review and size it</h3>
              <p>Our team scores fit, classifies the business, and identifies which capital providers can say yes.</p>
            </div>
            <div className="step">
              <div className="step-num">3</div>
              <h3>Warm introductions</h3>
              <p>We make direct introductions to the best-fit lenders and investors, with a one-page teaser.</p>
            </div>
          </div>
          <div className="stats-row">
            <div className="stat-big"><strong>{providers.length}</strong><span>Capital partners in our network</span></div>
            <div className="stat-big"><strong>{money(minCheck)} to {money(maxCheck)}</strong><span>Range of check sizes</span></div>
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
          <Link href="/apply" className="btn btn-primary">Submit your raise</Link>
        </div>
      </section>
      <SiteFooter />
    </>
  );
}
