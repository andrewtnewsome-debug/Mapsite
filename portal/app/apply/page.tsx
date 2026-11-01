import SiteHeader from "../components/SiteHeader";
import SiteFooter from "../components/SiteFooter";
import ApplyFormConnected from "./ApplyFormConnected";

export const metadata = { title: "Submit your raise | MAP Lab Center" };

export default function ApplyPage() {
  return (
    <>
      <SiteHeader />
      <div className="container">
        <ApplyFormConnected />
      </div>
      <SiteFooter />
    </>
  );
}
