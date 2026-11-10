import type { Dataset } from "@marqum/core";
import type { AccountId, Recurring } from "@marqum/schema";

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

/** Common subscriptions, one tap to add. `kind` is the Subscriptions subcategory, not the service. */
export interface SubscriptionPreset {
  name: string;
  match: RegExp;
  sub: "enjoyment" | "professional" | "essentials";
  cadence: Recurring["cadence"];
}

export const SUBSCRIPTION_PRESETS: SubscriptionPreset[] = [
  { name: "Spotify Premium", match: /spotify/i, sub: "enjoyment", cadence: "monthly" },
  { name: "Netflix", match: /netflix/i, sub: "enjoyment", cadence: "monthly" },
  { name: "YouTube Premium", match: /youtube/i, sub: "enjoyment", cadence: "monthly" },
  { name: "Foodpanda Pro", match: /panda ?pro|food ?panda pro/i, sub: "enjoyment", cadence: "monthly" },
  { name: "iCloud+", match: /icloud|apple\.com\/bill/i, sub: "essentials", cadence: "monthly" },
  { name: "Google One", match: /google ?one|google storage/i, sub: "essentials", cadence: "monthly" },
  {
    name: "VPS",
    match: /hetzner|digitalocean|vultr|linode|contabo|\bvps\b/i,
    sub: "professional",
    cadence: "monthly",
  },
  { name: "Domain", match: /namecheap|godaddy|porkbun|domain/i, sub: "professional", cadence: "yearly" },
];

export interface PresetFill {
  name: string;
  category_id: string;
  cadence: Recurring["cadence"];
  /** from the most recent matching charge, when there is one */
  amount?: number;
  day_of_month?: number;
  month_of_year?: number;
  account_id?: AccountId;
  counterparty_id?: string | null;
}

/** A preset filled in from your most recent charge that matches it (amount, day, wallet, merchant). */
export function fillPreset(ds: Dataset, p: SubscriptionPreset): PresetFill {
  const sub = `subscriptions.${p.sub}`;
  const category_id = ds.categories.some((c) => c.id === sub && !c.deleted) ? sub : "subscriptions";
  const names = new Map(ds.counterparties.map((c) => [c.id, c.name]));
  const last = ds.transactions
    .filter((t) => !t.deleted && t.amount < 0 && (t.flow === "spend" || t.flow === "fee"))
    .filter((t) =>
      p.match.test(
        `${t.description} ${t.reason ?? ""} ${t.counterparty_id ? names.get(t.counterparty_id) : ""}`,
      ),
    )
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))[0];
  if (!last) return { name: p.name, category_id, cadence: p.cadence };
  return {
    name: p.name,
    category_id,
    cadence: p.cadence,
    amount: -last.amount,
    day_of_month: Number(last.occurred_at.slice(8, 10)),
    month_of_year: Number(last.occurred_at.slice(5, 7)),
    account_id: last.account_id,
    counterparty_id: last.counterparty_id,
  };
}

/** Your active subscriptions, for picking one when tagging a charge. */
export const activeSubscriptions = (ds: Dataset): Recurring[] =>
  ds.recurring
    .filter((r) => !r.deleted && r.active && r.kind === "subscription")
    .sort((a, b) => a.name.localeCompare(b.name));
