import type { AccountId, Statement, Transaction } from "@marqum/schema";
import { extractCounterparty } from "./classify.ts";
import { liveTxns, loanStatuses } from "./ledger.ts";
import { formatRs } from "./money.ts";
import { addDays, addMonths, dateOf, dayLabel, monthOf, monthRange } from "./time.ts";
import type { ChecklistItem, CloseChecklist, Dataset } from "./types.ts";

/** Openings/closings of adjacent statements may differ by at most Rs 1 (rounding in bank PDFs). */
export const CHAIN_TOLERANCE = 100;

const ACCOUNT_NAMES: Record<AccountId, string> = { sadapay: "SadaPay", nayapay: "NayaPay" };
const accountName = (ds: Dataset, id: AccountId) =>
  ds.accounts.find((a) => a.id === id)?.name ?? ACCOUNT_NAMES[id];
const accountIds = (ds: Dataset): AccountId[] =>
  ds.accounts.length ? ds.accounts.map((a) => a.id) : ["sadapay", "nayapay"];

const rangeLabel = (from: string, to: string) =>
  from === to
    ? dayLabel(from)
    : monthOf(from) === monthOf(to)
      ? `${Number(from.slice(8, 10))}–${dayLabel(to)}`
      : `${dayLabel(from)}–${dayLabel(to)}`;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const absSum = (txns: Transaction[]) => txns.reduce((s, t) => s + Math.abs(t.amount), 0);

/** Day ranges inside [from, to] not covered by any statement of the account. */
export function uncoveredRanges(
  statements: Statement[],
  from: string,
  to: string,
): { from: string; to: string }[] {
  const periods = statements
    .map((s) => ({ from: s.period_from, to: s.period_to }))
    .sort((a, b) => a.from.localeCompare(b.from));
  const gaps: { from: string; to: string }[] = [];
  let cursor = from;
  for (const p of periods) {
    if (cursor > to) break;
    if (p.to < cursor) continue;
    if (p.from > cursor) gaps.push({ from: cursor, to: p.from > to ? to : addDays(p.from, -1) });
    if (p.to >= cursor) cursor = addDays(p.to, 1);
  }
  if (cursor <= to) gaps.push({ from: cursor, to });
  return gaps;
}

/** Wallet balance at the end of `date` from statements, or null if it can't be derived. */
export function closingBalanceOn(ds: Dataset, account: AccountId, date: string): number | null {
  const stmts = ds.statements.filter((s) => !s.deleted && s.account_id === account);
  const covering = stmts
    .filter((s) => s.period_from <= date && s.period_to >= date && s.closing !== null)
    .sort((a, b) => a.period_to.localeCompare(b.period_to));
  const c = covering[0];
  if (c && c.closing !== null) {
    let bal = c.closing;
    for (const t of liveTxns(ds))
      if (
        t.account_id === account &&
        t.occurred_at > `${date}T23:59` &&
        t.occurred_at <= `${c.period_to}T23:59`
      )
        bal -= t.amount;
    return bal;
  }
  const next = stmts.find((s) => s.period_from === addDays(date, 1) && s.opening !== null);
  if (next?.opening != null) return next.opening;
  return balanceFromAnchors(ds, account, date, stmts);
}

/**
 * Balance at `date` 23:59 from any anchor (statement or manual), as in netPosition. Requires the month of `date`
 * to be fully covered by statements, so the transactions bridging the anchor and month end are complete.
 * Prefers the latest anchor at/before month end (statements must cover from its day to month end); otherwise
 * the earliest anchor after month end, subtracting the transactions in between.
 */
function balanceFromAnchors(
  ds: Dataset,
  account: AccountId,
  date: string,
  stmts: Statement[],
): number | null {
  if (uncoveredRanges(stmts, `${monthOf(date)}-01`, date).length) return null;
  const end = `${date}T23:59`;
  const anchors = ds.balances
    .filter((b) => !b.deleted && b.account_id === account)
    .sort((a, b) => a.as_of.localeCompare(b.as_of) || a.id.localeCompare(b.id));
  const txns = liveTxns(ds).filter((t) => t.account_id === account);
  const before = anchors.filter((b) => b.as_of <= end).at(-1);
  if (before && uncoveredRanges(stmts, dateOf(before.as_of), date).length === 0) {
    let bal = before.balance;
    for (const t of txns) if (t.occurred_at > before.as_of && t.occurred_at <= end) bal += t.amount;
    return bal;
  }
  const after = anchors.find((b) => b.as_of > end);
  if (after) {
    let bal = after.balance;
    for (const t of txns) if (t.occurred_at > end && t.occurred_at <= after.as_of) bal -= t.amount;
    return bal;
  }
  return null;
}

export function closeChecklist(ds: Dataset, month: string, now: string): CloseChecklist {
  const { from, to } = monthRange(month);
  const closable_from = `${addMonths(month, 1)}-01`;
  const q = `month=${month}`;
  const items: ChecklistItem[] = [];
  const inMonth = liveTxns(ds).filter((t) => monthOf(t.occurred_at) === month);

  const ended = dateOf(now) >= closable_from;
  items.push({
    id: "month_ended",
    ok: ended,
    severity: "block",
    label: ended ? "Month has ended" : `Month ends ${dayLabel(to)} — close from ${dayLabel(closable_from)}`,
  });

  for (const acc of accountIds(ds)) {
    const name = accountName(ds, acc);
    const stmts = ds.statements.filter((s) => !s.deleted && s.account_id === acc);
    const gaps = uncoveredRanges(stmts, from, to);
    items.push({
      id: `statements_${acc}`,
      ok: gaps.length === 0,
      severity: "block",
      label:
        gaps.length === 0
          ? `${name} statements cover ${rangeLabel(from, to)}`
          : `${name} statement missing for ${gaps.map((g) => rangeLabel(g.from, g.to)).join(", ")}`,
      action: `/statements?account=${acc}&${q}`,
    });
  }

  const problems: string[] = [];
  let checked = 0;
  for (const acc of accountIds(ds)) {
    const name = accountName(ds, acc);
    const relevant = ds.statements
      .filter(
        (s) => !s.deleted && s.account_id === acc && s.period_to >= addDays(from, -1) && s.period_from <= to,
      )
      .sort((a, b) => a.period_from.localeCompare(b.period_from) || a.period_to.localeCompare(b.period_to));
    for (const s of relevant) {
      if (s.period_to < from) continue;
      checked++;
      for (const c of s.checks)
        if (!c.ok) problems.push(`${name} ${rangeLabel(s.period_from, s.period_to)}: ${c.label}`);
    }
    for (let i = 1; i < relevant.length; i++) {
      const prev = relevant[i - 1] as Statement;
      const next = relevant[i] as Statement;
      if (next.period_from !== addDays(prev.period_to, 1) || prev.closing === null || next.opening === null)
        continue;
      if (Math.abs(prev.closing - next.opening) > CHAIN_TOLERANCE)
        problems.push(
          `${name}: closing ${formatRs(prev.closing)} on ${dayLabel(prev.period_to)} ≠ opening ${formatRs(
            next.opening,
          )} on ${dayLabel(next.period_from)}`,
        );
    }
  }
  items.push({
    id: "statement_checks",
    ok: problems.length === 0,
    severity: "block",
    label:
      problems.length === 0
        ? `All ${plural(checked, "statement", "statements")} pass checks and balances chain`
        : `Fix ${plural(problems.length, "statement problem", "statement problems")}`,
    ...(problems.length ? { detail: problems.join("\n") } : {}),
    action: `/statements?${q}`,
  });

  const unverified = inMonth.filter((t) => t.status !== "verified");
  items.push({
    id: "unverified",
    ok: unverified.length === 0,
    severity: "block",
    label:
      unverified.length === 0
        ? "No unverified transactions"
        : `Resolve ${plural(unverified.length, "unverified transaction", "unverified transactions")} (${formatRs(
            absSum(unverified),
          )})`,
    action: `/activity?${q}&filter=unverified`,
  });

  const untagged = inMonth.filter((t) => (t.flow === "spend" || t.flow === "fee") && t.category_id === null);
  items.push({
    id: "uncategorised",
    ok: untagged.length === 0,
    severity: "block",
    label:
      untagged.length === 0
        ? "Every spend has a category"
        : `Categorise ${plural(untagged.length, "transaction", "transactions")} (${formatRs(absSum(untagged))})`,
    action: `/activity?${q}&filter=untagged`,
  });

  for (const acc of accountIds(ds)) {
    const name = accountName(ds, acc);
    const bal = closingBalanceOn(ds, acc, to);
    items.push({
      id: `closing_${acc}`,
      ok: bal !== null,
      severity: "block",
      label:
        bal !== null
          ? `${name} closing balance on ${dayLabel(to)}: ${formatRs(bal)}`
          : `${name} closing balance on ${dayLabel(to)} unknown — import a statement covering it`,
      action: `/statements?account=${acc}&${q}`,
    });
  }

  const noReason = inMonth.filter(
    (t) => t.flow === "spend" && !t.reason?.trim() && extractCounterparty(t.description)?.person === true,
  );
  items.push({
    id: "reasons",
    ok: noReason.length === 0,
    severity: "warn",
    label:
      noReason.length === 0
        ? "Every transfer to a person has a reason"
        : `Add a reason to ${plural(noReason.length, "transfer", "transfers")} to people (${formatRs(absSum(noReason))})`,
    action: `/activity?${q}&filter=noreason`,
  });

  const missingRecurring = ds.recurring.filter((r) => {
    if (r.deleted || !r.active) return false;
    const amt = Math.abs(r.amount);
    return !inMonth.some(
      (t) =>
        t.account_id === r.account_id &&
        t.amount < 0 &&
        Math.abs(-t.amount - amt) <= amt * 0.1 &&
        ((r.counterparty_id !== null && t.counterparty_id === r.counterparty_id) ||
          (r.category_id !== null && t.category_id === r.category_id) ||
          (r.counterparty_id === null && r.category_id === null)),
    );
  });
  items.push({
    id: "recurring",
    ok: missingRecurring.length === 0,
    severity: "warn",
    label:
      missingRecurring.length === 0
        ? "All recurring payments seen"
        : `${plural(missingRecurring.length, "recurring payment", "recurring payments")} not seen: ${missingRecurring
            .map((r) => `${r.name} (${formatRs(Math.abs(r.amount))})`)
            .join(", ")}`,
    action: "/plan/recurring",
  });

  const missingLoans = loanStatuses(ds, `${to}T23:59`).filter((s) => {
    const l = s.loan;
    if (monthOf(l.started_on) >= month) return false;
    if (l.closed_on && l.closed_on < from) return false;
    const paidInMonth = inMonth.some((t) => t.loan_id === l.id && t.flow === "loan_repay");
    if (paidInMonth) return false;
    return s.outstanding > 0;
  });
  items.push({
    id: "loans",
    ok: missingLoans.length === 0,
    severity: "warn",
    label:
      missingLoans.length === 0
        ? "Loan installments seen"
        : `Loan installment not seen: ${missingLoans
            .map((s) => `${s.loan.purpose} (${formatRs(s.loan.installment)})`)
            .join(", ")}`,
    action: "/plan/loans",
  });

  return { month, items, can_close: items.every((i) => i.severity !== "block" || i.ok), closable_from };
}

/** Recursively sort object keys; drop `version` (sync bookkeeping, not content). */
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) {
      if (k === "version") continue;
      out[k] = canonical((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}

interface WebCrypto {
  crypto: { subtle: { digest(alg: string, data: Uint8Array): Promise<ArrayBuffer> } };
  TextEncoder: new () => { encode(s: string): Uint8Array };
}

export async function sha256Hex(text: string): Promise<string> {
  const g = globalThis as unknown as WebCrypto;
  const buf = await g.crypto.subtle.digest("SHA-256", new g.TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Deterministic JSON of everything dated in the month: transactions, statements overlapping it, balance entries
 * from the previous month's last instant to this month's last, referenced categories (with parents) and
 * counterparties, and the month record (without snapshot fields). Keys sorted, rows sorted, `version` omitted.
 */
export async function buildSnapshot(ds: Dataset, month: string): Promise<{ json: string; sha256: string }> {
  const { from, to } = monthRange(month);
  const transactions = liveTxns(ds)
    .filter((t) => monthOf(t.occurred_at) === month)
    .sort((a, b) => (a.occurred_at < b.occurred_at ? -1 : a.occurred_at > b.occurred_at ? 1 : byId(a, b)));
  const statements = ds.statements
    .filter((s) => !s.deleted && s.period_from <= to && s.period_to >= from)
    .sort(byId);
  const balances = ds.balances
    .filter((b) => !b.deleted && b.as_of >= `${addDays(from, -1)}T23:59` && b.as_of <= `${to}T23:59`)
    .sort(byId);
  const catIds = new Set<string>();
  for (const t of transactions) if (t.category_id) catIds.add(t.category_id);
  for (const id of [...catIds]) {
    const parent = ds.categories.find((c) => c.id === id)?.parent_id;
    if (parent) catIds.add(parent);
  }
  const cpIds = new Set(transactions.map((t) => t.counterparty_id).filter((x): x is string => x !== null));
  const record = ds.months.find((m) => m.id === month);
  const monthRecord = record ? { id: record.id, status: record.status, closed_at: record.closed_at } : null;
  const doc = {
    format: "marqum-month-snapshot/1",
    month,
    month_record: monthRecord,
    transactions,
    statements,
    balances,
    categories: ds.categories.filter((c) => catIds.has(c.id)).sort(byId),
    counterparties: ds.counterparties.filter((c) => cpIds.has(c.id)).sort(byId),
  };
  const json = JSON.stringify(canonical(doc));
  return { json, sha256: await sha256Hex(json) };
}
