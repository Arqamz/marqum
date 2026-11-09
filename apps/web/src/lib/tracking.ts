import { addMonths, type Dataset, monthOf, setting } from "@marqum/core";

/** First tracked day (`YYYY-MM-DD`). Nothing before it exists for the ledger, the close or reminders. */
export function trackingStart(ds: Dataset): string {
  return setting(ds, "tracking_start") || "2026-11-01";
}

export function firstTrackedMonth(ds: Dataset): string {
  return monthOf(trackingStart(ds));
}

export function isTracked(ds: Dataset, month: string): boolean {
  return month >= firstTrackedMonth(ds);
}

/** Tracked months up to and including the current one, oldest first. */
export function trackedMonthsUpTo(ds: Dataset, now: string): string[] {
  const out: string[] = [];
  for (let m = firstTrackedMonth(ds); m <= monthOf(now) && out.length < 120; m = addMonths(m, 1)) out.push(m);
  return out;
}

/** "Test run until 31 Dec 2026 — v1.0 starts 1 Jan 2027" while tracking started before 2027. */
export function testRunNote(ds: Dataset): string | null {
  return trackingStart(ds) < "2027-01-01" ? "Test run until 31 Dec 2026 — v1.0 starts 1 Jan 2027" : null;
}
