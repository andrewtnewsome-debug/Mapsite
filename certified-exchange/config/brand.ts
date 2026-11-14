/**
 * Single source of truth for product naming and brand tokens.
 * Rename the product or change the accent color here; nothing else in the
 * codebase hard-codes the name or the accent.
 */
export const brand = {
  /** Product name shown in the sidebar, page titles, NDA and CIM watermarks. */
  name: "Certified Exchange",
  /** Two-letter monogram used in the logo mark and favicon-sized spots. */
  monogram: "CX",
  /** Prefix for listing and agreement reference numbers, e.g. CX-1007. */
  refPrefix: "CX",
  tagline: "Private deal flow for certified minority business enterprises.",
  /** The sponsoring organization that certifies businesses on the platform. */
  sponsor: {
    name: "National Minority Supplier Development Council",
    short: "NMSDC",
  },
  /** Legal entity named as the platform operator in the standard NDA. */
  operatorEntity: "Certified Exchange Platform, LLC",
  ndaVersion: "CX-NDA 2026.2",
  supportEmail: "dealdesk@certifiedexchange.example",
  /**
   * One restrained accent color. Exposed to Tailwind as `brand`
   * (bg-brand, text-brand, border-brand, bg-brand/10, ...).
   */
  colors: {
    accent: "#0f6b66",
    accentHover: "#0b5550",
  },
  /** localStorage key for persisted demo state. Bump the suffix to force a reset. */
  storageKey: "certified-exchange-demo-v1",
} as const;

export type Brand = typeof brand;
