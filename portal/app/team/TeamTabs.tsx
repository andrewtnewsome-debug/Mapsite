"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function TeamTabs() {
  const path = usePathname();
  const onProviders = path.startsWith("/team/providers");
  return (
    <nav className="team-tabs">
      <Link href="/team" className={onProviders ? "" : "active"}>Submissions</Link>
      <Link href="/team/providers" className={onProviders ? "active" : ""}>Capital providers</Link>
    </nav>
  );
}
