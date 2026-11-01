"use client";

import { startTransition } from "react";
import ApplyForm, { type ReadCim } from "./ApplyForm";
import { submitApplication } from "./actions";
import type { CimExtraction } from "@/lib/types";

/** Sends the PDF to /api/cim, where Claude reads it. */
const readCim: ReadCim = async (file, progress) => {
  const body = new FormData();
  body.append("file", file);
  progress("Claude is reading the CIM. This usually takes one to three minutes…");
  const res = await fetch("/api/cim", { method: "POST", body });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.message ?? "The CIM couldn't be read. Fill in the form by hand.");
  return data as CimExtraction;
};

export default function ApplyFormConnected() {
  return <ApplyForm onSubmit={(fd) => startTransition(() => submitApplication(fd))} readCim={readCim} />;
}
