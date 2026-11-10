import { type Dataset, dayLabel, karachiNow } from "@marqum/core";
import type { Category, Counterparty, Flow, Transaction } from "@marqum/schema";

export interface Lookup {
  category: Map<string, Category>;
  counterparty: Map<string, Counterparty>;
  account: Map<string, string>;
}

export function lookup(ds: Dataset): Lookup {
  return {
    category: new Map(ds.categories.map((c) => [c.id, c])),
    counterparty: new Map(ds.counterparties.map((c) => [c.id, c])),
    account: new Map(ds.accounts.map((a) => [a.id, a.name])),
  };
}

/** What a row is called in lists: who it was with, else why, else what the bank said. */
export function txnTitle(t: Transaction, l: Lookup): string {
  const cp = t.counterparty_id ? l.counterparty.get(t.counterparty_id)?.name : undefined;
  return cp ?? t.reason ?? (t.description || t.bank_type || "Transaction");
}

/** "Food › Friends" */
export function categoryPath(id: string | null, l: Lookup): string | null {
  if (!id) return null;
  const c = l.category.get(id);
  if (!c) return null;
  const parent = c.parent_id ? l.category.get(c.parent_id) : undefined;
  return parent ? `${parent.name} › ${c.name}` : c.name;
}

export function topCategoryOf(id: string | null, l: Lookup): Category | undefined {
  if (!id) return undefined;
  const c = l.category.get(id);
  if (!c) return undefined;
  return c.parent_id ? (l.category.get(c.parent_id) ?? c) : c;
}

export const FLOW_LABEL: Record<Flow, string> = {
  spend: "Spending",
  fee: "Fee",
  funding: "Income from Meezan",
  internal: "Between wallets",
  income: "Money from others",
  loan_in: "Loan received",
  loan_repay: "Loan repayment",
  reimbursement: "Paid back to me",
  carry: "Brought or carried forward",
};

export const OUT_FLOWS: Flow[] = ["spend", "internal", "loan_repay", "fee"];
export const IN_FLOWS: Flow[] = ["funding", "internal", "income", "reimbursement", "loan_in"];

export const needsTag = (t: Transaction): boolean =>
  (t.flow === "spend" || t.flow === "fee") && t.category_id === null;

/** "Today", "Yesterday", "Mon 3 Nov" */
export function dayHeading(date: string, now = karachiNow()): string {
  const today = now.slice(0, 10);
  if (date === today) return "Today";
  const y = new Date(`${today}T00:00:00Z`);
  y.setUTCDate(y.getUTCDate() - 1);
  if (date === y.toISOString().slice(0, 10)) return "Yesterday";
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(`${date}T00:00:00Z`).getUTCDay()];
  return `${wd} ${dayLabel(date)}`;
}

export const timeOf = (dt: string): string => dt.slice(11, 16);

/** Escape text for use as a literal inside a rule regex. */
export const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function visibleTopCategories(ds: Dataset): Category[] {
  const used = new Set(ds.transactions.map((t) => t.category_id).filter(Boolean));
  const tops = ds.categories.filter((c) => c.parent_id === null);
  return tops
    .filter(
      (c) => !c.hidden || used.has(c.id) || ds.categories.some((s) => s.parent_id === c.id && used.has(s.id)),
    )
    .sort((a, b) => a.sort - b.sort);
}

export function childrenOf(ds: Dataset, parentId: string): Category[] {
  return ds.categories.filter((c) => c.parent_id === parentId).sort((a, b) => a.sort - b.sort);
}
