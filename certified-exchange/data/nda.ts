import { brand } from "@/config/brand";

// TODO(legal): This agreement is placeholder text written for the prototype. It has not
// been reviewed by counsel. Production e-signature must meet ESIGN/UETA requirements
// (identity verification, consent to electronic records, audit trail, tamper-evident copy).

export interface NdaSection {
  heading: string;
  body: string;
}

export function ndaSections(listingRef: string, recipientFirm: string): NdaSection[] {
  const recipient = recipientFirm.trim() || "the Recipient";
  return [
    {
      heading: "1. Purpose",
      body: `${recipient} ("Recipient") wishes to evaluate a possible investment in, financing of, or acquisition of the business described in listing ${listingRef} (the "Company") on ${brand.name} (the "Transaction"). This Agreement governs the Company's confidential information that Recipient receives through ${brand.name} or directly from the Company or its representatives.`,
    },
    {
      heading: "2. Confidential Information",
      body: `"Confidential Information" means all non-public information about the Company disclosed to Recipient, including the Company's identity and location, the confidential information memorandum, financial statements, customer and supplier information, employee information, pricing, contracts and business plans, together with any notes, analyses or summaries Recipient prepares that contain or reflect that information. The fact that the Company is considering a Transaction is also Confidential Information.`,
    },
    {
      heading: "3. Use and Protection",
      body: `Recipient will use Confidential Information solely to evaluate and negotiate the Transaction, will protect it with at least the degree of care it uses for its own confidential information (and no less than reasonable care), and will disclose it only to its directors, officers, employees, capital partners, lenders and professional advisors who need to know it for that purpose and are bound by confidentiality obligations at least as protective as these. Recipient is responsible for any breach by those persons.`,
    },
    {
      heading: "4. Exclusions",
      body: "Confidential Information does not include information that (a) is or becomes publicly available through no fault of Recipient, (b) was lawfully known to Recipient before disclosure, (c) is lawfully received from a third party without a duty of confidentiality, or (d) is independently developed without use of Confidential Information. Recipient may disclose Confidential Information when required by law, after giving the Company prompt notice where legally permitted.",
    },
    {
      heading: "5. No Contact",
      body: "Without the Company's prior written consent, Recipient will not contact any employee, customer, supplier, landlord or lender of the Company regarding the Company or the Transaction. All communications will be made through the Company's designated contact or through the messaging tools on the platform.",
    },
    {
      heading: "6. Non-Solicitation",
      body: "For eighteen (18) months after the date of this Agreement, Recipient will not, directly or indirectly, solicit for employment any officer or management-level employee of the Company identified through the Confidential Information. General solicitations not targeted at Company employees are not a breach of this section.",
    },
    {
      heading: "7. Certification Status",
      body: `Recipient acknowledges that the Company holds certification as a Minority Business Enterprise from a regional council affiliated with the ${brand.sponsor.name}, and that the structure of any Transaction may affect the Company's continued eligibility for that certification. Recipient will not represent the Company's certification status to third parties without the Company's consent.`,
    },
    {
      heading: "8. Return or Destruction",
      body: "Within ten (10) days after the Company's written request, Recipient will return or destroy all Confidential Information, except copies retained under a bona fide document retention policy or as required by law, which remain subject to this Agreement.",
    },
    {
      heading: "9. No Obligation; No Warranty",
      body: `Neither party is obligated to pursue or complete a Transaction unless and until a definitive agreement is signed. Confidential Information is provided "as is," and neither the Company nor ${brand.operatorEntity} makes any representation as to its accuracy or completeness except as set out in a definitive agreement.`,
    },
    {
      heading: "10. Term and Remedies",
      body: "This Agreement remains in effect for two (2) years from the date of signature. Recipient acknowledges that a breach may cause irreparable harm and that the Company may seek injunctive relief in addition to any other remedy available at law.",
    },
    {
      heading: "11. Governing Law; Electronic Signature",
      body: `This Agreement is governed by the laws of the State of Delaware. The Company is an intended beneficiary of this Agreement and may enforce it directly. Recipient agrees that typing its name below constitutes its electronic signature, has the same effect as a handwritten signature, and that ${brand.name} may retain a record of this Agreement for both parties.`,
    },
  ];
}
