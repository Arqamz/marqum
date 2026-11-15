import { type Dataset, type RecurringCandidate, setting } from "@marqum/core";
import { enqueue } from "./commands.ts";

/** "Looks recurring" suggestions you dismissed (setting `recurring_dismissed`). */
export function dismissedSuggestions(ds: Dataset): Set<string> {
  try {
    const v: unknown = JSON.parse(setting(ds, "recurring_dismissed") || "[]");
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

export const suggestionKey = (c: Pick<RecurringCandidate, "account_id" | "key">) =>
  `${c.account_id}:${c.key}`;
export const counterpartyKey = (id: string) => `cp:${id}`;

export function isDismissed(set: Set<string>, c: RecurringCandidate): boolean {
  return (
    set.has(suggestionKey(c)) || (c.counterparty_id !== null && set.has(counterpartyKey(c.counterparty_id)))
  );
}

/** Add or remove keys from the dismissed list. */
export async function setDismissed(ds: Dataset, add: string[], remove: string[] = []): Promise<void> {
  const next = dismissedSuggestions(ds);
  for (const k of add) next.add(k);
  for (const k of remove) next.delete(k);
  await enqueue("setSetting", { key: "recurring_dismissed", value: JSON.stringify([...next].sort()) });
}
