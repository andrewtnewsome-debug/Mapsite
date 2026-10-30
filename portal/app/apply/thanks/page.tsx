import Link from "next/link";
import SiteHeader from "../../components/SiteHeader";
import SiteFooter from "../../components/SiteFooter";

export const metadata = { title: "Submission received | MAP Lab Center" };

export default async function ThanksPage({ searchParams }: { searchParams: Promise<{ ref?: string }> }) {
  const { ref } = await searchParams;
  return (
    <>
      <SiteHeader />
      <div className="container">
        <div className="card thanks">
          <div className="check-icon">✓</div>
          <h1>Thanks, we have your submission</h1>
          <p>
            Reference <span className="ref">{ref ?? "pending"}</span>
          </p>
          <ol>
            <li>A confirmation email is on its way to you.</li>
            <li>Our team reviews your deal within five business days.</li>
            <li>If there&apos;s a fit, we&apos;ll schedule a call and prepare introductions to matched capital providers.</li>
          </ol>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            <Link href="/" className="btn btn-secondary">Back to home</Link>
            {ref && (
              <Link href={`/team/submissions/${ref}`} className="btn btn-primary">
                See it in Team view
              </Link>
            )}
          </div>
          <p className="placeholder-note">
            Prototype: no email is sent yet. Confirmation emails arrive when Resend is connected.
          </p>
        </div>
      </div>
      <SiteFooter />
    </>
  );
}
