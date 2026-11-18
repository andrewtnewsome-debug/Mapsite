/**
 * Deterministic generator for the fictional demo company.
 *
 * The data is built bottom-up from transactions so that every statement is
 * internally consistent:
 *   - Revenue = invoices dated in the period.
 *   - Accounts receivable = unpaid invoice balances at the balance sheet date.
 *   - Accounts payable = unpaid vendor bills at the balance sheet date.
 *   - Cash moves only through collections, bill payments, payroll and other
 *     direct expenses, interest, capital expenditures, loan principal and
 *     owner distributions.
 *   - The balance sheet balances because equity rolls forward with net income
 *     and distributions.
 * Tests in tests/demo-data.test.ts verify these identities.
 */

import type {
  Account,
  BalanceSheetLine,
  BalanceSheetSnapshot,
  Bill,
  CashFlowLine,
  Customer,
  FinancialDataset,
  Invoice,
  InvoiceLine,
  MonthlyCashFlow,
  MonthlyPnl,
  Payment,
  PnlLine,
  Vendor,
} from "@/lib/domain/types";
import {
  addDays,
  addMonths,
  daysBetween,
  daysInMonth,
  monthEnd,
  monthLabel,
  monthOf,
  monthRange,
  monthStart,
} from "@/lib/domain/dates";
import { roundCents, sum } from "@/lib/domain/money";
import { between, normalish, rngFor } from "./prng";
import {
  CONTRACT_SERVICE_LINES,
  DEMO_COMPANY_PROFILE,
  DEMO_CUSTOMERS,
  DEMO_VENDORS,
  PROJECT_TYPES,
  type DemoCustomerProfile,
} from "./profile";

const HISTORY_MONTHS = 24;
const WARMUP_MONTHS = 4;
const BASE_MONTHLY_REVENUE = 655_000;
const ANNUAL_GROWTH = 0.085;
const SEASONALITY = [0.93, 0.92, 0.97, 1.0, 1.02, 1.07, 1.09, 1.08, 1.03, 1.0, 0.96, 0.93];
const CONTRACT_SHARE_OF_REVENUE = 0.7;
const RESERVE_ACCOUNT_BALANCE = 150_000;
const PREPAID_EXPENSES = 46_000;
const ACCRUED_PAYROLL = 58_000;
const COMMON_STOCK = 10_000;
const OPENING = {
  cash: 680_000,
  fixedAssetsGross: 1_180_000,
  accumulatedDepreciation: -655_000,
  loanBalance: 396_000,
};
const LOAN_RATE = 0.0675;
const LOAN_PRINCIPAL_PER_MONTH = 8_800;
const QUARTERLY_DISTRIBUTION = 60_000;
const MINIMUM_CASH_POLICY = 300_000;

interface ScheduledPayment {
  date: string;
  amount: number;
}

interface WorkingInvoice extends Invoice {
  kind: "contract" | "project";
  schedule: ScheduledPayment[];
}

interface WorkingBill extends Bill {
  schedule: ScheduledPayment[];
}

export interface DemoOptions {
  /** Timestamp recorded as the "generated at" time. Defaults to now. */
  generatedAt?: string;
}

function monthIndexFrom(base: string, month: string): number {
  const [by, bm] = base.split("-").map(Number);
  const [y, m] = month.split("-").map(Number);
  return (y - by) * 12 + (m - bm);
}

function monthlyRevenue(month: string, asOfMonth: string): number {
  const t = monthIndexFrom(asOfMonth, month); // 0 = current month, negative = past
  const seasonal = SEASONALITY[Number(month.slice(5, 7)) - 1];
  const noise = 1 + between(rngFor(`rev:${month}`), -0.025, 0.025);
  return BASE_MONTHLY_REVENUE * Math.pow(1 + ANNUAL_GROWTH, t / 12) * seasonal * noise;
}

function clampDay(month: string, day: number): string {
  const d = Math.max(1, Math.min(daysInMonth(month), Math.round(day)));
  return `${month}-${String(d).padStart(2, "0")}`;
}

function wholeDollars(value: number): number {
  return Math.round(value);
}

function contractLines(customer: DemoCustomerProfile, month: string, amount: number): InvoiceLine[] {
  const lines: InvoiceLine[] = [];
  let remaining = amount;
  CONTRACT_SERVICE_LINES.forEach((svc, i) => {
    const isLast = i === CONTRACT_SERVICE_LINES.length - 1;
    const lineAmount = isLast ? roundCents(remaining) : wholeDollars(amount * svc.share);
    remaining = roundCents(remaining - lineAmount);
    lines.push({
      description: `${svc.description} - ${monthLabel(month, "long")}`,
      itemName: svc.name,
      quantity: 1,
      unitPrice: lineAmount,
      amount: lineAmount,
    });
  });
  return lines;
}

function projectLines(title: string, amount: number, rng: () => number): InvoiceLine[] {
  const rate = 95;
  const laborShare = between(rng, 0.55, 0.75);
  const hours = Math.max(4, Math.round((amount * laborShare) / rate));
  const labor = roundCents(hours * rate);
  const materials = roundCents(amount - labor);
  const lines: InvoiceLine[] = [
    { description: `${title} - technician labor`, itemName: "Project labor", quantity: hours, unitPrice: rate, amount: labor },
  ];
  if (materials > 0) {
    lines.push({ description: `${title} - parts and materials`, itemName: "Materials", quantity: 1, unitPrice: materials, amount: materials });
  }
  return lines;
}

function paymentSchedule(
  inv: { totalAmount: number; txnDate: string; month: string },
  customer: DemoCustomerProfile,
  asOfMonth: string,
  key: string,
): ScheduledPayment[] {
  const rng = rngFor(`pay:${key}`);
  const recent =
    customer.recentSlowdown && monthIndexFrom(asOfMonth, inv.month) >= -customer.recentSlowdown.lastMonths;
  const mean = recent && customer.recentSlowdown ? customer.recentSlowdown.avgDaysToPay : customer.avgDaysToPay;
  const days = Math.max(3, Math.round(normalish(rng, mean, customer.paySpreadDays)));
  if (customer.partialPayer) {
    const first = wholeDollars(inv.totalAmount * 0.5);
    return [
      { date: addDays(inv.txnDate, Math.max(3, days - 12)), amount: first },
      { date: addDays(inv.txnDate, days + 22), amount: roundCents(inv.totalAmount - first) },
    ];
  }
  return [{ date: addDays(inv.txnDate, days), amount: inv.totalAmount }];
}

function balanceAsOf(doc: { txnDate: string; totalAmount: number; schedule: ScheduledPayment[] }, date: string): number {
  if (doc.txnDate > date) return 0;
  const paid = sum(doc.schedule.filter((p) => p.date <= date).map((p) => p.amount));
  return roundCents(doc.totalAmount - paid);
}

export function buildDemoDataset(asOfDate: string, options: DemoOptions = {}): FinancialDataset {
  const asOfMonth = monthOf(asOfDate);
  const firstMonth = addMonths(asOfMonth, -HISTORY_MONTHS);
  const warmupStart = addMonths(firstMonth, -WARMUP_MONTHS);
  const allMonths = monthRange(warmupStart, asOfMonth);
  const windowMonths = monthRange(firstMonth, asOfMonth);
  const customerById = new Map(DEMO_CUSTOMERS.map((c) => [c.id, c]));

  // ---------------------------------------------------------------- invoices
  const drafts: Omit<WorkingInvoice, "id" | "docNumber" | "schedule" | "balance">[] = [];
  for (const month of allMonths) {
    const revenue = monthlyRevenue(month, asOfMonth);
    const contractPool = revenue * CONTRACT_SHARE_OF_REVENUE;
    for (const c of DEMO_CUSTOMERS) {
      const rng = rngFor(`contract:${c.id}:${month}`);
      const amount = wholeDollars(contractPool * c.contractShare * (1 + between(rng, -0.02, 0.02)));
      const txnDate = `${month}-01`;
      drafts.push({
        kind: "contract",
        customerId: c.id,
        customerName: c.name,
        txnDate,
        dueDate: addDays(txnDate, c.termsDays),
        totalAmount: amount,
        lines: contractLines(c, month, amount),
      });
    }
    const projectPool = revenue * (1 - CONTRACT_SHARE_OF_REVENUE);
    const prng = rngFor(`projects:${month}`);
    const count = 7 + Math.floor(prng() * 4);
    const weights = Array.from({ length: count }, () => between(prng, 0.5, 1.5));
    const weightTotal = weights.reduce((a, b) => a + b, 0);
    const totalProjectWeight = DEMO_CUSTOMERS.reduce((a, c) => a + c.projectWeight, 0);
    weights.forEach((w, i) => {
      let pick = prng() * totalProjectWeight;
      let customer = DEMO_CUSTOMERS[0];
      for (const c of DEMO_CUSTOMERS) {
        pick -= c.projectWeight;
        if (pick <= 0) {
          customer = c;
          break;
        }
      }
      const amount = wholeDollars((projectPool * w) / weightTotal);
      const txnDate = clampDay(month, 3 + prng() * 24);
      const title = PROJECT_TYPES[Math.floor(prng() * PROJECT_TYPES.length)];
      drafts.push({
        kind: "project",
        customerId: customer.id,
        customerName: customer.name,
        txnDate,
        dueDate: addDays(txnDate, customer.termsDays),
        totalAmount: amount,
        lines: projectLines(title, amount, rngFor(`projectlines:${month}:${i}`)),
      });
    });
  }

  // Two specific problem invoices that give the demo realistic collection issues.
  const disputedDate = addDays(asOfDate, -128);
  drafts.push({
    kind: "project",
    customerId: "C-1008",
    customerName: "Ironwood Manufacturing",
    txnDate: disputedDate,
    dueDate: addDays(disputedDate, 30),
    totalAmount: 38_450,
    lines: projectLines("Emergency boiler replacement - Plant 2", 38_450, rngFor("special:ironwood")),
  });
  const westbrookDate = addDays(asOfDate, -121);
  drafts.push({
    kind: "project",
    customerId: "C-1014",
    customerName: "Westbrook Fitness Clubs",
    txnDate: westbrookDate,
    dueDate: addDays(westbrookDate, 30),
    totalAmount: 9_800,
    lines: projectLines("Locker room HVAC exhaust upgrade", 9_800, rngFor("special:westbrook")),
  });

  drafts.sort((a, b) => (a.txnDate === b.txnDate ? a.customerId.localeCompare(b.customerId) : a.txnDate < b.txnDate ? -1 : 1));

  const invoices: WorkingInvoice[] = drafts
    .filter((d) => d.txnDate <= asOfDate)
    .map((d, i) => {
      const docNumber = String(10001 + i);
      const customer = customerById.get(d.customerId)!;
      let schedule: ScheduledPayment[];
      if (d.txnDate === disputedDate && d.customerId === "C-1008" && d.totalAmount === 38_450) {
        schedule = []; // disputed: no payment received
      } else if (d.txnDate === westbrookDate && d.customerId === "C-1014" && d.totalAmount === 9_800) {
        schedule = [{ date: addDays(d.txnDate, 40), amount: 5_000 }]; // partial payment, remainder outstanding
      } else {
        schedule = paymentSchedule({ ...d, month: monthOf(d.txnDate) }, customer, asOfMonth, `${d.customerId}:${d.txnDate}:${i}`);
      }
      // Only payments that have happened by the as-of date are real.
      schedule = schedule.filter((p) => p.date <= asOfDate);
      const inv: WorkingInvoice = { ...d, id: `inv-${docNumber}`, docNumber, schedule, balance: 0 };
      inv.balance = balanceAsOf(inv, asOfDate);
      return inv;
    });

  // ---------------------------------------------------------------- bills
  const billDrafts: Omit<WorkingBill, "id" | "docNumber">[] = [];
  for (const month of allMonths) {
    const revenue = monthlyRevenue(month, asOfMonth);
    const t = monthIndexFrom(asOfMonth, month);
    const mm = Number(month.slice(5, 7));
    const categoryTotals: Record<string, number> = {
      "Materials & Supplies": revenue * 0.09 * (1 + between(rngFor(`mat:${month}`), -0.04, 0.04)),
      Subcontractors: revenue * (t === -1 ? 0.116 : t === 0 ? 0.1 : 0.08) * (1 + between(rngFor(`sub:${month}`), -0.04, 0.04)),
      "Professional Fees": 7_000 + (mm === 3 || mm === 4 ? 9_000 : 0) + (t === -1 || t === -2 ? 3_200 : 0),
      "Equipment Rental": revenue * 0.01,
    };
    for (const v of DEMO_VENDORS) {
      const vendorTotal = categoryTotals[v.category] * v.share;
      const perBill = wholeDollars(vendorTotal / v.billDays.length);
      v.billDays.forEach((day) => {
        const txnDate = clampDay(month, day);
        const rng = rngFor(`bill:${v.id}:${txnDate}`);
        const payDays = Math.max(5, Math.round(normalish(rng, v.avgDaysToPay, 2.5)));
        billDrafts.push({
          vendorId: v.id,
          vendorName: v.name,
          txnDate,
          dueDate: addDays(txnDate, v.termsDays),
          totalAmount: perBill,
          balance: 0,
          category: v.category,
          schedule: [{ date: addDays(txnDate, payDays), amount: perBill }],
        });
      });
    }
  }
  billDrafts.sort((a, b) => (a.txnDate === b.txnDate ? a.vendorId.localeCompare(b.vendorId) : a.txnDate < b.txnDate ? -1 : 1));
  // One bill held back by the business (unpaid and past due) for a realistic AP picture.
  const heldBackTarget = addDays(asOfDate, -42);
  let heldBackIndex = -1;
  let bestGap = Infinity;
  billDrafts.forEach((b, i) => {
    if (b.vendorId !== "V-2005") return;
    const gap = Math.abs(daysBetween(b.txnDate, heldBackTarget));
    if (gap < bestGap) {
      bestGap = gap;
      heldBackIndex = i;
    }
  });
  const bills: WorkingBill[] = billDrafts
    .map((b, i) => ({ ...b, schedule: i === heldBackIndex ? [] : b.schedule }))
    .filter((b) => b.txnDate <= asOfDate)
    .map((b, i) => {
      const docNumber = `B-${String(5001 + i)}`;
      const schedule = b.schedule.filter((p) => p.date <= asOfDate);
      const bill: WorkingBill = { ...b, id: `bill-${5001 + i}`, docNumber, schedule };
      bill.balance = balanceAsOf(bill, asOfDate);
      return bill;
    });

  // ---------------------------------------------------------------- monthly roll-forward
  const openingDate = addDays(monthStart(firstMonth), -1);
  const arAt = (date: string) => sum(invoices.map((inv) => balanceAsOf(inv, date)));
  const apAt = (date: string) => sum(bills.map((b) => balanceAsOf(b, date)));

  const openingAr = arAt(openingDate);
  const openingAp = apAt(openingDate);
  const openingAssets = OPENING.cash + openingAr + PREPAID_EXPENSES + OPENING.fixedAssetsGross + OPENING.accumulatedDepreciation;
  const openingLiabilities = openingAp + ACCRUED_PAYROLL + OPENING.loanBalance;
  const openingRetainedEarnings = roundCents(openingAssets - openingLiabilities - COMMON_STOCK);

  let cash = OPENING.cash;
  let ar = openingAr;
  let ap = openingAp;
  let fixedGross = OPENING.fixedAssetsGross;
  let accumDep = OPENING.accumulatedDepreciation;
  let loan = OPENING.loanBalance;
  let deferred = 0;
  let cumulativeCapex = 0;
  let retainedEarningsAtFyStart = openingRetainedEarnings;
  let ytdNetIncome = 0;
  let ytdDistributions = 0;
  const fyStartMonth = DEMO_COMPANY_PROFILE.fiscalYearStartMonth;

  const monthlyPnl: MonthlyPnl[] = [];
  const monthlyCashFlow: MonthlyCashFlow[] = [];
  const balanceSheets: BalanceSheetSnapshot[] = [];

  windowMonths.forEach((month, idx) => {
    const isPartial = month === asOfMonth && asOfDate < monthEnd(month);
    const endDate = month === asOfMonth ? asOfDate : monthEnd(month);
    const start = monthStart(month);
    const fraction = isPartial ? Number(asOfDate.slice(8, 10)) / daysInMonth(month) : 1;
    const t = monthIndexFrom(asOfMonth, month);
    const mm = Number(month.slice(5, 7));

    if (mm === fyStartMonth && idx > 0) {
      retainedEarningsAtFyStart = roundCents(retainedEarningsAtFyStart + ytdNetIncome - ytdDistributions);
      ytdNetIncome = 0;
      ytdDistributions = 0;
    }

    const inPeriod = (d: string) => d >= start && d <= endDate;
    const monthInvoices = invoices.filter((inv) => inPeriod(inv.txnDate));
    const contractRevenue = sum(monthInvoices.filter((i) => i.kind === "contract").map((i) => i.totalAmount));
    const projectRevenue = sum(monthInvoices.filter((i) => i.kind === "project").map((i) => i.totalAmount));
    const monthBills = bills.filter((b) => inPeriod(b.txnDate));
    const billsBy = (category: string) => sum(monthBills.filter((b) => b.category === category).map((b) => b.totalAmount));

    const revenueRun = monthlyRevenue(month, asOfMonth);
    const r = rngFor(`opex:${month}`);
    const yearsFromNow = Math.floor(-t / 12);
    const fieldLabor = roundCents(revenueRun * 0.425 * (1 + between(r, -0.012, 0.012)) * fraction);
    const adminSalaries = roundCents(52_000 * Math.pow(1.03, -yearsFromNow) * fraction);
    const payrollTaxes = roundCents((fieldLabor + adminSalaries) * 0.175);
    const rent = roundCents(18_500 * fraction);
    const insurance = roundCents((t >= -4 ? 16_900 : 13_800) * fraction);
    const vehicle = roundCents(revenueRun * (t >= -3 && t <= -1 ? 0.037 : t === 0 ? 0.036 : 0.031) * (1 + between(r, -0.03, 0.03)) * fraction);
    const software = roundCents(6_200 * fraction);
    const marketing = roundCents(4_500 * (1 + between(r, -0.15, 0.15)) * fraction);
    const utilities = roundCents(3_800 * (mm === 12 || mm === 1 || mm === 2 || mm === 7 || mm === 8 ? 1.18 : 1) * fraction);
    const depreciation = roundCents((11_400 + cumulativeCapex / 60) * fraction);
    const interest = roundCents(((loan * LOAN_RATE) / 12) * fraction);

    const capex = isPartial ? 0 : (idx % 5 === 2 ? 54_000 : 0) + (idx % 3 === 1 ? 16_500 : 0);
    const principal = isPartial ? 0 : Math.min(loan, LOAN_PRINCIPAL_PER_MONTH);
    const distribution = !isPartial && mm % 3 === 0 ? QUARTERLY_DISTRIBUTION : 0;

    // Contract invoices are billed on the 1st for the whole month. Revenue is earned
    // ratably, so in an incomplete month the unearned part is carried as deferred revenue.
    const contractRevenueEarned = isPartial ? roundCents(contractRevenue * fraction) : contractRevenue;
    const deferredRevenue = roundCents(contractRevenue - contractRevenueEarned);

    const lines: PnlLine[] = [
      { account: "Contract Services Revenue", category: "income", amount: contractRevenueEarned },
      { account: "Project & Repair Revenue", category: "income", amount: projectRevenue },
      { account: "Field Labor", category: "cogs", amount: fieldLabor },
      { account: "Materials & Supplies", category: "cogs", amount: billsBy("Materials & Supplies") },
      { account: "Subcontractors", category: "cogs", amount: billsBy("Subcontractors") },
      { account: "Office & Admin Salaries", category: "expense", amount: adminSalaries },
      { account: "Payroll Taxes & Benefits", category: "expense", amount: payrollTaxes },
      { account: "Rent & Occupancy", category: "expense", amount: rent },
      { account: "Insurance", category: "expense", amount: insurance },
      { account: "Vehicle & Fuel", category: "expense", amount: vehicle },
      { account: "Software & Technology", category: "expense", amount: software },
      { account: "Marketing & Advertising", category: "expense", amount: marketing },
      { account: "Utilities & Telecom", category: "expense", amount: utilities },
      { account: "Professional Fees", category: "expense", amount: billsBy("Professional Fees") },
      { account: "Equipment Rental", category: "expense", amount: billsBy("Equipment Rental") },
      { account: "Depreciation", category: "expense", amount: depreciation },
      { account: "Interest Expense", category: "otherExpense", amount: interest },
    ];
    const income = sum(lines.filter((l) => l.category === "income").map((l) => l.amount));
    const costs = sum(lines.filter((l) => l.category !== "income").map((l) => l.amount));
    const netIncome = roundCents(income - costs);
    monthlyPnl.push({ month, isPartial, endDate, lines });

    // Cash (direct method) for the period.
    const collections = sum(invoices.flatMap((inv) => inv.schedule.filter((p) => inPeriod(p.date)).map((p) => p.amount)));
    const billPayments = sum(bills.flatMap((b) => b.schedule.filter((p) => inPeriod(p.date)).map((p) => p.amount)));
    const directCash = sum([fieldLabor, adminSalaries, payrollTaxes, rent, insurance, vehicle, software, marketing, utilities]);
    const beginningCash = cash;
    cash = roundCents(cash + collections - billPayments - directCash - interest - capex - principal - distribution);

    const newAr = arAt(endDate);
    const newAp = apAt(endDate);
    const cfLines: CashFlowLine[] = [
      { section: "operating", label: "Net Income", amount: netIncome },
      { section: "operating", label: "Depreciation", amount: depreciation },
      { section: "operating", label: "(Increase) decrease in accounts receivable", amount: roundCents(-(newAr - ar)) },
      { section: "operating", label: "Increase (decrease) in accounts payable", amount: roundCents(newAp - ap) },
      { section: "operating", label: "Increase (decrease) in deferred revenue", amount: roundCents(deferredRevenue - deferred) },
      { section: "investing", label: "Purchase of vehicles and equipment", amount: -capex },
      { section: "financing", label: "Equipment loan principal payments", amount: -principal },
      { section: "financing", label: "Shareholder distributions", amount: -distribution },
    ];
    monthlyCashFlow.push({ month, isPartial, endDate, lines: cfLines, beginningCash, endingCash: cash });

    ar = newAr;
    ap = newAp;
    deferred = deferredRevenue;
    fixedGross += capex;
    cumulativeCapex += capex;
    accumDep = roundCents(accumDep - depreciation);
    loan = roundCents(loan - principal);
    ytdNetIncome = roundCents(ytdNetIncome + netIncome);
    ytdDistributions = roundCents(ytdDistributions + distribution);

    const operating = Math.max(0, roundCents(cash - RESERVE_ACCOUNT_BALANCE));
    const reserve = roundCents(cash - operating);
    const bsLines: BalanceSheetLine[] = [
      { section: "bank", account: "Operating Checking", amount: operating },
      { section: "bank", account: "Money Market Reserve", amount: reserve },
      { section: "accountsReceivable", account: "Accounts Receivable", amount: ar },
      { section: "otherCurrentAssets", account: "Prepaid Expenses", amount: PREPAID_EXPENSES },
      { section: "fixedAssets", account: "Vehicles & Equipment", amount: roundCents(fixedGross) },
      { section: "fixedAssets", account: "Accumulated Depreciation", amount: accumDep },
      { section: "accountsPayable", account: "Accounts Payable", amount: ap },
      { section: "otherCurrentLiabilities", account: "Accrued Payroll & Benefits", amount: ACCRUED_PAYROLL },
      { section: "otherCurrentLiabilities", account: "Deferred Revenue", amount: deferred },
      { section: "longTermLiabilities", account: "Equipment Loan", amount: loan },
      { section: "equity", account: "Common Stock", amount: COMMON_STOCK },
      { section: "equity", account: "Retained Earnings", amount: retainedEarningsAtFyStart },
      { section: "equity", account: "Shareholder Distributions", amount: -ytdDistributions },
      { section: "equity", account: "Net Income", amount: ytdNetIncome },
    ];
    balanceSheets.push({ date: endDate, lines: bsLines });
  });

  // ---------------------------------------------------------------- payments (grouped like real remittances)
  const paymentGroups = new Map<string, Payment>();
  for (const inv of invoices) {
    for (const p of inv.schedule) {
      const key = `${inv.customerId}|${p.date}`;
      let payment = paymentGroups.get(key);
      if (!payment) {
        payment = { id: "", customerId: inv.customerId, customerName: inv.customerName, txnDate: p.date, amount: 0, applied: [], unappliedAmount: 0 };
        paymentGroups.set(key, payment);
      }
      payment.amount = roundCents(payment.amount + p.amount);
      payment.applied.push({ invoiceId: inv.id, amount: p.amount });
    }
  }
  const payments = [...paymentGroups.values()]
    .sort((a, b) => (a.txnDate === b.txnDate ? a.customerId.localeCompare(b.customerId) : a.txnDate < b.txnDate ? -1 : 1))
    .map((p, i) => ({ ...p, id: `pmt-${7001 + i}` }));

  // ---------------------------------------------------------------- master data
  const latestBs = balanceSheets[balanceSheets.length - 1];
  const bsAmount = (account: string) => latestBs.lines.find((l) => l.account === account)?.amount ?? null;
  const customers: Customer[] = DEMO_CUSTOMERS.map((c) => ({
    id: c.id,
    name: c.name,
    email: c.email,
    active: true,
    reportedBalance: sum(invoices.filter((i) => i.customerId === c.id).map((i) => i.balance)),
  }));
  const vendors: Vendor[] = DEMO_VENDORS.map((v) => ({
    id: v.id,
    name: v.name,
    active: true,
    reportedBalance: sum(bills.filter((b) => b.vendorId === v.id).map((b) => b.balance)),
  }));
  const pnlAccount = (id: string, name: string, type: string, classification: "Revenue" | "Expense"): Account => ({
    id,
    name,
    type,
    subType: null,
    classification,
    currentBalance: null,
    active: true,
  });
  const accounts: Account[] = [
    { id: "a-100", name: "Operating Checking", type: "Bank", subType: "Checking", classification: "Asset", currentBalance: bsAmount("Operating Checking"), active: true },
    { id: "a-101", name: "Money Market Reserve", type: "Bank", subType: "MoneyMarket", classification: "Asset", currentBalance: bsAmount("Money Market Reserve"), active: true },
    { id: "a-120", name: "Accounts Receivable", type: "Accounts Receivable", subType: null, classification: "Asset", currentBalance: bsAmount("Accounts Receivable"), active: true },
    { id: "a-130", name: "Prepaid Expenses", type: "Other Current Asset", subType: "PrepaidExpenses", classification: "Asset", currentBalance: PREPAID_EXPENSES, active: true },
    { id: "a-150", name: "Vehicles & Equipment", type: "Fixed Asset", subType: "Vehicles", classification: "Asset", currentBalance: bsAmount("Vehicles & Equipment"), active: true },
    { id: "a-151", name: "Accumulated Depreciation", type: "Fixed Asset", subType: "AccumulatedDepreciation", classification: "Asset", currentBalance: bsAmount("Accumulated Depreciation"), active: true },
    { id: "a-200", name: "Accounts Payable", type: "Accounts Payable", subType: null, classification: "Liability", currentBalance: bsAmount("Accounts Payable"), active: true },
    { id: "a-210", name: "Accrued Payroll & Benefits", type: "Other Current Liability", subType: null, classification: "Liability", currentBalance: ACCRUED_PAYROLL, active: true },
    { id: "a-220", name: "Deferred Revenue", type: "Other Current Liability", subType: null, classification: "Liability", currentBalance: bsAmount("Deferred Revenue"), active: true },
    { id: "a-250", name: "Equipment Loan", type: "Long Term Liability", subType: "NotesPayable", classification: "Liability", currentBalance: bsAmount("Equipment Loan"), active: true },
    { id: "a-300", name: "Common Stock", type: "Equity", subType: null, classification: "Equity", currentBalance: COMMON_STOCK, active: true },
    { id: "a-310", name: "Retained Earnings", type: "Equity", subType: null, classification: "Equity", currentBalance: bsAmount("Retained Earnings"), active: true },
    pnlAccount("a-400", "Contract Services Revenue", "Income", "Revenue"),
    pnlAccount("a-410", "Project & Repair Revenue", "Income", "Revenue"),
    pnlAccount("a-500", "Field Labor", "Cost of Goods Sold", "Expense"),
    pnlAccount("a-510", "Materials & Supplies", "Cost of Goods Sold", "Expense"),
    pnlAccount("a-520", "Subcontractors", "Cost of Goods Sold", "Expense"),
    pnlAccount("a-600", "Office & Admin Salaries", "Expense", "Expense"),
    pnlAccount("a-610", "Payroll Taxes & Benefits", "Expense", "Expense"),
    pnlAccount("a-620", "Rent & Occupancy", "Expense", "Expense"),
    pnlAccount("a-630", "Insurance", "Expense", "Expense"),
    pnlAccount("a-640", "Vehicle & Fuel", "Expense", "Expense"),
    pnlAccount("a-650", "Software & Technology", "Expense", "Expense"),
    pnlAccount("a-660", "Marketing & Advertising", "Expense", "Expense"),
    pnlAccount("a-670", "Utilities & Telecom", "Expense", "Expense"),
    pnlAccount("a-680", "Professional Fees", "Expense", "Expense"),
    pnlAccount("a-690", "Equipment Rental", "Expense", "Expense"),
    pnlAccount("a-700", "Depreciation", "Expense", "Expense"),
    pnlAccount("a-800", "Interest Expense", "Other Expense", "Expense"),
  ];

  // Payroll register assumption (fictional): average of the last three closed months.
  const closed = monthlyPnl.filter((m) => !m.isPartial).slice(-3);
  const payrollPerMonth =
    closed.length > 0
      ? sum(
          closed.flatMap((m) =>
            m.lines.filter((l) => ["Field Labor", "Office & Admin Salaries", "Payroll Taxes & Benefits"].includes(l.account)).map((l) => l.amount),
          ),
        ) / closed.length
      : null;

  const toPublicInvoice = ({ kind: _kind, schedule: _schedule, ...rest }: WorkingInvoice): Invoice => rest;
  const toPublicBill = ({ schedule: _schedule, ...rest }: WorkingBill): Bill => rest;

  return {
    source: "demo",
    company: { ...DEMO_COMPANY_PROFILE, realmId: null },
    asOfDate,
    syncedAt: options.generatedAt ?? new Date().toISOString(),
    accounts,
    customers,
    vendors,
    invoices: invoices.map(toPublicInvoice),
    bills: bills.map(toPublicBill),
    payments,
    monthlyPnl,
    balanceSheets,
    monthlyCashFlow,
    sourceArAging: null,
    managementAssumptions: {
      weeklyPayroll: payrollPerMonth == null ? null : roundCents((payrollPerMonth * 12) / 52),
      weeklyPayrollSource: "Fictional demo payroll register: average of the last three closed months of field labor, admin salaries, payroll taxes and benefits",
      minimumCashBalance: MINIMUM_CASH_POLICY,
      notes: [
        "Minimum cash balance of $300,000 is a fictional owner policy used for forecast warnings.",
        "Contract invoices are issued on the 1st of each month for that month's services.",
      ],
    },
    coverage: {
      company: true,
      accounts: true,
      customers: true,
      invoices: true,
      bills: true,
      payments: true,
      profitAndLoss: true,
      balanceSheet: true,
      cashFlow: true,
      arAgingReport: false,
    },
    warnings: [],
  };
}
