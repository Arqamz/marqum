/** Time helpers. All values are Asia/Karachi local strings (UTC+5, no DST): `YYYY-MM-DDTHH:mm`, `YYYY-MM-DD`, `YYYY-MM`. */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number, w = 2): string => String(n).padStart(w, "0");

/** Current Karachi local time, `YYYY-MM-DDTHH:mm`. */
export function karachiNow(): string {
  return new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 16);
}

/** `YYYY-MM` of a date or datetime. */
export const monthOf = (dt: string): string => dt.slice(0, 7);

/** `YYYY-MM-DD` of a datetime. */
export const dateOf = (dt: string): string => dt.slice(0, 10);

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + n;
  return `${pad(Math.floor(idx / 12), 4)}-${pad((idx % 12) + 1)}`;
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** First and last day of a month, `YYYY-MM-DD`. */
export function monthRange(month: string): { from: string; to: string } {
  return { from: `${month}-01`, to: `${month}-${pad(daysInMonth(month))}` };
}

/** The `n` complete months immediately before `month`, oldest → newest. */
export function completeMonthsBefore(month: string, n: number): string[] {
  const out: string[] = [];
  for (let i = n; i >= 1; i--) out.push(addMonths(month, -i));
  return out;
}

/** Months from `from` to `to` inclusive (empty if from > to). */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
}

/** "7 Nov" */
export function dayLabel(date: string): string {
  const m = Number(date.slice(5, 7));
  return `${Number(date.slice(8, 10))} ${MONTHS[m - 1]}`;
}

/** "Nov 2026" */
export function monthLabel(month: string): string {
  return `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}

const toMs = (dt: string): number => Date.parse(dt.length === 10 ? `${dt}T00:00:00Z` : `${dt}:00Z`);

/** Minutes from a to b (b − a). */
export const minutesBetween = (a: string, b: string): number => Math.round((toMs(b) - toMs(a)) / 60_000);

/** Days from date a to date b (b − a), whole days. */
export const daysBetween = (a: string, b: string): number =>
  Math.round((toMs(dateOf(b)) - toMs(dateOf(a))) / 86_400_000);

export function addDays(date: string, n: number): string {
  return new Date(toMs(dateOf(date)) + n * 86_400_000).toISOString().slice(0, 10);
}

/** 0 = Monday … 6 = Sunday */
export function weekdayIndex(date: string): number {
  return (new Date(toMs(dateOf(date))).getUTCDay() + 6) % 7;
}
