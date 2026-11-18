"use client";

import * as React from "react";
import { AlertTriangle, Bot, Check, ClipboardCopy, ListPlus, Mail, Trash2 } from "lucide-react";
import type { CollectionPlan, DraftTone } from "@/lib/finance/collections";
import { draftReminderEmail, STAGE_LABELS } from "@/lib/finance/collections";
import { addDays, formatIsoDate } from "@/lib/domain/dates";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PriorityBadge } from "@/components/finance/status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { EmptyState, Notice } from "@/components/ui/states";
import { Segmented } from "@/components/ui/tabs";
import { Spinner } from "@/components/ui/spinner";

interface FollowUp {
  id: string;
  customerName: string;
  invoiceNumbers: string[];
  amount: number;
  action: string;
  followUpDate: string;
  status: "proposed" | "approved" | "done" | "dismissed";
  subject: string;
  body: string;
  approvedAt: string | null;
}

const STATUS_TONE = { proposed: "neutral", approved: "accent", done: "good", dismissed: "outline" } as const;

export function CollectionsWorkspace({ plans, companyName, asOfDate }: { plans: CollectionPlan[]; companyName: string; asOfDate: string }) {
  const [selectedId, setSelectedId] = React.useState(plans[0]?.customerId ?? null);
  const plan = plans.find((p) => p.customerId === selectedId) ?? null;
  const [tone, setTone] = React.useState<DraftTone>(plan?.recommendedTone ?? "friendly");
  const [subject, setSubject] = React.useState("");
  const [body, setBody] = React.useState("");
  const [copied, setCopied] = React.useState(false);
  const [polish, setPolish] = React.useState<{ state: "idle" | "loading" | "error" | "done"; message?: string; unverified?: string[]; model?: string }>({ state: "idle" });
  const [followUps, setFollowUps] = React.useState<FollowUp[]>([]);
  const [listError, setListError] = React.useState<string | null>(null);
  const [action, setAction] = React.useState("");
  const [followUpDate, setFollowUpDate] = React.useState(addDays(asOfDate, 3));

  React.useEffect(() => {
    if (!plan) return;
    const d = draftReminderEmail(plan, companyName, tone, asOfDate);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- regenerate the template when the customer or tone changes
    setSubject(d.subject);
    setBody(d.body);
    setAction(plan.nextActions[0] ?? "Send reminder");
    setPolish({ state: "idle" });
    setCopied(false);
  }, [plan, tone, companyName, asOfDate]);

  const loadList = React.useCallback(async () => {
    const res = await fetch("/api/collections/followups");
    if (res.ok) setFollowUps(((await res.json()) as { followUps: FollowUp[] }).followUps);
    else setListError("Could not load follow-ups.");
  }, []);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load of the local follow-up list
    void loadList();
  }, [loadList]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      window.prompt("Copy the draft:", `Subject: ${subject}\n\n${body}`);
    }
  }

  async function polishWithAi() {
    setPolish({ state: "loading" });
    const res = await fetch("/api/ai/rewrite", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subject, body }) });
    const data = (await res.json()) as { ok: boolean; error?: string; subject?: string; body?: string; unverified?: string[]; model?: string };
    if (!res.ok || !data.ok) return setPolish({ state: "error", message: data.error ?? "AI polishing failed." });
    setSubject(data.subject!);
    setBody(data.body!);
    setPolish({ state: "done", unverified: data.unverified ?? [], model: data.model });
  }

  async function addFollowUp() {
    if (!plan) return;
    const res = await fetch("/api/collections/followups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerId: plan.customerId,
        customerName: plan.customerName,
        invoiceNumbers: plan.overdueInvoices.map((i) => i.docNumber ?? i.id),
        amount: plan.totalOverdue,
        action: action.trim() || "Follow up",
        followUpDate,
        subject,
        body,
      }),
    });
    if (!res.ok) return setListError("Could not add the follow-up. Check the action and date.");
    setListError(null);
    await loadList();
  }

  async function update(id: string, patch: Partial<FollowUp>) {
    const res = await fetch("/api/collections/followups", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...patch }) });
    if (res.ok) await loadList();
  }

  async function remove(id: string) {
    const res = await fetch("/api/collections/followups", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    if (res.ok) await loadList();
  }

  if (plans.length === 0) {
    return (
      <Card>
        <EmptyState title="No overdue invoices" description="Every open invoice is current. Nothing needs collection follow-up today." />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Card className="self-start">
          <CardHeader>
            <div>
              <CardTitle>Customers to contact</CardTitle>
              <CardDescription>Ranked by collections priority</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="px-2 pb-2 pt-2">
            <ul aria-label="Overdue customers" className="space-y-0.5">
              {plans.map((p, i) => (
                <li key={p.customerId}>
                  <button
                    type="button"
                    aria-pressed={p.customerId === selectedId}
                    onClick={() => {
                      setSelectedId(p.customerId);
                      setTone(p.recommendedTone);
                    }}
                    className={cn("flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left", p.customerId === selectedId ? "bg-surface-2" : "hover:bg-surface-2/60")}
                  >
                    <span className="tabular mt-0.5 w-4 text-[12px] text-text-3">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-[13px] font-medium">{p.customerName}</span>
                        <span className="tabular text-[13px] font-medium">{formatCurrency(p.totalOverdue)}</span>
                      </span>
                      <span className="mt-1 flex items-center justify-between gap-2">
                        <span className="text-[12px] text-text-3">
                          {STAGE_LABELS[p.stage]} · {p.oldestDaysOverdue} days
                        </span>
                        <PriorityBadge level={p.priority.level} score={p.priority.score} />
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {plan ? (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>{plan.customerName}</CardTitle>
                  <CardDescription>
                    {formatCurrency(plan.totalOverdue, { cents: true })} overdue across {plan.overdueInvoices.length} invoice{plan.overdueInvoices.length === 1 ? "" : "s"} · {plan.email ?? "no email on file"}
                  </CardDescription>
                </div>
                <Badge tone={plan.stage === "final-notice" ? "critical" : plan.stage === "escalation" ? "serious" : "warning"}>{STAGE_LABELS[plan.stage]}</Badge>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                <div>
                  <p className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-text-3">Overdue invoices</p>
                  <ul className="divide-y divide-border rounded-lg border border-border text-[13px]">
                    {plan.overdueInvoices.map((i) => (
                      <li key={i.id} className="flex items-center justify-between gap-3 px-3 py-2">
                        <span>
                          <span className="font-medium">#{i.docNumber ?? i.id}</span>
                          <span className="text-text-3"> · due {formatIsoDate(i.effectiveDueDate)} · {i.daysOverdue} days late</span>
                          {i.status === "partially-paid" ? <Badge tone="accent" className="ml-2">Partially paid</Badge> : null}
                        </span>
                        <span className="tabular font-medium">{formatCurrency(i.balance, { cents: true })}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-text-3">Suggested next actions</p>
                  <ol className="list-decimal space-y-1.5 pl-5 text-[13px] text-text-2">
                    {plan.nextActions.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ol>
                  <p className="mt-2 text-[12px] text-text-3">Suggestions follow fixed rules by days overdue; they are not legal advice.</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Mail className="size-4" aria-hidden /> Reminder email draft
                  </CardTitle>
                  <CardDescription>Invoice numbers and amounts are filled in from your data. Edit freely. FinanceOS does not send email.</CardDescription>
                </div>
                <Segmented
                  label="Tone"
                  value={tone}
                  onChange={setTone}
                  options={[
                    { value: "friendly", label: "Friendly" },
                    { value: "firm", label: "Firm" },
                    { value: "final", label: "Final notice" },
                  ]}
                />
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <label htmlFor="draft-subject" className="mb-1 block text-[12px] font-medium text-text-3">Subject</label>
                  <Input id="draft-subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={300} />
                </div>
                <div>
                  <label htmlFor="draft-body" className="mb-1 block text-[12px] font-medium text-text-3">Message</label>
                  <Textarea id="draft-body" value={body} onChange={(e) => setBody(e.target.value)} rows={14} maxLength={10_000} className="font-[inherit] text-[13px]" />
                </div>
                {polish.state === "error" ? <Notice tone="warning">{polish.message}</Notice> : null}
                {polish.state === "done" ? (
                  <Notice tone={polish.unverified?.length ? "warning" : "info"}>
                    <span className="inline-flex items-center gap-1.5 font-medium">
                      <Bot className="size-3.5" aria-hidden /> Polished by your local model{polish.model ? ` (${polish.model})` : ""}.
                    </span>{" "}
                    {polish.unverified?.length ? (
                      <span className="inline-flex items-start gap-1">
                        <AlertTriangle className="mt-0.5 size-3.5" aria-hidden /> These figures were not in the original draft: {polish.unverified.join(", ")}. Check them before using this email.
                      </span>
                    ) : (
                      "All figures match the original draft. Review before sending."
                    )}
                  </Notice>
                ) : null}
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="primary" onClick={copy}>
                    {copied ? <Check /> : <ClipboardCopy />} {copied ? "Copied" : "Copy to clipboard"}
                  </Button>
                  <Button onClick={polishWithAi} disabled={polish.state === "loading"}>
                    {polish.state === "loading" ? <Spinner label="Polishing" /> : <Bot />} Polish with local AI
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      const d = draftReminderEmail(plan, companyName, tone, asOfDate);
                      setSubject(d.subject);
                      setBody(d.body);
                      setPolish({ state: "idle" });
                    }}
                  >
                    Reset draft
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Add to follow-up list</CardTitle>
                  <CardDescription>Saves this action and draft on this computer for your approval.</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <form
                  className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_170px_auto]"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void addFollowUp();
                  }}
                >
                  <div>
                    <label htmlFor="fu-action" className="mb-1 block text-[12px] font-medium text-text-3">Action</label>
                    <Input id="fu-action" value={action} onChange={(e) => setAction(e.target.value)} maxLength={300} />
                  </div>
                  <div>
                    <label htmlFor="fu-date" className="mb-1 block text-[12px] font-medium text-text-3">Follow-up date</label>
                    <Input id="fu-date" type="date" value={followUpDate} onChange={(e) => setFollowUpDate(e.target.value)} required />
                  </div>
                  <div className="flex items-end">
                    <Button type="submit" variant="primary">
                      <ListPlus /> Add
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Follow-up list</CardTitle>
            <CardDescription>Approve a follow-up to record your decision. Emails are never sent automatically; copy approved drafts into your email program.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="px-0 pb-2">
          {listError ? <Notice tone="critical" className="mx-5 mb-3">{listError}</Notice> : null}
          {followUps.length === 0 ? (
            <p className="px-5 pb-3 text-[13px] text-text-3">No follow-ups yet. Add one from a customer above.</p>
          ) : (
            <ul className="divide-y divide-border">
              {followUps.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-[13px]">
                  <Badge tone={STATUS_TONE[f.status]}>{f.status[0].toUpperCase() + f.status.slice(1)}</Badge>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {f.customerName} · <span className="tabular">{formatCurrency(f.amount)}</span>
                    </p>
                    <p className="truncate text-[12px] text-text-3">
                      {f.action} · by {formatIsoDate(f.followUpDate)} · invoices {f.invoiceNumbers.map((n) => `#${n}`).join(", ")}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {f.status === "proposed" ? (
                      <Button size="sm" variant="primary" onClick={() => update(f.id, { status: "approved" })}>
                        Approve
                      </Button>
                    ) : null}
                    {f.status === "approved" ? (
                      <Button size="sm" onClick={() => navigator.clipboard?.writeText(`Subject: ${f.subject}\n\n${f.body}`)}>
                        <ClipboardCopy /> Copy draft
                      </Button>
                    ) : null}
                    {f.status !== "done" && f.status !== "dismissed" ? (
                      <Button size="sm" variant="ghost" onClick={() => update(f.id, { status: "done" })}>
                        Mark done
                      </Button>
                    ) : null}
                    {f.status === "proposed" ? (
                      <Button size="sm" variant="ghost" onClick={() => update(f.id, { status: "dismissed" })}>
                        Dismiss
                      </Button>
                    ) : null}
                    <button type="button" aria-label={`Delete follow-up for ${f.customerName}`} onClick={() => remove(f.id)} className="inline-flex size-8 items-center justify-center rounded-md text-text-3 hover:bg-surface-2 hover:text-critical-text">
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
