import {
  type AccountId,
  type BalanceEntry,
  Command,
  type CommandArgs,
  type Counterparty,
  type Flow,
  type GoalMove,
  type Recurring,
  type Rule,
  STEP_UP_ALLOWED,
  STEP_UP_REQUIRED,
  type Statement,
  type TableName,
  type Transaction,
} from "@marqum/schema";
import { carryId, carryRow, OPENING_FROM_STATEMENT, OPENING_SET_BY_YOU } from "./carry.ts";
import {
  classify,
  compileRule,
  extractCounterparty,
  findCounterpartyByKey,
  isHolder,
  normalizeKey,
} from "./classify.ts";
import { closeChecklist } from "./close.ts";
import {
  applyMutations,
  isClosed,
  trackingStart,
  trackingStartMonth,
  USER_RULE_PRIORITY,
} from "./dataset.ts";
import { balanceAt, goalSaved } from "./ledger.ts";
import { formatRs } from "./money.ts";
import { matchProvisional } from "./reconcile.ts";
import {
  addDays,
  addMonths,
  dateOf,
  dayLabel,
  minutesBetween,
  monthLabel,
  monthOf,
  monthRange,
} from "./time.ts";
import type { CommandOutcome, Dataset, ExecContext, Mutation } from "./types.ts";

type Outcome = CommandOutcome;
const fail = (error: NonNullable<Outcome["error"]>, message: string): Outcome => ({
  ok: false,
  mutations: [],
  error,
  message,
});
const ok = (mutations: Mutation[], result?: Record<string, unknown>): Outcome =>
  result ? { ok: true, mutations, result } : { ok: true, mutations };
const SYNC = { version: 0, deleted: false } as const;
const mut = <T extends { id: string }>(table: TableName, row: T): Mutation => ({
  table,
  row: row as unknown as Mutation["row"],
});
const tombstone = <T extends { id: string }>(
  table: TableName,
  row: T,
  extra: Record<string, unknown> = {},
): Mutation => mut(table, { ...row, ...extra, deleted: true });

// ───────────────────────── closed-month guard ─────────────────────────

const IMMATERIAL = new Set(["version", "updated_at", "created_at", "statement_id"]);

/** Fields that changed between two rows, ignoring sync bookkeeping and statement re-pointing. */
function changedFields(
  a: Record<string, unknown> | undefined,
  b: Record<string, unknown> | undefined,
): string[] {
  if (!a && !b) return [];
  if (!a || !b) return ["*"];
  if ((a.deleted === true) !== (b.deleted === true)) return ["*"];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out: string[] = [];
  for (const k of keys) {
    if (IMMATERIAL.has(k) || k === "deleted") continue;
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.push(k);
  }
  return out;
}

/** The month a balance entry belongs to: a statement opening at 23:59 is the next day's opening. */
function balanceMonth(b: Pick<BalanceEntry, "as_of" | "source">): string {
  if (b.source === "statement_open" && b.as_of.endsWith("T23:59"))
    return monthOf(addDays(dateOf(b.as_of), 1));
  return monthOf(b.as_of);
}

interface ClosedTouch {
  months: Set<string>;
  /** union of material fields changed on rows in closed months */
  fields: Set<string>;
}

function closedTouches(ds: Dataset, mutations: Mutation[]): ClosedTouch {
  const months = new Set<string>();
  const fields = new Set<string>();
  for (const m of mutations) {
    if (m.table !== "transactions" && m.table !== "balances") continue;
    const list = (m.table === "transactions" ? ds.transactions : ds.balances) as unknown as Record<
      string,
      unknown
    >[];
    const old = list.find((r) => r.id === m.row.id);
    const changed = changedFields(old, m.row);
    if (changed.length === 0) continue;
    const monthFor = (r: Record<string, unknown>) =>
      m.table === "transactions"
        ? monthOf(String(r.occurred_at))
        : balanceMonth(r as unknown as Pick<BalanceEntry, "as_of" | "source">);
    const touched = [old ? monthFor(old) : null, m.row.deleted === true ? null : monthFor(m.row)];
    for (const month of touched) {
      if (month && isClosed(ds, month)) {
        months.add(month);
        for (const f of changed) fields.add(f);
      }
    }
  }
  return { months, fields };
}

function guardClosed(ds: Dataset, cmd: Command, ctx: ExecContext, out: Outcome): Outcome {
  if (!out.ok || cmd.name === "mergeCounterparties" || cmd.name === "resetLedger") return out;
  const touch = closedTouches(ds, out.mutations);
  if (touch.months.size === 0) return out;
  const months = [...touch.months].sort().map(monthLabel).join(", ");
  if (!STEP_UP_ALLOWED.includes(cmd.name)) return fail("closed_month", `${months} is closed`);
  if (cmd.name === "tagTransaction") {
    const extra = [...touch.fields].filter((f) => f !== "category_id" && f !== "reason");
    if (extra.length)
      return fail(
        "closed_month",
        `${months} is closed: only category and reason can change (not ${extra.join(", ")})`,
      );
  }
  if (!ctx.steppedUp)
    return fail("step_up_required", `${months} is closed — confirm with fingerprint or passkey`);
  return out;
}

// ───────────────────────── helpers ─────────────────────────

function newCounterparty(
  ctx: ExecContext,
  name: string,
  key: string,
  kind: Counterparty["kind"],
): Counterparty {
  return {
    id: ctx.newId(),
    name,
    kind,
    aliases: key ? [key] : [],
    default_category_id: null,
    default_flow: null,
    ...SYNC,
  };
}

const beforeStart = (ds: Dataset) =>
  `that's before tracking started (${dayLabel(trackingStart(ds))} ${trackingStart(ds).slice(0, 4)})`;

const findTxn = (ds: Dataset, id: string) => ds.transactions.find((t) => t.id === id && !t.deleted);
const categoryExists = (ds: Dataset, id: string | null | undefined) =>
  id == null || ds.categories.some((c) => c.id === id && !c.deleted);

// ───────────────────────── importStatement ─────────────────────────

function importStatement(ds: Dataset, a: CommandArgs<"importStatement">, ctx: ExecContext): Outcome {
  const st = a.statement;
  const acc: AccountId = st.bank;
  if (st.from > st.to) return fail("invalid", "statement period is reversed");
  const fromDT = `${st.from}T00:00`;
  const toDT = `${st.to}T23:59`;
  const seen = new Set<string>();
  for (const r of st.rows) {
    if (seen.has(r.external_id)) return fail("invalid", `duplicate row ${r.external_id}`);
    seen.add(r.external_id);
    if (r.occurred_at < fromDT || r.occurred_at > toDT)
      return fail("invalid", `row ${r.external_id} (${r.occurred_at}) is outside ${st.from}…${st.to}`);
  }

  const mutations: Mutation[] = [];
  const now = ctx.now;
  // Nothing before tracking start exists: rows dated before it are ignored, and replace semantics start there.
  const startDT = `${trackingStart(ds)}T00:00`;
  const rangeFrom = fromDT > startDT ? fromDT : startDT;
  const tracked = st.rows.filter((r) => r.occurred_at >= startDT);
  const ignored = st.rows.length - tracked.length;
  // system rows (b/f, c/f) are never touched by an import
  const accTxns = ds.transactions.filter((t) => !t.deleted && t.account_id === acc && t.source !== "system");
  const verifiedByExt = new Map<string, Transaction>();
  for (const t of accTxns) if (t.status === "verified" && t.external_id) verifiedByExt.set(t.external_id, t);

  // Statement row: same wallet + same period → same statement (re-import).
  const sameStmt = ds.statements.find(
    (s) => !s.deleted && s.account_id === acc && s.period_from === st.from && s.period_to === st.to,
  );
  const statementId = sameStmt?.id ?? ctx.newId();
  const statement: Statement = {
    id: statementId,
    account_id: acc,
    period_from: st.from,
    period_to: st.to,
    file_name: a.file_name,
    file_sha256: a.file_sha256,
    opening: st.opening,
    closing: st.closing,
    total_in: st.totalIn,
    total_out: st.totalOut,
    row_count: st.rows.length,
    checks: st.checks,
    imported_at: now,
    ...SYNC,
  };
  if (!sameStmt || changedFields(sameStmt, { ...statement, imported_at: sameStmt.imported_at }).length)
    mutations.push(mut("statements", statement));

  // Counterparties created during this import, by key.
  const createdCp = new Map<string, Counterparty>();
  let working = ds;
  // A counterparty first seen on an internal/funding transfer is you (your own name on the other wallet or bank).
  const resolveCounterparty = (description: string, classified: string | null, flow: Flow): string | null => {
    if (classified) return classified;
    const ex = extractCounterparty(description);
    if (!ex) return null;
    const known = createdCp.get(ex.key) ?? findCounterpartyByKey(working, ex.key);
    if (known) return known.id;
    const kind = flow === "internal" || flow === "funding" ? "self" : ex.person ? "person" : "merchant";
    const cp = newCounterparty(ctx, ex.name, ex.key, kind);
    createdCp.set(ex.key, cp);
    mutations.push(mut("counterparties", cp));
    working = applyMutations(working, [mut("counterparties", cp)]);
    return cp.id;
  };

  // Transfers naming the statement's holder are you: make sure that counterparty is "self" before classifying,
  // so "From ARQAM (Meezan Bank)" is funding and "From ARQAM (NayaPay)" is internal — never someone's income.
  if (st.holder) {
    const done = new Set<string>();
    for (const r of tracked) {
      const ex = extractCounterparty(r.description);
      if (!ex?.person || done.has(ex.key) || !isHolder(ex.key, st.holder)) continue;
      done.add(ex.key);
      const known = createdCp.get(ex.key) ?? findCounterpartyByKey(working, ex.key);
      if (known?.kind === "self") continue;
      const cp: Counterparty = known
        ? { ...known, kind: "self" }
        : newCounterparty(ctx, ex.name, ex.key, "self");
      if (!known) createdCp.set(ex.key, cp);
      mutations.push(mut("counterparties", cp));
      working = applyMutations(working, [mut("counterparties", cp)]);
    }
  }

  let added = 0;
  let updated = 0;
  let unchanged = 0;
  let removed = 0;
  let matched = 0;
  let disputed = 0;
  const fresh: typeof st.rows = [];

  for (const r of tracked) {
    const ex = verifiedByExt.get(r.external_id);
    if (!ex) {
      fresh.push(r);
      continue;
    }
    const next: Transaction = {
      ...ex,
      occurred_at: r.occurred_at,
      amount: r.amount,
      description: r.description,
      bank_type: r.type,
      fee: r.fee,
      balance_after: r.balance_after,
      reason: ex.reason ?? r.reason,
      statement_id: statementId,
      status: "verified",
      source: "statement",
    };
    const bankChanged = ["occurred_at", "amount", "description", "bank_type", "fee", "balance_after"].some(
      (k) => (ex as Record<string, unknown>)[k] !== (next as Record<string, unknown>)[k],
    );
    if (bankChanged) updated++;
    else unchanged++;
    if (changedFields(ex, next).length || ex.statement_id !== statementId)
      mutations.push(mut("transactions", { ...next, updated_at: now }));
  }

  // Re-key: a verified row this statement no longer names (its id changed because the bank text now parses
  // differently) but with the same time and amount is the same transaction. Update it in place so your tags,
  // reason and links survive; refresh the counterparty from the new text and fill the category if unset.
  const statementIds = new Set(tracked.map((r) => r.external_id));
  const orphans = accTxns.filter(
    (t) =>
      t.status === "verified" &&
      t.occurred_at >= rangeFrom &&
      t.occurred_at <= toDT &&
      !(t.external_id && statementIds.has(t.external_id)),
  );
  const rekeyed = new Set<string>();
  const stillFresh: typeof fresh = [];
  for (const r of fresh) {
    const old = orphans.find(
      (t) => !rekeyed.has(t.id) && t.occurred_at === r.occurred_at && t.amount === r.amount,
    );
    if (!old) {
      stillFresh.push(r);
      continue;
    }
    rekeyed.add(old.id);
    updated++;
    const c = classify(working, {
      account_id: acc,
      amount: r.amount,
      description: r.description,
      reason: r.reason,
      bank_type: r.type,
    });
    mutations.push(
      mut("transactions", {
        ...old,
        description: r.description,
        bank_type: r.type,
        fee: r.fee,
        balance_after: r.balance_after,
        external_id: r.external_id,
        statement_id: statementId,
        reason: old.reason ?? r.reason,
        category_id: old.category_id ?? c.category_id,
        counterparty_id: resolveCounterparty(r.description, c.counterparty_id, old.flow),
        updated_at: now,
      }),
    );
  }
  fresh.length = 0;
  fresh.push(...stillFresh);

  const provisional = accTxns.filter((t) => t.status !== "verified");
  const names: Record<string, string> = {};
  for (const c of ds.counterparties) if (!c.deleted) names[c.id] = c.name;
  const pairs = matchProvisional(
    fresh.map((r) => ({ ...r, account_id: acc })),
    provisional,
    names,
  );
  const correctedIds = new Set(pairs.filter((p) => p.corrected).map((p) => p.txn_id));
  const corrected: { txn_id: string; from: number; to: number }[] = [];
  const fees: { external_id: string; near_txn_id: string }[] = [];
  const pairByExt = new Map(pairs.map((p) => [p.external_id, p.txn_id]));
  const matchedIds = new Set(pairs.map((p) => p.txn_id));

  for (const r of fresh) {
    const c = classify(working, {
      account_id: acc,
      amount: r.amount,
      description: r.description,
      reason: r.reason,
      bank_type: r.type,
    });
    const bank = {
      occurred_at: r.occurred_at,
      amount: r.amount,
      description: r.description,
      bank_type: r.type,
      fee: r.fee,
      balance_after: r.balance_after,
      external_id: r.external_id,
      statement_id: statementId,
      status: "verified" as const,
      source: "statement" as const,
    };
    const provId = pairByExt.get(r.external_id);
    const prov = provId ? provisional.find((t) => t.id === provId) : undefined;
    if (prov) {
      matched++;
      if (correctedIds.has(prov.id)) corrected.push({ txn_id: prov.id, from: prov.amount, to: r.amount });
      mutations.push(
        mut("transactions", {
          ...prov,
          ...bank,
          reason: prov.reason ?? r.reason,
          category_id: prov.category_id ?? c.category_id,
          flow: prov.flow,
          counterparty_id:
            prov.counterparty_id ?? resolveCounterparty(r.description, c.counterparty_id, prov.flow),
          updated_at: now,
        }),
      );
      continue;
    }
    added++;
    // a separate fee/tax row near a matched notification (e.g. foreign-card tax): report it next to that spend
    if (c.flow === "fee") {
      const near = pairs
        .map((p) => provisional.find((t) => t.id === p.txn_id))
        .filter((t): t is Transaction => t !== undefined)
        .map((t) => ({ t, dt: Math.abs(minutesBetween(t.occurred_at, r.occurred_at)) }))
        .filter((x) => x.dt <= 48 * 60)
        .sort((a, b) => a.dt - b.dt)[0];
      if (near) fees.push({ external_id: r.external_id, near_txn_id: near.t.id });
    }
    const row: Transaction = {
      id: ctx.newId(),
      account_id: acc,
      ...bank,
      flow: c.flow,
      reason: r.reason,
      counterparty_id: resolveCounterparty(r.description, c.counterparty_id, c.flow),
      category_id: c.category_id,
      loan_id: null,
      linked_txn_id: null,
      notification_id: null,
      created_at: now,
      updated_at: now,
      ...SYNC,
    };
    mutations.push(mut("transactions", row));
  }

  const keep = new Set(tracked.map((r) => r.external_id));
  for (const t of accTxns) {
    if (t.status !== "verified" || t.occurred_at < rangeFrom || t.occurred_at > toDT) continue;
    if (t.external_id && keep.has(t.external_id)) continue;
    if (rekeyed.has(t.id)) continue;
    removed++;
    mutations.push(tombstone("transactions", t, { updated_at: now }));
  }
  for (const t of provisional) {
    if (matchedIds.has(t.id) || t.status !== "provisional") continue;
    if (t.occurred_at < rangeFrom || t.occurred_at > toDT) continue;
    disputed++;
    mutations.push(mut("transactions", { ...t, status: "disputed", updated_at: now }));
  }

  // Balance entries: the re-imported statement's own entries are replaced (same as_of+source keeps its id).
  const oldEntries = ds.balances.filter((b) => !b.deleted && sameStmt && b.statement_id === sameStmt.id);
  const reused = new Set<string>();
  const entry = (as_of: string, balance: number, source: BalanceEntry["source"]) => {
    const prev = oldEntries.find((b) => b.as_of === as_of && b.source === source && !reused.has(b.id));
    if (prev) reused.add(prev.id);
    // an identical anchor from another statement already says this — don't duplicate it
    else if (
      ds.balances.some(
        (b) =>
          !b.deleted &&
          b.account_id === acc &&
          b.as_of === as_of &&
          b.source === source &&
          b.balance === balance,
      )
    )
      return;
    const row: BalanceEntry = {
      id: prev?.id ?? ctx.newId(),
      account_id: acc,
      as_of,
      balance,
      source,
      statement_id: statementId,
      ...SYNC,
    };
    if (!prev || changedFields(prev, row).length || prev.statement_id !== statementId)
      mutations.push(mut("balances", row));
  };
  if (st.opening !== null) entry(`${addDays(st.from, -1)}T23:59`, st.opening, "statement_open");
  if (st.closing !== null) entry(toDT, st.closing, "statement_close");
  for (const b of oldEntries) if (!reused.has(b.id)) mutations.push(tombstone("balances", b));

  // First tracked month's b/f = the balance at tracking start according to this statement. A statement is the
  // source of truth, so it replaces an opening you typed or one derived from a notification.
  const start = trackingStart(ds);
  if (st.opening !== null && st.from <= start && st.to >= start) {
    const before = st.rows.filter((r) => r.occurred_at < startDT).reduce((sum, r) => sum + r.amount, 0);
    const amount = st.opening + before;
    const id = carryId("bf", acc, start.slice(0, 7));
    const bf = ds.transactions.find((t) => t.id === id && !t.deleted);
    if (bf?.amount !== amount || bf.reason !== OPENING_FROM_STATEMENT) {
      const base = bf ?? carryRow("bf", acc, start.slice(0, 7), 0, now);
      mutations.push(
        mut("transactions", { ...base, amount, reason: OPENING_FROM_STATEMENT, updated_at: now }),
      );
    }
  }

  return ok(mutations, {
    added,
    updated,
    unchanged,
    removed,
    matched,
    disputed,
    ignored,
    corrected,
    fees,
    statement_id: statementId,
  });
}

// ───────────────────────── transaction commands ─────────────────────────

function addProvisional(ds: Dataset, a: CommandArgs<"addProvisional">, ctx: ExecContext): Outcome {
  if (ds.transactions.some((t) => t.id === a.txn_id))
    return fail("conflict", `transaction ${a.txn_id} exists`);
  if (a.amount === 0) return fail("invalid", "amount must not be zero");
  if (a.occurred_at < `${trackingStart(ds)}T00:00`) return fail("invalid", beforeStart(ds));
  if (!categoryExists(ds, a.category_id)) return fail("invalid", `unknown category ${a.category_id}`);
  const mutations: Mutation[] = [];
  let cp: Counterparty | null = null;
  const name = a.counterparty_name?.trim();
  if (name) {
    const key = normalizeKey(name);
    cp =
      (key ? findCounterpartyByKey(ds, key) : null) ??
      ds.counterparties.find((c) => c.name.toLowerCase() === name.toLowerCase()) ??
      null;
    if (!cp) {
      cp = newCounterparty(ctx, name, key, "person");
      mutations.push(mut("counterparties", cp));
    }
  }
  const c = classify(
    ds,
    {
      account_id: a.account_id,
      amount: a.amount,
      description: name ?? "",
      reason: a.reason,
      bank_type: null,
    },
    cp,
  );
  const row: Transaction = {
    id: a.txn_id,
    account_id: a.account_id,
    occurred_at: a.occurred_at,
    amount: a.amount,
    status: "provisional",
    source: "manual",
    flow: a.flow ?? c.flow,
    description: "",
    bank_type: null,
    reason: a.reason,
    counterparty_id: cp?.id ?? c.counterparty_id,
    category_id: a.category_id ?? c.category_id,
    external_id: null,
    statement_id: null,
    loan_id: null,
    linked_txn_id: null,
    fee: 0,
    balance_after: null,
    notification_id: null,
    created_at: ctx.now,
    updated_at: ctx.now,
    ...SYNC,
  };
  mutations.push(mut("transactions", row));
  return ok(mutations);
}

function deleteProvisional(ds: Dataset, a: CommandArgs<"deleteProvisional">, ctx: ExecContext): Outcome {
  const t = findTxn(ds, a.txn_id);
  if (!t) return fail("not_found", `transaction ${a.txn_id} not found`);
  if (t.status === "verified")
    return fail("invalid", "verified transactions come from statements and can't be deleted");
  return ok([tombstone("transactions", t, { updated_at: ctx.now })]);
}

function resolveDisputed(ds: Dataset, a: CommandArgs<"resolveDisputed">, ctx: ExecContext): Outcome {
  const t = findTxn(ds, a.txn_id);
  if (!t) return fail("not_found", `transaction ${a.txn_id} not found`);
  if (t.status !== "disputed") return fail("invalid", "transaction is not disputed");
  if (a.action === "delete") return ok([tombstone("transactions", t, { updated_at: ctx.now })]);
  return ok([mut("transactions", { ...t, status: "provisional", updated_at: ctx.now })]);
}

function tagTransaction(ds: Dataset, a: CommandArgs<"tagTransaction">, ctx: ExecContext): Outcome {
  const t = findTxn(ds, a.txn_id);
  if (!t) return fail("not_found", `transaction ${a.txn_id} not found`);
  if (t.source === "system")
    return fail("invalid", "balance brought/carried forward entries can't be edited");
  if (a.category_id !== undefined && !categoryExists(ds, a.category_id))
    return fail("invalid", `unknown category ${a.category_id}`);
  if (a.counterparty_id != null && !ds.counterparties.some((c) => c.id === a.counterparty_id && !c.deleted))
    return fail("invalid", `unknown counterparty ${a.counterparty_id}`);
  if (a.loan_id != null && !ds.loans.some((l) => l.id === a.loan_id && !l.deleted))
    return fail("invalid", `unknown loan ${a.loan_id}`);
  if (a.linked_txn_id != null && (a.linked_txn_id === t.id || !findTxn(ds, a.linked_txn_id)))
    return fail("invalid", `unknown linked transaction ${a.linked_txn_id}`);
  const next: Transaction = { ...t };
  if (a.category_id !== undefined) next.category_id = a.category_id;
  if (a.reason !== undefined) next.reason = a.reason?.trim() ? a.reason.trim() : null;
  if (a.flow !== undefined) next.flow = a.flow;
  if (a.counterparty_id !== undefined) next.counterparty_id = a.counterparty_id;
  if (a.loan_id !== undefined) next.loan_id = a.loan_id;
  if (a.linked_txn_id !== undefined) next.linked_txn_id = a.linked_txn_id;
  const mutations: Mutation[] = [];
  if (changedFields(t, next).length) mutations.push(mut("transactions", { ...next, updated_at: ctx.now }));
  if (a.remember) {
    if (!a.remember.pattern.trim() || !compileRule(a.remember.pattern))
      return fail("invalid", `invalid pattern: ${a.remember.pattern}`);
    const top = ds.rules.reduce((m, r) => Math.max(m, r.priority), USER_RULE_PRIORITY - 1);
    const rule: Rule = {
      id: ctx.newId(),
      pattern: a.remember.pattern,
      category_id: next.category_id,
      flow: next.flow,
      counterparty_id: null,
      priority: Math.max(USER_RULE_PRIORITY, top + 1),
      ...SYNC,
    };
    mutations.push(mut("rules", rule));
  }
  return ok(mutations);
}

function recordBalance(ds: Dataset, a: CommandArgs<"recordBalance">): Outcome {
  if (a.as_of < `${trackingStart(ds)}T00:00`) return fail("invalid", beforeStart(ds));
  const row: BalanceEntry = {
    id: a.entry_id,
    account_id: a.account_id,
    as_of: a.as_of,
    balance: a.balance,
    source: "manual",
    statement_id: null,
    ...SYNC,
  };
  return ok([mut("balances", row)]);
}

// ───────────────────────── reference data ─────────────────────────

function upsertCategory(ds: Dataset, a: CommandArgs<"upsertCategory">): Outcome {
  if (a.budget != null && a.budget < 0) return fail("invalid", "budget must not be negative");
  const existing = ds.categories.find((c) => c.id === a.category_id);
  if (a.parent_id !== null) {
    if (a.parent_id === a.category_id) return fail("invalid", "a category can't be its own parent");
    const parent = ds.categories.find((c) => c.id === a.parent_id && !c.deleted);
    if (!parent) return fail("invalid", `unknown parent ${a.parent_id}`);
    if (parent.parent_id !== null) return fail("invalid", "categories are at most two levels deep");
    if (ds.categories.some((c) => c.parent_id === a.category_id && !c.deleted))
      return fail("invalid", "a category with subcategories can't become a subcategory");
  }
  return ok([
    mut("categories", {
      id: a.category_id,
      parent_id: a.parent_id,
      name: a.name,
      icon: a.icon,
      wallet_hint: a.wallet_hint,
      nature: a.nature,
      sort: a.sort,
      hidden: a.hidden,
      budget: a.budget !== undefined ? a.budget : (existing?.budget ?? null),
      ...SYNC,
    }),
  ]);
}

function upsertRule(_ds: Dataset, a: CommandArgs<"upsertRule">): Outcome {
  if (!a.pattern.trim() || !compileRule(a.pattern)) return fail("invalid", `invalid pattern: ${a.pattern}`);
  const row: Rule = {
    id: a.rule_id,
    pattern: a.pattern,
    category_id: a.category_id,
    flow: a.flow,
    counterparty_id: a.counterparty_id,
    priority: a.priority,
    ...SYNC,
  };
  return ok([mut("rules", row)]);
}

function deleteById<T extends { id: string; deleted: boolean }>(
  table: TableName,
  rows: T[],
  id: string,
  label: string,
): Outcome {
  const row = rows.find((r) => r.id === id && !r.deleted);
  if (!row) return fail("not_found", `${label} ${id} not found`);
  return ok([tombstone(table, row)]);
}

function upsertCounterparty(_ds: Dataset, a: CommandArgs<"upsertCounterparty">): Outcome {
  const aliases = [...new Set(a.aliases.map(normalizeKey).filter(Boolean))].sort();
  const row: Counterparty = {
    id: a.counterparty_id,
    name: a.name,
    kind: a.kind,
    aliases,
    default_category_id: a.default_category_id,
    default_flow: a.default_flow as Flow | null,
    ...SYNC,
  };
  return ok([mut("counterparties", row)]);
}

function mergeCounterparties(ds: Dataset, a: CommandArgs<"mergeCounterparties">, ctx: ExecContext): Outcome {
  const into = ds.counterparties.find((c) => c.id === a.into_id && !c.deleted);
  if (!into) return fail("not_found", `counterparty ${a.into_id} not found`);
  const fromIds = new Set(a.from_ids);
  if (fromIds.has(into.id)) return fail("invalid", "can't merge a counterparty into itself");
  const from = ds.counterparties.filter((c) => fromIds.has(c.id) && !c.deleted);
  if (from.length !== fromIds.size) return fail("not_found", "some counterparties to merge were not found");
  const aliases = new Set(into.aliases);
  for (const f of from) {
    for (const al of f.aliases) aliases.add(al);
    const k = normalizeKey(f.name);
    if (k) aliases.add(k);
  }
  const mutations: Mutation[] = [
    mut("counterparties", {
      ...into,
      aliases: [...aliases].sort(),
      default_category_id:
        into.default_category_id ?? from.find((f) => f.default_category_id)?.default_category_id ?? null,
      default_flow: into.default_flow ?? from.find((f) => f.default_flow)?.default_flow ?? null,
    }),
  ];
  for (const t of ds.transactions)
    if (!t.deleted && t.counterparty_id && fromIds.has(t.counterparty_id))
      mutations.push(mut("transactions", { ...t, counterparty_id: into.id, updated_at: ctx.now }));
  for (const r of ds.recurring)
    if (!r.deleted && r.counterparty_id && fromIds.has(r.counterparty_id))
      mutations.push(mut("recurring", { ...r, counterparty_id: into.id }));
  for (const l of ds.loans)
    if (!l.deleted && l.counterparty_id && fromIds.has(l.counterparty_id))
      mutations.push(mut("loans", { ...l, counterparty_id: into.id }));
  for (const r of ds.rules)
    if (!r.deleted && r.counterparty_id && fromIds.has(r.counterparty_id))
      mutations.push(mut("rules", { ...r, counterparty_id: into.id }));
  for (const f of from) mutations.push(tombstone("counterparties", f));
  return ok(mutations, { merged: from.length });
}

function upsertRecurring(ds: Dataset, a: CommandArgs<"upsertRecurring">): Outcome {
  if (a.amount === 0) return fail("invalid", "amount must not be zero");
  const existing = ds.recurring.find((r) => r.id === a.recurring_id && !r.deleted);
  const source_txn_id = a.source_txn_id !== undefined ? a.source_txn_id : (existing?.source_txn_id ?? null);
  const src = source_txn_id ? findTxn(ds, source_txn_id) : undefined;
  if (source_txn_id && !src) return fail("invalid", `unknown transaction ${source_txn_id}`);
  const cadence = a.cadence ?? existing?.cadence ?? "monthly";
  let month_of_year = a.month_of_year !== undefined ? a.month_of_year : (existing?.month_of_year ?? null);
  if (cadence === "yearly" && month_of_year === null)
    month_of_year = src ? Number(src.occurred_at.slice(5, 7)) : null;
  if (cadence === "yearly" && month_of_year === null)
    return fail("invalid", "a yearly charge needs month_of_year");
  const row: Recurring = {
    id: a.recurring_id,
    name: a.name,
    account_id: a.account_id,
    // created from a transaction: fill what the caller left empty from it
    category_id: a.category_id ?? src?.category_id ?? null,
    counterparty_id: a.counterparty_id ?? src?.counterparty_id ?? null,
    amount: Math.abs(a.amount),
    day_of_month: a.day_of_month,
    cadence,
    month_of_year: cadence === "yearly" ? month_of_year : null,
    kind: a.kind ?? existing?.kind ?? "other",
    source_txn_id,
    active: a.active,
    detected: existing?.detected ?? false,
    ...SYNC,
  };
  return ok([mut("recurring", row)]);
}

function upsertLoan(_ds: Dataset, a: CommandArgs<"upsertLoan">): Outcome {
  if (a.principal <= 0) return fail("invalid", "principal must be positive");
  if (a.installment < 0 || a.manual_repaid < 0)
    return fail("invalid", "installment and repaid must not be negative");
  return ok([
    mut("loans", {
      id: a.loan_id,
      lender: a.lender,
      counterparty_id: a.counterparty_id,
      principal: a.principal,
      started_on: a.started_on,
      purpose: a.purpose,
      installment: a.installment,
      note: a.note,
      manual_repaid: a.manual_repaid,
      closed_on: a.closed_on,
      ...SYNC,
    }),
  ]);
}

function upsertGoal(_ds: Dataset, a: CommandArgs<"upsertGoal">): Outcome {
  if (a.target <= 0 || a.monthly < 0)
    return fail("invalid", "target must be positive and monthly not negative");
  return ok([
    mut("goals", {
      id: a.goal_id,
      name: a.name,
      icon: a.icon,
      target: a.target,
      monthly: a.monthly,
      priority: a.priority,
      achieved_on: a.achieved_on,
      ...SYNC,
    }),
  ]);
}

function deleteGoal(ds: Dataset, a: CommandArgs<"deleteGoal">): Outcome {
  const out = deleteById("goals", ds.goals, a.goal_id, "goal");
  if (!out.ok) return out;
  for (const m of ds.goal_moves)
    if (!m.deleted && m.goal_id === a.goal_id) out.mutations.push(tombstone("goal_moves", m));
  return out;
}

function moveGoal(ds: Dataset, a: CommandArgs<"moveGoal">): Outcome {
  if (!ds.goals.some((g) => g.id === a.goal_id && !g.deleted))
    return fail("not_found", `goal ${a.goal_id} not found`);
  if (a.amount === 0) return fail("invalid", "amount must not be zero");
  const prev = ds.goal_moves.find((m) => m.id === a.move_id && !m.deleted);
  const saved = goalSaved(ds, a.goal_id) - (prev?.goal_id === a.goal_id ? prev.amount : 0);
  if (saved + a.amount < 0) return fail("invalid", "can't release more than the envelope holds");
  const row: GoalMove = {
    id: a.move_id,
    goal_id: a.goal_id,
    amount: a.amount,
    on: a.on,
    note: a.note,
    ...SYNC,
  };
  return ok([mut("goal_moves", row)]);
}

function setSettingCmd(_ds: Dataset, a: CommandArgs<"setSetting">): Outcome {
  if (a.key === "avg_window" && a.value !== "3" && a.value !== "6")
    return fail("invalid", "avg_window must be 3 or 6");
  if (a.key === "income_monthly" && !/^\d+$/.test(a.value))
    return fail("invalid", "income_monthly must be a non-negative integer (paisa)");
  if (
    a.key === "close_reminder_day" &&
    !(/^\d+$/.test(a.value) && Number(a.value) >= 1 && Number(a.value) <= 28)
  )
    return fail("invalid", "close_reminder_day must be 1–28");
  if (a.key === "tracking_start") return fail("invalid", "change tracking start with resetLedger");
  if (a.key === "allocation_sadapay" && a.value !== "" && !/^\d+$/.test(a.value))
    return fail("invalid", "allocation_sadapay must be empty or a non-negative integer (paisa)");
  if (a.key === "forecast" && a.value !== "") {
    try {
      const v: unknown = JSON.parse(a.value);
      if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("not an object");
    } catch {
      return fail("invalid", "forecast must be empty or a JSON object");
    }
  }
  return ok([mut("settings", { id: a.key, value: a.value, ...SYNC })]);
}

function closeMonth(ds: Dataset, a: CommandArgs<"closeMonth">, ctx: ExecContext): Outcome {
  if (isClosed(ds, a.month)) return fail("invalid", `${monthLabel(a.month)} is already closed`);
  const check = closeChecklist(ds, a.month, ctx.now);
  if (!check.can_close) {
    const blocking = check.items.filter((i) => i.severity === "block" && !i.ok).map((i) => i.label);
    return fail("invalid", `Can't close ${monthLabel(a.month)}: ${blocking.join("; ")}`);
  }
  // c/f on the last day 23:59 = −closing; b/f of the next month on the 1st 00:00 = +closing.
  const end = `${monthRange(a.month).to}T23:59`;
  const next = addMonths(a.month, 1);
  const carries: Mutation[] = [];
  for (const acc of accountIds(ds)) {
    const closing = balanceAt(ds, acc, end);
    carries.push(mut("transactions", carryRow("cf", acc, a.month, -closing, ctx.now)));
    carries.push(mut("transactions", carryRow("bf", acc, next, closing, ctx.now)));
  }
  return ok([
    ...carries,
    mut("months", {
      id: a.month,
      status: "closed",
      closed_at: ctx.now,
      snapshot_key: null,
      snapshot_sha256: null,
      ...SYNC,
    }),
  ]);
}

function reopenMonth(ds: Dataset, a: CommandArgs<"reopenMonth">, ctx: ExecContext): Outcome {
  if (!ctx.steppedUp) return fail("step_up_required", "reopening a month needs fingerprint or passkey");
  const rec = ds.months.find((m) => m.id === a.month && !m.deleted);
  if (rec?.status !== "closed") return fail("invalid", `${monthLabel(a.month)} is not closed`);
  const next = addMonths(a.month, 1);
  if (isClosed(ds, next)) return fail("invalid", `Reopen ${monthLabel(next)} first`);
  const mutations: Mutation[] = [];
  for (const acc of accountIds(ds)) {
    for (const id of [carryId("cf", acc, a.month), carryId("bf", acc, next)]) {
      const row = ds.transactions.find((t) => t.id === id && !t.deleted);
      if (row) mutations.push(tombstone("transactions", row, { updated_at: ctx.now }));
    }
  }
  mutations.push(mut("months", { ...rec, status: "open", closed_at: null }));
  return ok(mutations);
}

const LEDGER_TABLES = [
  "transactions",
  "statements",
  "balances",
  "months",
  "notifications",
  "goal_moves",
] as const;

function resetLedger(ds: Dataset, a: CommandArgs<"resetLedger">, ctx: ExecContext): Outcome {
  if (!/^\d{4}-\d{2}-01$/.test(a.tracking_start))
    return fail("invalid", "tracking start must be the first day of a month");
  const mutations: Mutation[] = [];
  for (const table of LEDGER_TABLES)
    for (const row of ds[table] as { id: string; deleted: boolean }[])
      if (!row.deleted)
        mutations.push(tombstone(table, row, table === "transactions" ? { updated_at: ctx.now } : {}));
  mutations.push(mut("settings", { id: "tracking_start", value: a.tracking_start, ...SYNC }));
  // b/f rows for the new start month are added by ensureOpening (execute)
  return ok(mutations, { tracking_start: a.tracking_start });
}

function setOpeningBalance(ds: Dataset, a: CommandArgs<"setOpeningBalance">, ctx: ExecContext): Outcome {
  const month = trackingStartMonth(ds);
  if (isClosed(ds, month)) return fail("closed_month", `${monthLabel(month)} is closed`);
  const id = carryId("bf", a.account_id, month);
  const existing = ds.transactions.find((t) => t.id === id && !t.deleted);
  if (existing?.reason === OPENING_FROM_STATEMENT && existing.amount !== a.amount)
    return fail(
      "invalid",
      `This opening comes from a statement (${formatRs(existing.amount, { decimals: true })}) — statements are the source of truth`,
    );
  const base = existing ?? carryRow("bf", a.account_id, month, 0, ctx.now);
  return ok([
    mut("transactions", { ...base, amount: a.amount, reason: OPENING_SET_BY_YOU, updated_at: ctx.now }),
  ]);
}

const accountIds = (ds: Dataset): AccountId[] =>
  ds.accounts.length ? ds.accounts.filter((x) => !x.deleted).map((x) => x.id) : ["sadapay", "nayapay"];

/**
 * The first tracked month always opens with a b/f row per wallet: the statement opening if a statement starts
 * on tracking start, else 0. Added to any command's outcome when missing.
 */
function ensureOpening(ds: Dataset, ctx: ExecContext): Mutation[] {
  if (ds.accounts.length === 0) return [];
  const start = trackingStart(ds);
  const month = start.slice(0, 7);
  const out: Mutation[] = [];
  for (const acc of accountIds(ds)) {
    const id = carryId("bf", acc, month);
    if (ds.transactions.some((t) => t.id === id && !t.deleted)) continue;
    const st = ds.statements.find(
      (x) => !x.deleted && x.account_id === acc && x.period_from === start && x.opening !== null,
    );
    out.push(
      mut(
        "transactions",
        carryRow("bf", acc, month, st?.opening ?? 0, ctx.now, st ? OPENING_FROM_STATEMENT : null),
      ),
    );
  }
  return out;
}

/** Keep only the last write per row, at the position of that last write. */
function dedupe(mutations: Mutation[]): Mutation[] {
  const last = new Map<string, number>();
  mutations.forEach((m, i) => {
    last.set(`${m.table}|${m.row.id}`, i);
  });
  return mutations.filter((m, i) => last.get(`${m.table}|${m.row.id}`) === i);
}

// ───────────────────────── entry point ─────────────────────────

function run(ds: Dataset, c: Command, ctx: ExecContext): Outcome {
  switch (c.name) {
    case "importStatement":
      return importStatement(ds, c.args, ctx);
    case "addProvisional":
      return addProvisional(ds, c.args, ctx);
    case "deleteProvisional":
      return deleteProvisional(ds, c.args, ctx);
    case "tagTransaction":
      return tagTransaction(ds, c.args, ctx);
    case "resolveDisputed":
      return resolveDisputed(ds, c.args, ctx);
    case "recordBalance":
      return recordBalance(ds, c.args);
    case "upsertCategory":
      return upsertCategory(ds, c.args);
    case "upsertRule":
      return upsertRule(ds, c.args);
    case "deleteRule":
      return deleteById("rules", ds.rules, c.args.rule_id, "rule");
    case "upsertCounterparty":
      return upsertCounterparty(ds, c.args);
    case "mergeCounterparties":
      return mergeCounterparties(ds, c.args, ctx);
    case "upsertRecurring":
      return upsertRecurring(ds, c.args);
    case "deleteRecurring":
      return deleteById("recurring", ds.recurring, c.args.recurring_id, "recurring payment");
    case "upsertLoan":
      return upsertLoan(ds, c.args);
    case "upsertGoal":
      return upsertGoal(ds, c.args);
    case "deleteGoal":
      return deleteGoal(ds, c.args);
    case "moveGoal":
      return moveGoal(ds, c.args);
    case "setSetting":
      return setSettingCmd(ds, c.args);
    case "closeMonth":
      return closeMonth(ds, c.args, ctx);
    case "reopenMonth":
      return reopenMonth(ds, c.args, ctx);
    case "resetLedger":
      return resetLedger(ds, c.args, ctx);
    case "setOpeningBalance":
      return setOpeningBalance(ds, c.args, ctx);
  }
}

/**
 * Execute a command against a dataset. Pure: returns full-row mutations (version 0; the server assigns versions)
 * and never mutates `ds`. Closed-month rules are enforced here; idempotency (by command id) is the server's job.
 */
export function execute(ds: Dataset, command: Command, ctx: ExecContext): CommandOutcome {
  const parsed = Command.safeParse(command);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail(
      "invalid",
      issue ? `${issue.path.join(".") || "command"}: ${issue.message}` : "invalid command",
    );
  }
  const cmd = parsed.data;
  if (STEP_UP_REQUIRED.includes(cmd.name) && !ctx.steppedUp)
    return fail("step_up_required", "confirm with fingerprint or passkey");
  const out = guardClosed(ds, cmd, ctx, run(ds, cmd, ctx));
  if (!out.ok) return out;
  const extra = ensureOpening(applyMutations(ds, out.mutations), ctx);
  return { ...out, mutations: dedupe([...out.mutations, ...extra]) };
}
