import type { Dataset } from "@marqum/core";
import type { Recurring } from "@marqum/schema";

export type RecurringKind = Recurring["kind"];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthOfYearLabel = (m: number | null): string => (m ? (MONTHS[m - 1] ?? "") : "");

/** subscription if the category sits under Subscriptions, bill under Bills, else other. */
export function kindFor(ds: Dataset, categoryId: string | null): RecurringKind {
  if (!categoryId) return "other";
  const c = ds.categories.find((x) => x.id === categoryId);
  const top = c?.parent_id ?? c?.id ?? categoryId;
  if (top === "subscriptions") return "subscription";
  if (top === "bills") return "bill";
  return "other";
}

/** "Monthly" / "Yearly · Mar" */
export function cadenceLabel(r: Pick<Recurring, "cadence" | "month_of_year">): string {
  return r.cadence === "yearly" ? `Yearly · ${monthOfYearLabel(r.month_of_year)}` : "Monthly";
}

/** What it costs per month on average (yearly charges spread over 12 months). */
export const monthlyEquivalent = (r: Pick<Recurring, "cadence" | "amount">): number =>
  r.cadence === "yearly" ? Math.round(r.amount / 12) : r.amount;

export const KIND_LABEL: Record<RecurringKind, string> = {
  subscription: "Subscriptions",
  bill: "Bills",
  other: "Other",
};
