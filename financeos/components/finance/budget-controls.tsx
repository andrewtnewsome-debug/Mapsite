"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Trash2, Wand2 } from "lucide-react";
import type { Budget } from "@/lib/finance/budget";
import { PNL_CATEGORY_LABELS } from "@/lib/finance/statements";
import { formatCurrency } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/states";
import { Spinner } from "@/components/ui/spinner";

async function post(body: unknown) {
  const res = await fetch("/api/budget", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return res.ok;
}

export function CreateBudget({ fiscalYearLabel, hasHistory }: { fiscalYearLabel: string; hasHistory: boolean }) {
  const router = useRouter();
  const [income, setIncome] = React.useState("8");
  const [expense, setExpense] = React.useState("5");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function create() {
    setBusy(true);
    setError(null);
    const ok = await post({ action: "draft", growth: { income: Number(income) / 100 || 0, expense: Number(expense) / 100 || 0 } });
    setBusy(false);
    if (!ok) return setError("Could not create the budget. Check the growth percentages.");
    router.refresh();
  }
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Create a {fiscalYearLabel} budget</CardTitle>
          <CardDescription>
            FinanceOS drafts a budget from last year&apos;s actual results, keeping each account&apos;s monthly pattern, and applies your growth assumptions. You can then adjust any account.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {!hasHistory ? <Notice tone="warning">There is little or no prior-year history. Accounts without history are budgeted from the average of the months available.</Notice> : null}
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="g-income" className="mb-1 block text-[12px] font-medium text-text-3">Revenue growth vs last year (%)</label>
            <Input id="g-income" inputMode="decimal" className="w-40" value={income} onChange={(e) => setIncome(e.target.value)} />
          </div>
          <div>
            <label htmlFor="g-expense" className="mb-1 block text-[12px] font-medium text-text-3">Expense growth vs last year (%)</label>
            <Input id="g-expense" inputMode="decimal" className="w-40" value={expense} onChange={(e) => setExpense(e.target.value)} />
          </div>
          <Button variant="primary" onClick={create} disabled={busy}>
            {busy ? <Spinner label="Creating" /> : <Wand2 />} Draft budget
          </Button>
        </div>
        {error ? <Notice tone="critical">{error}</Notice> : null}
      </CardContent>
    </Card>
  );
}

export function EditBudget({ budget }: { budget: Budget }) {
  const router = useRouter();
  const [saving, setSaving] = React.useState<string | null>(null);
  async function save(line: Budget["lines"][number], text: string) {
    const annual = Number(text.replace(/[,$\s]/g, ""));
    if (!Number.isFinite(annual) || annual === line.annual) return;
    setSaving(line.account);
    await post({ action: "set-annual", account: line.account, category: line.category, annual });
    setSaving(null);
    router.refresh();
  }
  async function reset() {
    if (!window.confirm("Delete this budget? You can draft a new one from last year's actuals.")) return;
    await fetch("/api/budget", { method: "DELETE" });
    router.refresh();
  }
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Edit budget</CardTitle>
          <CardDescription>{budget.method} Change an annual amount and it is re-spread across months using the same pattern.</CardDescription>
        </div>
        <Button size="sm" variant="ghost" onClick={reset}>
          <Trash2 /> Start over
        </Button>
      </CardHeader>
      <CardContent className="px-0 pb-2">
        <div tabIndex={0} role="region" aria-label="Annual budget by account" className="max-h-[480px] overflow-auto">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 bg-surface">
              <tr className="border-b border-border">
                <th scope="col" className="py-2 pl-5 pr-3 text-left text-[12px] font-medium text-text-3">Account</th>
                <th scope="col" className="px-3 py-2 text-left text-[12px] font-medium text-text-3">Type</th>
                <th scope="col" className="py-2 pl-3 pr-5 text-right text-[12px] font-medium text-text-3">Annual budget</th>
              </tr>
            </thead>
            <tbody>
              {budget.lines.map((l) => (
                <tr key={`${l.category}|${l.account}`} className="border-b border-border/70">
                  <td className="py-1.5 pl-5 pr-3 font-medium">{l.account}</td>
                  <td className="px-3 py-1.5 text-[12px] text-text-3">{PNL_CATEGORY_LABELS[l.category]}</td>
                  <td className="py-1.5 pl-3 pr-5 text-right">
                    <div className="inline-flex items-center gap-2">
                      {saving === l.account ? <Spinner label="Saving" /> : null}
                      <Input
                        aria-label={`${l.account} annual budget`}
                        inputMode="decimal"
                        className="tabular w-36 text-right"
                        defaultValue={String(Math.round(l.annual))}
                        key={`${l.account}-${l.annual}`}
                        onBlur={(e) => save(l, e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-5 pt-2 text-[12px] text-text-3">Total annual revenue budget: {formatCurrency(budget.lines.filter((l) => l.category === "income").reduce((s, l) => s + l.annual, 0))}</p>
      </CardContent>
    </Card>
  );
}
