import { type Dataset, daysInMonth, monthOf, monthRange } from "@marqum/core";

const LONG = [
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
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "November" */
export const monthName = (m: string): string => LONG[Number(m.slice(5, 7)) - 1] ?? m;
/** "Nov" */
export const monthShort = (m: string): string => SHORT[Number(m.slice(5, 7)) - 1] ?? m;

/** Accounts whose statements don't yet reach the end of `month` (or `upTo`, if earlier). */
export function missingStatements(ds: Dataset, month: string, upTo?: string): string[] {
  const end = upTo && upTo < monthRange(month).to ? upTo : monthRange(month).to;
  return ds.accounts
    .filter((a) => {
      const last = ds.statements
        .filter((s) => s.account_id === a.id)
        .reduce<string | null>((max, s) => (max === null || s.period_to > max ? s.period_to : max), null);
      return last === null || last < end;
    })
    .map((a) => a.name);
}

/** Spend rows in a month that still have no category. */
export function untaggedIn(ds: Dataset, month: string) {
  return ds.transactions.filter(
    (t) =>
      monthOf(t.occurred_at) === month && (t.flow === "spend" || t.flow === "fee") && t.category_id === null,
  );
}

export function dayOfMonth(now: string): number {
  return Number(now.slice(8, 10));
}

export const isLastDay = (now: string): boolean => dayOfMonth(now) === daysInMonth(monthOf(now));
