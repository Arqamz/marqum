/** Synthetic data builders for tests. No real data: names/amounts are invented. */
import type {
  AccountId,
  BalanceEntry,
  Command,
  Counterparty,
  Goal,
  GoalMove,
  Loan,
  ParsedStatement,
  ParsedStatementRow,
  Recurring,
  Statement,
  Transaction,
} from "@marqum/schema";
import { carryRow } from "../src/carry.ts";
import { applyMutations, emptyDataset, seedMutations } from "../src/dataset.ts";
import type { Dataset, ExecContext, Mutation } from "../src/types.ts";

let seq = 0;
export const nextId = (prefix = "t"): string => `${prefix}${String(++seq).padStart(5, "0")}`;

export const NOW = "2026-11-15T12:00";

/**
 * Seeded dataset tracking from `start` (default Jan 2026 so historic fixtures count), with the first month's
 * b/f rows at 0 (unknown opening).
 */
export function seeded(start = "2026-01-01"): Dataset {
  const seed = seedMutations(NOW).filter((m) => !(m.table === "transactions"));
  const ds = applyMutations(emptyDataset(), [
    ...seed,
    { table: "settings", row: { id: "tracking_start", value: start, version: 1, deleted: false } },
    ...(["sadapay", "nayapay"] as const).map((a) => ({
      table: "transactions" as const,
      row: carryRow("bf", a, start.slice(0, 7), 0, NOW),
    })),
  ]);
  return ds;
}

export function ctx(now = NOW, steppedUp = false): ExecContext {
  return { now, steppedUp, newId: () => nextId("new") };
}

export function cmd<N extends Command["name"]>(
  name: N,
  args: Extract<Command, { name: N }>["args"],
): Command {
  return { id: nextId("c"), name, at: NOW, args } as Command;
}

export function txn(p: Partial<Transaction> & { occurred_at: string; amount: number }): Transaction {
  return {
    id: nextId(),
    account_id: "nayapay",
    status: "verified",
    source: "statement",
    flow: p.amount < 0 ? "spend" : "income",
    description: "",
    bank_type: null,
    reason: null,
    counterparty_id: null,
    category_id: null,
    external_id: null,
    statement_id: null,
    loan_id: null,
    linked_txn_id: null,
    fee: 0,
    balance_after: null,
    notification_id: null,
    created_at: NOW,
    updated_at: NOW,
    version: 1,
    deleted: false,
    ...p,
  };
}

export const prov = (p: Partial<Transaction> & { occurred_at: string; amount: number }): Transaction =>
  txn({ status: "provisional", source: "manual", ...p });

export function stmt(
  account_id: AccountId,
  period_from: string,
  period_to: string,
  p: Partial<Statement> = {},
): Statement {
  return {
    id: nextId("s"),
    account_id,
    period_from,
    period_to,
    file_name: "synthetic.pdf",
    file_sha256: "0".repeat(64),
    opening: null,
    closing: null,
    total_in: 0,
    total_out: 0,
    row_count: 0,
    checks: [{ ok: true, label: "Totals match" }],
    imported_at: NOW,
    version: 1,
    deleted: false,
    ...p,
  };
}

export function bal(
  account_id: AccountId,
  as_of: string,
  balance: number,
  p: Partial<BalanceEntry> = {},
): BalanceEntry {
  return {
    id: nextId("b"),
    account_id,
    as_of,
    balance,
    source: "manual",
    statement_id: null,
    version: 1,
    deleted: false,
    ...p,
  };
}

export function cp(name: string, p: Partial<Counterparty> = {}): Counterparty {
  return {
    id: nextId("cp"),
    name,
    kind: "person",
    aliases: [name.toUpperCase()],
    default_category_id: null,
    default_flow: null,
    version: 1,
    deleted: false,
    ...p,
  };
}

export function recurring(name: string, amount: number, p: Partial<Recurring> = {}): Recurring {
  return {
    id: nextId("r"),
    name,
    account_id: "sadapay",
    category_id: null,
    counterparty_id: null,
    amount,
    day_of_month: 1,
    active: true,
    detected: false,
    version: 1,
    deleted: false,
    ...p,
  };
}

export function loan(p: Partial<Loan> & { principal: number; installment: number }): Loan {
  return {
    id: nextId("l"),
    lender: "Mom",
    counterparty_id: null,
    started_on: "2026-07-10",
    purpose: "Bicycle",
    note: null,
    manual_repaid: 0,
    closed_on: null,
    version: 1,
    deleted: false,
    ...p,
  };
}

export function goal(p: Partial<Goal> & { target: number; monthly: number }): Goal {
  return {
    id: nextId("g"),
    name: "Laptop",
    icon: "laptop",
    priority: 1,
    achieved_on: null,
    version: 1,
    deleted: false,
    ...p,
  };
}

export function move(goal_id: string, amount: number, on: string): GoalMove {
  return { id: nextId("gm"), goal_id, amount, on, note: null, version: 1, deleted: false };
}

/** Return a copy of `ds` with rows appended. */
export function withRows(ds: Dataset, rows: Partial<{ [K in keyof Dataset]: Dataset[K] }>): Dataset {
  const out = { ...ds };
  for (const [k, v] of Object.entries(rows)) {
    const key = k as keyof Dataset;
    (out as Record<string, unknown[]>)[key] = [...(ds[key] as unknown[]), ...(v as unknown[])];
  }
  return out;
}

export function closeMonthRecord(ds: Dataset, month: string): Dataset {
  return applyMutations(ds, [
    {
      table: "months",
      row: {
        id: month,
        status: "closed",
        closed_at: NOW,
        snapshot_key: null,
        snapshot_sha256: null,
        version: 1,
        deleted: false,
      },
    },
  ]);
}

export function srow(
  external_id: string,
  occurred_at: string,
  amount: number,
  description: string,
  p: Partial<ParsedStatementRow> = {},
): ParsedStatementRow {
  return {
    occurred_at,
    type: amount < 0 ? "Debit" : "Credit",
    description,
    reason: null,
    amount,
    fee: 0,
    balance_after: null,
    external_id,
    ...p,
  };
}

export function parsed(
  bank: AccountId,
  from: string,
  to: string,
  rows: ParsedStatementRow[],
  opening: number | null = null,
  closing: number | null = null,
): ParsedStatement {
  const totalIn = rows.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0);
  const totalOut = rows.filter((r) => r.amount < 0).reduce((s, r) => s - r.amount, 0);
  return {
    bank,
    from,
    to,
    opening,
    closing,
    totalIn,
    totalOut,
    rows,
    checks: [{ ok: true, label: "Totals match" }],
  };
}

export const importCmd = (st: ParsedStatement, sha = "a".repeat(64)) =>
  cmd("importStatement", { statement: st, file_name: "synthetic.pdf", file_sha256: sha });

export const apply = (ds: Dataset, mutations: Mutation[]) => applyMutations(ds, mutations);

export const rowsOf = (mutations: Mutation[], table: string) =>
  mutations.filter((m) => m.table === table).map((m) => m.row);

/** Set the first tracked month's b/f (opening balance) per wallet. */
export function withOpening(ds: Dataset, opening: Partial<Record<AccountId, number>>): Dataset {
  return {
    ...ds,
    transactions: ds.transactions.map((t) =>
      t.flow === "carry" && t.external_id?.startsWith("carry:bf:") && opening[t.account_id] !== undefined
        ? { ...t, amount: opening[t.account_id] as number, reason: "Opening balance set by you" }
        : t,
    ),
  };
}
