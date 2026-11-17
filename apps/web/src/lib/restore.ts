import {
  type Dataset,
  formatRs,
  MATCH_WINDOW_MINUTES,
  minutesBetween,
  POSTING_LAG_MINUTES,
  trackingStart,
} from "@marqum/core";
import type { Recurring, Transaction } from "@marqum/schema";
import { useLiveQuery } from "dexie-react-hooks";
import { enqueue } from "./commands.ts";
import { tbl } from "./db.ts";
import { toast } from "./toast.ts";
import { lookup, txnTitle } from "./view.ts";

/** Bring back a deleted unverified row (as provisional). */
export async function restoreRow(t: Transaction): Promise<void> {
  await enqueue("restoreTransaction", {
    row: {
      id: t.id,
      account_id: t.account_id,
      occurred_at: t.occurred_at,
      amount: t.amount,
      flow: t.flow,
      source: t.source === "notification" ? "notification" : "manual",
      description: t.description,
      reason: t.reason,
      category_id: t.category_id,
      counterparty_id: t.counterparty_id,
      loan_id: t.loan_id,
      linked_txn_id: t.linked_txn_id,
      notification_id: t.notification_id,
      created_at: t.created_at,
    },
  });
  // the fixed charge that went with it (deleting an unverified row drops a charge made from it)
  const gone = await tbl("recurring")
    .filter((r) => r.deleted === true && r.source_txn_id === t.id)
    .toArray();
  for (const r of gone as Recurring[])
    await enqueue("upsertRecurring", {
      recurring_id: r.id,
      name: r.name,
      account_id: r.account_id,
      category_id: r.category_id,
      counterparty_id: r.counterparty_id,
      amount: r.amount,
      day_of_month: r.day_of_month,
      active: r.active,
      cadence: r.cadence,
      month_of_year: r.month_of_year,
      kind: r.kind,
      source_txn_id: t.id,
    });
}

/** Delete an unverified row, with an Undo in the toast. Nothing is lost either way: see `useDeleted`. */
export async function deleteUnverified(t: Transaction, ds: Dataset): Promise<void> {
  const charge = ds.recurring.find((r) => r.source_txn_id === t.id);
  if (t.status === "disputed") await enqueue("resolveDisputed", { txn_id: t.id, action: "delete" });
  else await enqueue("deleteProvisional", { txn_id: t.id });
  toast({
    tone: "neutral",
    title: `Deleted ${formatRs(Math.abs(t.amount))} · ${txnTitle(t, lookup(ds))}`,
    detail: charge
      ? `Its fixed charge ${charge.name} is gone too. Activity › Deleted keeps both if you change your mind.`
      : "Activity › Deleted keeps it if you change your mind.",
    action: { label: "Undo", run: () => void restoreRow(t) },
  });
}

/**
 * A statement row that is very likely this deleted row: same wallet and amount, posted from 36h before to 4 days
 * after it. Restoring would double-count it.
 */
export function verifiedTwin(ds: Dataset, t: Transaction): Transaction | undefined {
  return ds.transactions.find((v) => {
    if (v.deleted || v.status !== "verified" || v.account_id !== t.account_id || v.amount !== t.amount)
      return false;
    const lag = minutesBetween(t.occurred_at, v.occurred_at);
    return lag >= -MATCH_WINDOW_MINUTES && lag <= POSTING_LAG_MINUTES;
  });
}

export interface DeletedRow {
  txn: Transaction;
  /** the statement row it turned up as, if any (restoring is then pointless) */
  twin: Transaction | undefined;
}

/**
 * Unverified rows you deleted (notification or manual), newest first. The replica keeps deleted rows, so this is
 * the recycle bin. Rows from before tracking start are left out (a ledger reset removed those on purpose).
 */
export function useDeleted(ds: Dataset | undefined): DeletedRow[] {
  const rows = useLiveQuery(
    () =>
      tbl("transactions")
        .filter(
          (t) =>
            t.deleted === true &&
            t.status !== "verified" &&
            (t.source === "notification" || t.source === "manual"),
        )
        .toArray(),
    [],
    [] as Transaction[],
  );
  if (!ds) return [];
  const start = `${trackingStart(ds)}T00:00`;
  const live = new Set(ds.transactions.map((t) => t.id));
  return rows
    .filter((t) => t.occurred_at >= start && !live.has(t.id))
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
    .map((txn) => ({ txn, twin: verifiedTwin(ds, txn) }));
}
