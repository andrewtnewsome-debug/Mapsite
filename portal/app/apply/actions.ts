"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSubmission } from "@/lib/db";
import type { CapitalType, SubmissionInput, Timeline, UseOfFunds } from "@/lib/types";

function text(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

/** Accepts "4,500,000", "$4.5M", "750k". */
function dollars(fd: FormData, key: string): number {
  const raw = text(fd, key).toLowerCase().replace(/[$,\s]/g, "");
  const match = raw.match(/^(-?\d*\.?\d+)([km])?$/);
  if (!match) return 0;
  const n = parseFloat(match[1]);
  return Math.round(match[2] === "m" ? n * 1_000_000 : match[2] === "k" ? n * 1_000 : n);
}

export async function submitApplication(fd: FormData) {
  const input: SubmissionInput = {
    contact: {
      name: text(fd, "contactName"),
      title: text(fd, "contactTitle"),
      email: text(fd, "contactEmail"),
      phone: text(fd, "contactPhone"),
    },
    company: {
      name: text(fd, "companyName"),
      website: text(fd, "website"),
      city: text(fd, "city"),
      state: text(fd, "state"),
      yearFounded: Number(text(fd, "yearFounded")),
      employees: Number(text(fd, "employees")),
      description: text(fd, "description"),
    },
    ownership: {
      diverseOwned: fd.get("diverseOwned") === "on",
      ownerOperator: fd.get("ownerOperator") === "on",
    },
    deal: {
      amount: dollars(fd, "amount"),
      capitalType: text(fd, "capitalType") as CapitalType,
      useOfFunds: text(fd, "useOfFunds") as UseOfFunds,
      timeline: text(fd, "timeline") as Timeline,
      details: text(fd, "details"),
    },
    financials: {
      revenueLTM: dollars(fd, "revenueLTM"),
      revenuePrior: dollars(fd, "revenuePrior"),
      ebitdaLTM: dollars(fd, "ebitdaLTM"),
      topCustomerPct: Number(text(fd, "topCustomerPct")),
      existingDebt: dollars(fd, "existingDebt"),
    },
  };

  if (!input.company.name || !input.contact.email || input.deal.amount <= 0) {
    throw new Error("Missing required fields");
  }

  const created = createSubmission(input);
  revalidatePath("/team");
  redirect(`/apply/thanks?ref=${created.id}`);
}
