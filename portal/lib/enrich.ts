import { classifyNaics, sectorOf } from "./naics";
import { draftSummary, summaryFromCim } from "./summary";
import type { NaicsResult, Submission, SubmissionInput } from "./types";

/** Adds the industry code and deal summary on intake: Claude's, when a CIM was read, otherwise the placeholders. */
export function enrichSubmission(input: SubmissionInput, at: Date): Pick<Submission, "naics" | "ai"> {
  const cim = input.cim;
  const naics: NaicsResult = cim?.naics
    ? {
        code: cim.naics.code,
        title: cim.naics.title,
        sector: sectorOf(cim.naics.code),
        confidence: null,
        rationale: cim.naics.rationale,
        alternates: [],
      }
    : classifyNaics(input.company.name, input.company.description);
  return { naics, ai: cim?.summary ? summaryFromCim(input, cim, at) : draftSummary(input, naics, at) };
}
