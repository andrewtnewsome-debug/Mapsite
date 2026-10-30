import SiteHeader from "../components/SiteHeader";
import TeamTabs from "./TeamTabs";

export const metadata = { title: "Team view | MAP Lab Center" };

export default function TeamLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <div className="team-bar">
        <div className="container">
          <TeamTabs />
          <span className="proto-pill">Prototype · no login, local data</span>
        </div>
      </div>
      <div className="container">{children}</div>
    </>
  );
}
