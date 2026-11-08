/**
 * Shared ledger math used by analytics, planning and close. Internal module: the public names are
 * re-exported from analytics.ts / planning.ts. Formulas are documented in docs/FORMULAS.md.
 */
import type { AccountId, BalanceEntry, Goal, Loan, Transaction } from "@marqum/schema";
import { numericSetting } from "./dataset.ts";
import { addMonths, completeMonthsBefore, monthOf } from "./time.ts";
import type { Dataset, GoalStatus, LoanStatus, WalletPosition } from "./types.ts";

export const liveTxns = (ds: Dataset): Transaction[] => ds.transactions.filter((t) => !t.deleted);

/** Positive spend for spend/fee outflows, 0 otherwise. Reimbursements are handled in category math. */
export function spendOf(t: Transaction): number {
  if (t.amount >= 0) return 0;
  return t.flow === "spend" || t.flow === "fee" ? -t.amount : 0;
}

export const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
};

/** The category and all its descendants. */
export function subtreeIds(ds: Dataset, categoryId: string): Set<string> {
  const ids = new Set([categoryId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of ds.categories) {
      if (c.parent_id && ids.has(c.parent_id) && !ids.has(c.id)) {
        ids.add(c.id);
        grew = true;
      }
    }
  }
  return ids;
}

/**
 * Monthly spend of a category subtree: Σ spendOf − Σ linked reimbursements (in the reimbursement's month),
 * floored at 0 per month.
 */
export function categoryMonthlySpend(ds: Dataset, categoryId: string): Map<string, number> {
  const ids = subtreeIds(ds, categoryId);
  const txns = liveTxns(ds);
  const byId = new Map(txns.map((t) => [t.id, t]));
  const out = new Map<string, number>();
  const add = (m: string, v: number) => out.set(m, (out.get(m) ?? 0) + v);
  for (const t of txns) {
    if (t.category_id && ids.has(t.category_id)) {
      const s = spendOf(t);
      if (s) add(monthOf(t.occurred_at), s);
    }
    if (t.flow === "reimbursement" && t.amount > 0 && t.linked_txn_id) {
      const e = byId.get(t.linked_txn_id);
      if (e?.category_id && ids.has(e.category_id)) add(monthOf(t.occurred_at), -t.amount);
    }
  }
  for (const [m, v] of out) if (v < 0) out.set(m, 0);
  return out;
}

/** First month with any transaction, or null. */
export function firstDataMonth(ds: Dataset): string | null {
  let first: string | null = null;
  for (const t of liveTxns(ds)) {
    const m = monthOf(t.occurred_at);
    if (first === null || m < first) first = m;
  }
  return first;
}

export const averageWindow = (ds: Dataset): number => (numericSetting(ds, "avg_window") === 3 ? 3 : 6);

/** Months used for averages before `month`: the window's complete months on/after the first data month. */
export function averageMonths(ds: Dataset, month: string): string[] {
  const first = firstDataMonth(ds);
  if (first === null) return [];
  return completeMonthsBefore(month, averageWindow(ds)).filter((m) => m >= first);
}

export function categoryAverage(
  ds: Dataset,
  categoryId: string,
  month: string,
  monthly: Map<string, number> = categoryMonthlySpend(ds, categoryId),
): { average: number | null; months_in_average: number } {
  const months = averageMonths(ds, month);
  if (months.length === 0) return { average: null, months_in_average: 0 };
  const total = months.reduce((s, m) => s + (monthly.get(m) ?? 0), 0);
  return { average: Math.round(total / months.length), months_in_average: months.length };
}

const ANCHOR_RANK: Record<BalanceEntry["source"], number> = {
  manual: 0,
  statement_open: 1,
  statement_close: 2,
};
const byAsOf = (a: BalanceEntry, b: BalanceEntry) =>
  a.as_of.localeCompare(b.as_of) || ANCHOR_RANK[a.source] - ANCHOR_RANK[b.source] || a.id.localeCompare(b.id);

/** Σ goal envelopes (each floored at 0) + Σ active SadaPay recurring amounts (next month's bills). */
export function vaultFloor(ds: Dataset): number {
  const env = new Map<string, number>();
  for (const m of ds.goal_moves) if (!m.deleted) env.set(m.goal_id, (env.get(m.goal_id) ?? 0) + m.amount);
  let floor = 0;
  for (const v of env.values()) floor += Math.max(0, v);
  for (const r of ds.recurring)
    if (!r.deleted && r.active && r.account_id === "sadapay") floor += Math.abs(r.amount);
  return floor;
}

export function walletPosition(ds: Dataset, account: AccountId): WalletPosition {
  const acc = ds.accounts.find((a) => a.id === account);
  const role = acc?.role ?? (account === "sadapay" ? "vault" : "pocket");
  const anchors = ds.balances.filter((b) => !b.deleted && b.account_id === account).sort(byAsOf);
  const latest = anchors.at(-1) ?? null;
  const txns = liveTxns(ds).filter((t) => t.account_id === account);
  let balance = latest?.balance ?? 0;
  let provisional_delta = 0;
  for (const t of txns) {
    if (latest && t.occurred_at <= latest.as_of) continue;
    balance += t.amount;
    if (t.status !== "verified") provisional_delta += t.amount;
  }
  let unaccounted = 0;
  if (latest?.source === "manual") {
    const prev = anchors
      .slice(0, -1)
      .filter((a) => a.as_of < latest.as_of)
      .at(-1);
    if (prev) {
      let computed = prev.balance;
      for (const t of txns)
        if (t.occurred_at > prev.as_of && t.occurred_at <= latest.as_of) computed += t.amount;
      unaccounted = latest.balance - computed;
    }
  }
  let verified_until: string | null = null;
  for (const s of ds.statements)
    if (!s.deleted && s.account_id === account && (verified_until === null || s.period_to > verified_until))
      verified_until = s.period_to;
  return {
    account_id: account,
    name: acc?.name ?? account,
    role,
    balance,
    verified_until,
    provisional_delta,
    unaccounted,
    floor: role === "vault" ? vaultFloor(ds) : null,
  };
}

export function walletPositions(ds: Dataset): WalletPosition[] {
  const ids: AccountId[] = ds.accounts.length ? ds.accounts.map((a) => a.id) : ["sadapay", "nayapay"];
  return ids
    .map((id) => walletPosition(ds, id))
    .sort((a, b) =>
      a.role === b.role ? a.account_id.localeCompare(b.account_id) : a.role === "vault" ? -1 : 1,
    );
}

export function loanRepaid(ds: Dataset, loan: Loan): number {
  let repaid = loan.manual_repaid;
  for (const t of liveTxns(ds))
    if (t.loan_id === loan.id && t.flow === "loan_repay") repaid += Math.abs(t.amount);
  return repaid;
}

/** Month of the next planned payment: this month unless one was already made this month (or the loan started this month). */
export function nextPaymentMonth(ds: Dataset, loan: Loan, current: string): string {
  const paidThisMonth = liveTxns(ds).some(
    (t) => t.loan_id === loan.id && t.flow === "loan_repay" && monthOf(t.occurred_at) === current,
  );
  return paidThisMonth || monthOf(loan.started_on) >= current ? addMonths(current, 1) : current;
}

export function loanStatusOf(ds: Dataset, loan: Loan, now: string): LoanStatus {
  const current = monthOf(now);
  const repaid = loanRepaid(ds, loan);
  const outstanding = loan.closed_on ? 0 : Math.max(0, loan.principal - repaid);
  let payoff_month: string | null = null;
  if (outstanding === 0) {
    if (loan.closed_on) payoff_month = monthOf(loan.closed_on);
    else {
      const last = liveTxns(ds)
        .filter((t) => t.loan_id === loan.id && t.flow === "loan_repay")
        .map((t) => monthOf(t.occurred_at))
        .sort()
        .at(-1);
      payoff_month = last ?? current;
    }
  } else if (loan.installment > 0) {
    payoff_month = addMonths(
      nextPaymentMonth(ds, loan, current),
      Math.ceil(outstanding / loan.installment) - 1,
    );
  }
  const progress = loan.principal > 0 ? Math.min(1, Math.max(0, repaid / loan.principal)) : 1;
  return { loan, repaid, outstanding, payoff_month, progress };
}

export function loanStatuses(ds: Dataset, now: string): LoanStatus[] {
  return ds.loans
    .filter((l) => !l.deleted)
    .sort((a, b) => a.started_on.localeCompare(b.started_on) || a.id.localeCompare(b.id))
    .map((l) => loanStatusOf(ds, l, now));
}

export const openLoans = (ds: Dataset, now: string): LoanStatus[] =>
  loanStatuses(ds, now).filter((s) => s.outstanding > 0);

export function goalSaved(ds: Dataset, goalId: string): number {
  let s = 0;
  for (const m of ds.goal_moves) if (!m.deleted && m.goal_id === goalId) s += m.amount;
  return s;
}

/** Month of the next contribution: this month unless a positive move was already made this month. */
export function nextContributionMonth(ds: Dataset, goal: Goal, current: string): string {
  const moved = ds.goal_moves.some(
    (m) => !m.deleted && m.goal_id === goal.id && m.amount > 0 && monthOf(m.on) === current,
  );
  return moved ? addMonths(current, 1) : current;
}

/**
 * Month a goal is reached when contributing `monthlyAt(k)` in the k-th contribution month (k = 0, 1, …).
 * null if never within 600 months.
 */
export function goalEta(
  ds: Dataset,
  goal: Goal,
  now: string,
  monthlyAt: (k: number) => number = () => goal.monthly,
): string | null {
  const current = monthOf(now);
  if (goal.achieved_on) return monthOf(goal.achieved_on);
  let remaining = goal.target - goalSaved(ds, goal.id);
  if (remaining <= 0) return current;
  const start = nextContributionMonth(ds, goal, current);
  for (let k = 0; k < 600; k++) {
    remaining -= Math.max(0, monthlyAt(k));
    if (remaining <= 0) return addMonths(start, k);
  }
  return null;
}

export function goalStatusOf(ds: Dataset, goal: Goal, now: string): GoalStatus {
  const saved = goalSaved(ds, goal.id);
  const remaining = Math.max(0, goal.target - saved);
  const progress = goal.target > 0 ? Math.min(1, Math.max(0, saved / goal.target)) : 1;
  return { goal, saved, remaining, eta_month: goalEta(ds, goal, now), progress };
}

export const unachievedGoals = (ds: Dataset): Goal[] =>
  ds.goals
    .filter((g) => !g.deleted && g.achieved_on === null && goalSaved(ds, g.id) < g.target)
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
