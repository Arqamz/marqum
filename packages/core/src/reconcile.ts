import type { AccountId, Transaction } from "@marqum/schema";
import { minutesBetween } from "./time.ts";

/** Matching window either side of the statement row's time. */
export const MATCH_WINDOW_MINUTES = 36 * 60;

export interface StatementRowLike {
  external_id: string;
  account_id: AccountId;
  occurred_at: string;
  amount: number;
  /** optional, used only to break ties */
  description?: string;
}

const STOP = new Set([
  "TO",
  "FROM",
  "FUND",
  "TRANSFER",
  "OUTGOING",
  "INCOMING",
  "PAYMENT",
  "PURCHASE",
  "POS",
  "CARD",
]);
const words = (s: string): Set<string> =>
  new Set(
    s
      .toUpperCase()
      .replace(/[^A-Z\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1 && !STOP.has(w)),
  );

function similarity(row: StatementRowLike, t: Transaction): number {
  if (!row.description) return 0;
  const a = words(row.description);
  const b = words(`${t.description} ${t.reason ?? ""}`);
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n;
}

/**
 * Pair statement rows with provisional/disputed transactions: same wallet, same amount, |Δt| ≤ 36h,
 * one-to-one, best match first (smallest |Δt|, then most shared description words, then ids for determinism).
 */
export function matchProvisional(
  rows: StatementRowLike[],
  provisional: Transaction[],
): { external_id: string; txn_id: string }[] {
  const cands: { r: StatementRowLike; t: Transaction; dt: number; sim: number }[] = [];
  for (const r of rows) {
    for (const t of provisional) {
      if (t.status === "verified" || t.account_id !== r.account_id || t.amount !== r.amount) continue;
      const dt = Math.abs(minutesBetween(r.occurred_at, t.occurred_at));
      if (dt > MATCH_WINDOW_MINUTES) continue;
      cands.push({ r, t, dt, sim: similarity(r, t) });
    }
  }
  cands.sort(
    (a, b) =>
      a.dt - b.dt ||
      b.sim - a.sim ||
      a.r.external_id.localeCompare(b.r.external_id) ||
      a.t.id.localeCompare(b.t.id),
  );
  const usedRows = new Set<string>();
  const usedTxns = new Set<string>();
  const out: { external_id: string; txn_id: string }[] = [];
  for (const c of cands) {
    if (usedRows.has(c.r.external_id) || usedTxns.has(c.t.id)) continue;
    usedRows.add(c.r.external_id);
    usedTxns.add(c.t.id);
    out.push({ external_id: c.r.external_id, txn_id: c.t.id });
  }
  return out;
}
