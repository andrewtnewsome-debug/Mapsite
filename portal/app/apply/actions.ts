"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSubmission } from "@/lib/db";
import { parseSubmission } from "@/lib/formInput";

export async function submitApplication(fd: FormData) {
  const input = parseSubmission(fd);
  if (!input.company.name || !input.contact.email || input.deal.amount <= 0) {
    throw new Error("Missing required fields");
  }
  const created = createSubmission(input);
  revalidatePath("/team");
  redirect(`/apply/thanks?ref=${created.id}`);
}
