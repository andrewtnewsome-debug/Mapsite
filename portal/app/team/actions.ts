"use server";

import { revalidatePath } from "next/cache";
import { addNote, logIntroduction, setStatus } from "@/lib/db";
import type { Status } from "@/lib/types";

export async function updateStatus(id: string, status: Status) {
  setStatus(id, status);
  revalidatePath(`/team/submissions/${id}`);
  revalidatePath("/team");
}

export async function postNote(id: string, fd: FormData) {
  const text = String(fd.get("text") ?? "").trim();
  if (!text) return;
  addNote(id, { at: new Date().toISOString(), author: "You (MAPlab)", text });
  revalidatePath(`/team/submissions/${id}`);
}

export async function introduce(id: string, providerId: string) {
  logIntroduction(id, providerId);
  revalidatePath(`/team/submissions/${id}`);
  revalidatePath("/team");
}
