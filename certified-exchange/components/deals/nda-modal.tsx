"use client";

import { FileSignature, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { brand } from "@/config/brand";
import { ndaSections } from "@/data/nda";
import type { NDA } from "@/data/types";
import { dateTime, dealRef, shortDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/primitives";

function AgreementText({ dealId, firm, onScrolledToEnd }: { dealId: string; firm: string; onScrolledToEnd?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !onScrolledToEnd) return;
    const check = () => {
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 24) onScrolledToEnd();
    };
    el.addEventListener("scroll", check);
    check();
    return () => el.removeEventListener("scroll", check);
  }, [onScrolledToEnd]);

  return (
    <div ref={ref} className="max-h-[38vh] overflow-y-auto rounded-md border border-slate-200 bg-slate-50/70 px-5 py-4 font-serif text-[13.5px] leading-relaxed text-slate-800">
      <p className="text-center text-[12px] font-semibold uppercase tracking-[0.12em] text-slate-600">Confidentiality Agreement · Standard Form</p>
      <p className="mt-1 text-center text-[12px] text-slate-500">
        {brand.ndaVersion} · Administered by {brand.operatorEntity}
      </p>
      {ndaSections(dealRef(dealId), firm).map((s) => (
        <div key={s.heading} className="mt-3">
          <p className="font-semibold text-slate-900">{s.heading}</p>
          <p className="mt-0.5">{s.body}</p>
        </div>
      ))}
    </div>
  );
}

function SignatureLine({ name, title, firm, date }: { name: string; title: string; firm: string; date: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Recipient signature</div>
      <div className={cn("mt-1 min-h-10 border-b border-slate-400 pb-1 font-signature text-[28px] leading-none text-slate-900", !name && "text-slate-300")}>
        {name || "Your signature"}
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-2 text-[12px] text-slate-600 sm:grid-cols-3">
        <span>
          <span className="text-slate-400">Name: </span>
          {name || "—"}
        </span>
        <span>
          <span className="text-slate-400">Firm: </span>
          {firm || "—"}
        </span>
        <span>
          <span className="text-slate-400">Date: </span>
          {date}
        </span>
        {title && (
          <span className="col-span-2 sm:col-span-3">
            <span className="text-slate-400">Title: </span>
            {title}
          </span>
        )}
      </div>
    </div>
  );
}

export function NdaModal({
  open,
  onClose,
  dealId,
  defaultFirm,
  defaultTitle,
  onSign,
}: {
  open: boolean;
  onClose: () => void;
  dealId: string;
  defaultFirm: string;
  defaultTitle: string;
  onSign: (v: { signedName: string; signedTitle: string; firmName: string }) => void;
}) {
  const [name, setName] = useState("");
  const [title, setTitle] = useState(defaultTitle);
  const [firm, setFirm] = useState(defaultFirm);
  const [agree, setAgree] = useState(false);
  const [reviewed, setReviewed] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setTitle(defaultTitle);
      setFirm(defaultFirm);
      setAgree(false);
      setReviewed(false);
    }
  }, [open, defaultFirm, defaultTitle]);

  const valid = name.trim().length >= 3 && firm.trim().length >= 2 && agree;
  const today = shortDate(new Date().toISOString());

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="xl"
      labelledBy="nda-title"
      title={
        <span className="inline-flex items-center gap-2">
          <FileSignature className="size-4 text-brand" /> Non-Disclosure Agreement · {dealRef(dealId)}
        </span>
      }
      description="Review the platform's standard NDA. Signing releases the company name, location, CIM and direct messaging with the owner."
      footer={
        <>
          <span className="mr-auto hidden text-[12px] text-slate-500 sm:inline">
            {/* TODO(e-sign): replace with a compliant e-signature provider and audit trail. */}
            Typed signatures are recorded with a timestamp in this prototype.
          </span>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!valid} onClick={() => onSign({ signedName: name, signedTitle: title, firmName: firm })}>
            <FileSignature /> Sign NDA &amp; unlock
          </Button>
        </>
      }
    >
      <div className="space-y-4 px-5 py-4">
        <AgreementText dealId={dealId} firm={firm} onScrolledToEnd={() => setReviewed(true)} />
        <p className={cn("text-[12px]", reviewed ? "text-emerald-700" : "text-slate-500")}>
          {reviewed ? "You have reached the end of the agreement." : "Scroll to review the full agreement before signing."}
        </p>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Full legal name" htmlFor="nda-name" required>
            <Input id="nda-name" data-autofocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Type your full name" autoComplete="off" />
          </Field>
          <Field label="Title" htmlFor="nda-title-input">
            <Input id="nda-title-input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Firm name" htmlFor="nda-firm" required>
            <Input id="nda-firm" value={firm} onChange={(e) => setFirm(e.target.value)} />
          </Field>
        </div>

        <SignatureLine name={name.trim()} title={title.trim()} firm={firm.trim()} date={today} />

        <label className="flex cursor-pointer items-start gap-2.5 text-[13px] leading-relaxed text-slate-700">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1 size-4 accent-[var(--brand)]" />
          <span>
            I agree to the terms above, I am authorized to sign on behalf of <strong>{firm.trim() || "my firm"}</strong>, and I consent to
            signing electronically. Typing my name constitutes my signature.
          </span>
        </label>
      </div>
    </Dialog>
  );
}

export function SignedNdaDialog({ open, onClose, nda }: { open: boolean; onClose: () => void; nda: NDA }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="xl"
      labelledBy="signed-nda-title"
      title={
        <span className="inline-flex items-center gap-2">
          <ShieldCheck className="size-4 text-emerald-600" /> Executed NDA · {dealRef(nda.dealId)}
        </span>
      }
      description={`Signed ${dateTime(nda.signedAt)} · Agreement ID ${nda.id.toUpperCase()} · ${nda.version}`}
      footer={
        <>
          <Button
            variant="outline"
            onClick={() => window.print()}
            // TODO(documents): generate a signed, tamper-evident PDF copy for download.
            title="Print or save this agreement as PDF"
          >
            Print copy
          </Button>
          <Button onClick={onClose}>Close</Button>
        </>
      }
    >
      <div className="space-y-4 px-5 py-4">
        <AgreementText dealId={nda.dealId} firm={nda.firmName} />
        <SignatureLine name={nda.signedName} title={nda.signedTitle} firm={nda.firmName} date={shortDate(nda.signedAt)} />
      </div>
    </Dialog>
  );
}
