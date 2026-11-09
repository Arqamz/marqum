import type { AccountId, Transaction } from "@marqum/schema";
import { minutesBetween } from "./time.ts";

/** Matching window either side of the statement row's time. */
export const MATCH_WINDOW_MINUTES = 36 * 60;
/** Second pass: the statement may charge up to 40% more than notified (foreign-card tax/fees added later). */
export const MAX_CORRECTION = 1.4;
/** Second pass: share of merchant words that must agree. */
export const MIN_TOKEN_OVERLAP = 0.5;

export interface StatementRowLike {
  external_id: string;
  account_id: AccountId;
  occurred_at: string;
  amount: number;
  /** optional; breaks ties in the exact pass and is required for the tolerant pass */
  description?: string;
}

export interface ProvisionalMatch {
  external_id: string;
  txn_id: string;
  /** true when matched by the tolerant pass: the statement amount differs from the provisional one */
  corrected?: true;
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
  "ONLINE",
  "YOU",
  "SPENT",
  "AT",
  "ON",
  "RS",
  "PKR",
]);

/** Upper-case merchant words: letters only (digits split words), length ≥ 2, no transfer jargon. */
export const merchantTokens = (s: string): Set<string> =>
  new Set(
    s
      .toUpperCase()
      .replace(/[^A-Z\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1 && !STOP.has(w)),
  );

const sameWord = (a: string, b: string) =>
  a === b || (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a)));

/** Shared words / words in the smaller set (0..1). Prefix matches count ("SPOTIFYP" ~ "SPOTIFY"). */
export function tokenOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let n = 0;
  for (const x of a)
    for (const y of b)
      if (sameWord(x, y)) {
        n++;
        break;
      }
  return n / Math.min(a.size, b.size);
}

const provisionalText = (t: Transaction, names: Record<string, string>) =>
  `${t.description} ${t.reason ?? ""} ${t.counterparty_id ? (names[t.counterparty_id] ?? "") : ""}`;

/**
 * Pair statement rows with provisional/disputed transactions, one-to-one, best match first.
 * 1. Exact: same wallet, same amount, |Δt| ≤ 36h (smallest |Δt|, then most shared words, then ids).
 * 2. Tolerant, for what's left: same wallet, both outflows, |Δt| ≤ 36h, merchant-word overlap ≥ 0.5 and
 *    |statement| within [|provisional|, |provisional| × 1.40] — notifications can omit tax/fees the bank adds.
 *    These pairs carry `corrected: true`.
 * `counterpartyNames` (id → name) adds the provisional row's counterparty name to its words.
 */
export function matchProvisional(
  rows: StatementRowLike[],
  provisional: Transaction[],
  counterpartyNames: Record<string, string> = {},
): ProvisionalMatch[] {
  const open = provisional.filter((t) => t.status !== "verified");
  const usedRows = new Set<string>();
  const usedTxns = new Set<string>();
  const out: ProvisionalMatch[] = [];
  const take = (
    cands: { r: StatementRowLike; t: Transaction; dt: number; sim: number }[],
    corrected: boolean,
  ) => {
    cands.sort(
      (a, b) =>
        a.dt - b.dt ||
        b.sim - a.sim ||
        a.r.external_id.localeCompare(b.r.external_id) ||
        a.t.id.localeCompare(b.t.id),
    );
    for (const c of cands) {
      if (usedRows.has(c.r.external_id) || usedTxns.has(c.t.id)) continue;
      usedRows.add(c.r.external_id);
      usedTxns.add(c.t.id);
      out.push(
        corrected
          ? { external_id: c.r.external_id, txn_id: c.t.id, corrected: true }
          : { external_id: c.r.external_id, txn_id: c.t.id },
      );
    }
  };
  const pairs = (exact: boolean) => {
    const cands: { r: StatementRowLike; t: Transaction; dt: number; sim: number }[] = [];
    for (const r of rows) {
      if (usedRows.has(r.external_id)) continue;
      const rw = merchantTokens(r.description ?? "");
      for (const t of open) {
        if (usedTxns.has(t.id) || t.account_id !== r.account_id) continue;
        const dt = Math.abs(minutesBetween(r.occurred_at, t.occurred_at));
        if (dt > MATCH_WINDOW_MINUTES) continue;
        const sim = tokenOverlap(rw, merchantTokens(provisionalText(t, counterpartyNames)));
        if (exact) {
          if (t.amount !== r.amount) continue;
        } else {
          if (r.amount >= 0 || t.amount >= 0) continue;
          if (-r.amount < -t.amount || -r.amount > -t.amount * MAX_CORRECTION) continue;
          if (sim < MIN_TOKEN_OVERLAP) continue;
        }
        cands.push({ r, t, dt, sim });
      }
    }
    return cands;
  };
  take(pairs(true), false);
  take(pairs(false), true);
  return out;
}
