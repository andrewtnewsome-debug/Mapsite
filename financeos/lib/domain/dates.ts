/**
 * Calendar-date helpers that operate on ISO "YYYY-MM-DD" strings.
 *
 * All arithmetic is done in UTC so results never shift with the computer's
 * time zone or daylight-saving changes (a common source of off-by-one errors
 * in aging calculations).
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

export function parseIsoDate(value: string): Date {
  if (!isIsoDate(value)) throw new Error(`Invalid ISO date: ${value}`);
  const [y, m, d] = value.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function toIsoDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Today's date in the local time zone of the machine running FinanceOS. */
export function todayLocalIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(iso: string, days: number): string {
  const d = parseIsoDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toIsoDate(d);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: string, to: string): number {
  return Math.round((parseIsoDate(to).getTime() - parseIsoDate(from).getTime()) / MS_PER_DAY);
}

export function compareIso(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function minIso(a: string, b: string): string {
  return a <= b ? a : b;
}

export function maxIso(a: string, b: string): string {
  return a >= b ? a : b;
}

/** "YYYY-MM" for a date. */
export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

export function isMonthKey(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function monthStart(month: string): string {
  return `${month}-01`;
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function monthEnd(month: string): string {
  return `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;
}

export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const total = y * 12 + (m - 1) + delta;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

/** Inclusive list of months from `start` to `end`. */
export function monthRange(start: string, end: string): string[] {
  const out: string[] = [];
  let cur = start;
  let guard = 0;
  while (cur <= end && guard < 1200) {
    out.push(cur);
    cur = addMonths(cur, 1);
    guard += 1;
  }
  return out;
}

/** Add months to a calendar date, clamping to the end of shorter months (Jan 31 + 1 month = Feb 28/29). */
export function addMonthsToDate(iso: string, delta: number): string {
  const day = Number(iso.slice(8, 10));
  const month = addMonths(monthOf(iso), delta);
  const clamped = Math.min(day, daysInMonth(month));
  return `${month}-${String(clamped).padStart(2, "0")}`;
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function monthLabel(month: string, style: "short" | "long" = "short"): string {
  const [y, m] = month.split("-").map(Number);
  return `${(style === "short" ? MONTH_SHORT : MONTH_LONG)[m - 1]} ${y}`;
}

export function monthNameToNumber(name: string): number | null {
  const n = name.trim().toLowerCase();
  const idx = MONTH_LONG.findIndex((m) => m.toLowerCase() === n || m.slice(0, 3).toLowerCase() === n.slice(0, 3));
  return idx >= 0 ? idx + 1 : null;
}

export function formatIsoDate(iso: string | null | undefined, style: "short" | "long" = "short"): string {
  if (!iso || !isIsoDate(iso)) return "Not available";
  const [y, m, d] = iso.split("-").map(Number);
  if (style === "long") return `${MONTH_LONG[m - 1]} ${d}, ${y}`;
  return `${MONTH_SHORT[m - 1]} ${d}, ${y}`;
}
