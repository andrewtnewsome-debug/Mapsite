"use client";

import { Compass } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

const STEPS: { role: string; text: string }[] = [
  { role: "Investor", text: "Open the Deal Feed. Filter by industry, region, revenue or EBITDA, or search by keyword." },
  { role: "Investor", text: "Open any teaser. The company name, city and CIM are hidden until an NDA is signed." },
  { role: "Investor", text: "Click Pursue This Deal, review the standard NDA, type your name and firm, and sign." },
  { role: "Investor", text: "The company name and city appear and the CIM unlocks. Open the CIM, then send an inquiry." },
  { role: "Business Owner", text: "Switch to Business Owner. You are signed in as the owner of the deal you just pursued." },
  { role: "Business Owner", text: "Open Investor Pursuits or Messages to see the inquiry and the firm's profile, then reply." },
  { role: "Admin", text: "Switch to Admin to approve pending listings, verify certifications and mark investors verified." },
];

export function DemoGuideButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} className="hidden text-slate-600 md:inline-flex">
        <Compass /> Demo guide
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Walk through the demo"
        description="The full investor-to-owner story takes about three minutes."
        footer={<Button onClick={() => setOpen(false)}>Got it</Button>}
      >
        <ol className="space-y-3 px-5 py-4">
          {STEPS.map((s, i) => (
            <li key={i} className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white">
                {i + 1}
              </span>
              <div className="text-[13.5px] leading-relaxed text-slate-700">
                <span className="mr-1.5 text-[11px] font-semibold uppercase tracking-wide text-brand">{s.role}</span>
                {s.text}
              </div>
            </li>
          ))}
        </ol>
      </Dialog>
    </>
  );
}
