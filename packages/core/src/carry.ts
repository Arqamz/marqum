/**
 * Carry entries: the system bookkeeping rows that open ("Balance brought forward", b/f) and close
 * ("Balance carried forward", c/f) each month of a wallet. Ids are deterministic so every device and the server
 * produce the same row. See docs/FORMULAS.md › Accounting model.
 */
import type { AccountId, Transaction } from "@marqum/schema";
import { addMonths, monthLabel, monthRange } from "./time.ts";

export type CarryKind = "bf" | "cf";

/** `carry:bf:<acct>:<YYYY-MM>` — used as both the row id and its external_id. */
export const carryId = (kind: CarryKind, account: AccountId, month: string): string =>
  `carry:${kind}:${account}:${month}`;

export const isCarry = (t: Pick<Transaction, "flow">): boolean => t.flow === "carry";
export const isCf = (t: Pick<Transaction, "flow" | "external_id">): boolean =>
  t.flow === "carry" && (t.external_id?.startsWith("carry:cf:") ?? false);
export const isBf = (t: Pick<Transaction, "flow" | "external_id">): boolean =>
  t.flow === "carry" && (t.external_id?.startsWith("carry:bf:") ?? false);

/** reason on a first-month b/f row recording where the opening balance came from */
export const OPENING_FROM_STATEMENT = "Opening balance from statement";
export const OPENING_SET_BY_YOU = "Opening balance set by you";

/** A b/f (opening, on the 1st at 00:00) or c/f (closing, last day 23:59) row. */
export function carryRow(
  kind: CarryKind,
  account: AccountId,
  month: string,
  amount: number,
  now: string,
  reason: string | null = null,
): Transaction {
  const id = carryId(kind, account, month);
  const { from, to } = monthRange(month);
  return {
    id,
    account_id: account,
    occurred_at: kind === "bf" ? `${from}T00:00` : `${to}T23:59`,
    amount,
    status: "verified",
    source: "system",
    flow: "carry",
    description:
      kind === "bf"
        ? `Balance brought forward from ${monthLabel(addMonths(month, -1))}`
        : `Balance carried forward to ${monthLabel(addMonths(month, 1))}`,
    bank_type: null,
    reason,
    counterparty_id: null,
    category_id: null,
    external_id: id,
    statement_id: null,
    loan_id: null,
    linked_txn_id: null,
    fee: 0,
    balance_after: null,
    notification_id: null,
    created_at: now,
    updated_at: now,
    version: 0,
    deleted: false,
  };
}
