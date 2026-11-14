"use client";

import { Send } from "lucide-react";
import { useState } from "react";
import { CAPITAL_OPTIONS, CRITERIA_FIT_OPTIONS, TIMELINE_OPTIONS } from "@/data/taxonomy";
import type { Inquiry } from "@/data/types";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/primitives";

export function InquiryForm({
  ownerFirstName,
  onSubmit,
}: {
  ownerFirstName: string;
  onSubmit: (v: Pick<Inquiry, "message" | "criteriaFit" | "capitalAvailable" | "timeline">) => void;
}) {
  const [message, setMessage] = useState("");
  const [criteriaFit, setCriteriaFit] = useState("");
  const [capitalAvailable, setCapital] = useState("");
  const [timeline, setTimeline] = useState("");

  const valid = message.trim().length >= 20 && criteriaFit && capitalAvailable && timeline;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSubmit({ message: message.trim(), criteriaFit, capitalAvailable, timeline });
      }}
      className="space-y-4"
    >
      <Field
        label={`Message to ${ownerFirstName}`}
        htmlFor="inq-message"
        required
        hint={message.trim().length < 20 ? "At least 20 characters. Introduce your firm and what you'd like to discuss." : `${message.trim().length} characters`}
      >
        <Textarea
          id="inq-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={4}
          placeholder="Introduce your firm, explain why this business fits, and propose next steps such as an introductory call."
        />
      </Field>
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Fit with your investment criteria" htmlFor="inq-fit" required>
          <Select id="inq-fit" value={criteriaFit} onChange={(e) => setCriteriaFit(e.target.value)}>
            <option value="">Select…</option>
            {CRITERIA_FIT_OPTIONS.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </Select>
        </Field>
        <Field label="Capital available" htmlFor="inq-capital" required>
          <Select id="inq-capital" value={capitalAvailable} onChange={(e) => setCapital(e.target.value)}>
            <option value="">Select…</option>
            {CAPITAL_OPTIONS.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </Select>
        </Field>
        <Field label="Timeline" htmlFor="inq-timeline" required>
          <Select id="inq-timeline" value={timeline} onChange={(e) => setTimeline(e.target.value)}>
            <option value="">Select…</option>
            {TIMELINE_OPTIONS.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12px] text-slate-500">The owner will see your firm profile and these answers alongside your message.</p>
        <Button type="submit" disabled={!valid}>
          <Send /> Send inquiry
        </Button>
      </div>
    </form>
  );
}
