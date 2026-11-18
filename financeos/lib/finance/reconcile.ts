/**
 * Data checks: reconcile FinanceOS figures against each other and against
 * totals reported by the source system. Used to validate a sync (especially
 * the first real QuickBooks sync) before relying on the numbers.
 */

import type { FinancialDataset } from "@/lib/domain/types";
import { monthLabel } from "@/lib/domain/dates";
import { roundCents, sum } from "@/lib/domain/money";
import { openBillsAsOf, openInvoicesAsOf } from "./aging";
import { periodContaining } from "./periods";
import { latestBalanceSheet, summarizeBalanceSheet, summarizePnl } from "./statements";

export type CheckStatus = "match" | "mismatch" | "unavailable";

export interface ReconciliationCheck {
  id: string;
  label: string;
  ours: number | null;
  theirs: number | null;
  oursLabel: string;
  theirsLabel: string;
  difference: number | null;
  status: CheckStatus;
  /** What a mismatch usually means. */
  explanation: string;
}

const TOLERANCE = 1;

function check(id: string, label: string, oursLabel: string, ours: number | null, theirsLabel: string, theirs: number | null, explanation: string): ReconciliationCheck {
  if (ours == null || theirs == null) return { id, label, ours, theirs, oursLabel, theirsLabel, difference: null, status: "unavailable", explanation };
  const difference = roundCents(ours - theirs);
  return { id, label, ours, theirs, oursLabel, theirsLabel, difference, status: Math.abs(difference) <= TOLERANCE ? "match" : "mismatch", explanation };
}

export function reconcileDataset(ds: FinancialDataset): ReconciliationCheck[] {
  const checks: ReconciliationCheck[] = [];
  const snap = ds.coverage.balanceSheet ? latestBalanceSheet(ds) : null;
  const bs = snap && snap.date === ds.asOfDate ? summarizeBalanceSheet(snap) : null;
  const openAr = ds.coverage.invoices ? sum(openInvoicesAsOf(ds.invoices, ds.asOfDate).map((i) => i.balance)) : null;
  const openAp = ds.coverage.bills ? sum(openBillsAsOf(ds.bills, ds.asOfDate).map((b) => b.balance)) : null;

  checks.push(
    check("bs-balances", "Balance sheet balances", "Total assets", bs?.totalAssets ?? null, "Liabilities + equity", bs?.totalLiabilitiesAndEquity ?? null, "Assets should equal liabilities plus equity. A difference means the balance sheet report was not fully parsed."),
  );
  checks.push(
    check("ar-vs-bs", "Receivables: open invoices vs balance sheet", "Open invoice balances", openAr, "Balance sheet A/R", bs?.accountsReceivable ?? null, "Differences usually come from credit memos, unapplied customer payments, journal entries to A/R, or invoices dated after the reporting date."),
  );
  if (ds.sourceArAging) {
    checks.push(
      check("ar-vs-aging", "Receivables: open invoices vs QuickBooks A/R Aging report", "Open invoice balances", openAr, "A/R Aging report total", ds.sourceArAging.total, "QuickBooks' report nets credit memos and unapplied payments against customer balances; FinanceOS ages invoice balances only."),
    );
  }
  checks.push(
    check("ap-vs-bs", "Payables: open bills vs balance sheet", "Open bill balances", openAp, "Balance sheet A/P", bs?.accountsPayable ?? null, "Differences usually come from vendor credits, unapplied bill payments or journal entries to A/P."),
  );

  const banks = ds.accounts.filter((a) => a.type === "Bank" && a.active && a.currentBalance != null);
  if (ds.coverage.accounts && banks.length) {
    checks.push(
      check("cash-vs-accounts", "Cash: balance sheet vs bank account balances", "Balance sheet bank accounts", bs?.cash ?? null, "Bank account balances", sum(banks.map((a) => a.currentBalance ?? 0)), "Account balances are current as of the sync, so transactions dated after the reporting date can cause a difference."),
    );
  }

  const closedCf = ds.monthlyCashFlow.filter((m) => !m.isPartial);
  const lastCf = closedCf[closedCf.length - 1];
  if (lastCf) {
    const bsAtMonthEnd = ds.balanceSheets.find((b) => b.date === lastCf.endDate);
    checks.push(
      check(
        "cf-vs-bs",
        `Cash flow statement vs balance sheet (${monthLabel(lastCf.month)})`,
        "Cash at end of period (cash flow)",
        lastCf.endingCash,
        "Bank accounts (balance sheet)",
        bsAtMonthEnd ? summarizeBalanceSheet(bsAtMonthEnd).cash : null,
        "QuickBooks may treat some accounts (e.g. undeposited funds or credit cards) differently in the cash flow statement.",
      ),
    );
  }

  if (snap && ds.coverage.profitAndLoss) {
    const fy = periodContaining(ds.asOfDate.slice(0, 7), "year", ds.company.fiscalYearStartMonth);
    const ytdMonths = ds.monthlyPnl.filter((m) => m.month >= fy.startMonth && m.endDate <= ds.asOfDate);
    const niLine = snap.lines.find((l) => l.section === "equity" && /^net income$/i.test(l.account.trim()));
    checks.push(
      check(
        "ni-ytd",
        "Net income year to date: profit and loss vs balance sheet",
        "Sum of monthly P&L",
        ytdMonths.length ? summarizePnl(ytdMonths).netIncome : null,
        "Balance sheet equity line \"Net Income\"",
        niLine?.amount ?? null,
        "The balance sheet's Net Income line is year-to-date profit. A difference suggests missing P&L months or a fiscal-year setting mismatch.",
      ),
    );
  }

  const st = ds.sourceTotals;
  if (st) {
    const months = Object.keys(st.netIncomeByMonth).sort();
    let worst: ReconciliationCheck | null = null;
    let matched = 0;
    for (const m of months) {
      const pnl = ds.monthlyPnl.find((x) => x.month === m);
      const c = check(`ni-${m}`, `Net income ${monthLabel(m)}`, "P&L line items", pnl ? summarizePnl([pnl]).netIncome : 0, "QuickBooks net income", st.netIncomeByMonth[m], "");
      if (c.status === "match") matched += 1;
      else if (!worst || Math.abs(c.difference ?? 0) > Math.abs(worst.difference ?? 0)) worst = c;
    }
    if (months.length) {
      checks.push({
        id: "pnl-vs-source",
        label: `Monthly net income vs QuickBooks report (${matched} of ${months.length} months match)`,
        ours: worst?.ours ?? null,
        theirs: worst?.theirs ?? null,
        oursLabel: worst ? `Largest difference: ${worst.label}` : "All months",
        theirsLabel: "QuickBooks net income",
        difference: worst?.difference ?? 0,
        status: matched === months.length ? "match" : "mismatch",
        explanation: "FinanceOS adds up the account lines in the Profit and Loss report. A difference means a line was not recognized; check Settings > data quality notes.",
      });
    }
    const dates = Object.keys(st.totalAssetsByDate).sort();
    const last = dates[dates.length - 1];
    if (last) {
      const snapAt = ds.balanceSheets.find((b) => b.date === last);
      checks.push(
        check("bs-vs-source", `Total assets vs QuickBooks report (${last})`, "Sum of balance sheet lines", snapAt ? summarizeBalanceSheet(snapAt).totalAssets : null, "QuickBooks total assets", st.totalAssetsByDate[last], "FinanceOS adds up the account lines in the Balance Sheet report. A difference means a section was not recognized."),
      );
    }
  }
  return checks;
}
