import Link from "next/link";

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container">
        <span>© 2026 MAP Lab Center. Information you submit is kept confidential.</span>
        <Link href="/team">Team view</Link>
      </div>
    </footer>
  );
}
