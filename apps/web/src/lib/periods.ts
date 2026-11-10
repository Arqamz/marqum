import { addMonths, monthLabel, monthsBetween } from "@marqum/core";
import { monthShort } from "./months.ts";

/** How much time a category view covers: one month, or a window of 6 / 12 months ending at the anchor month. */
export type PeriodMode = "month" | "6m" | "year";

export const periodLength = (mode: PeriodMode): number => (mode === "month" ? 1 : mode === "6m" ? 6 : 12);

/** Months of the period that ends at `anchor`, oldest first. */
export const periodMonths = (mode: PeriodMode, anchor: string): string[] =>
  monthsBetween(addMonths(anchor, 1 - periodLength(mode)), anchor);

/** "Oct 2026", "Jun – Nov 2026", "Dec 2025 – Nov 2026". */
export function periodLabel(mode: PeriodMode, anchor: string): string {
  if (mode === "month") return monthLabel(anchor);
  const from = addMonths(anchor, 1 - periodLength(mode));
  return from.slice(0, 4) === anchor.slice(0, 4)
    ? `${monthShort(from)} – ${monthShort(anchor)} ${anchor.slice(0, 4)}`
    : `${monthShort(from)} ${from.slice(0, 4)} – ${monthShort(anchor)} ${anchor.slice(0, 4)}`;
}

/**
 * Neighbouring periods of the same mode, or null at the edges. Never past `current`; never a period that ends
 * before `first` (the first browsable month). A step forward that would overshoot snaps to `current`.
 */
export function periodNeighbours(
  mode: PeriodMode,
  anchor: string,
  first: string,
  current: string,
): { prev: string | null; next: string | null } {
  const n = periodLength(mode);
  const back = addMonths(anchor, -n);
  const fwd = addMonths(anchor, n);
  return {
    prev: back >= first ? back : null,
    next: anchor >= current ? null : fwd > current ? current : fwd,
  };
}
