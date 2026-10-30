import Link from "next/link";

export default function SiteHeader() {
  return (
    <header className="site-header">
      <div className="container">
        <Link href="/" aria-label="MAP Lab Center home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/maplab-logo.png" alt="MAP Lab Center" />
        </Link>
        <nav className="site-nav">
          <Link href="/#how" className="hide-sm">How it works</Link>
          <Link href="/apply" className="btn btn-primary btn-sm" style={{ color: "#fff" }}>
            Submit your raise
          </Link>
          <Link href="/team" className="team-link">Team view</Link>
        </nav>
      </div>
    </header>
  );
}
