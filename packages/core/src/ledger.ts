/**
 * Shared ledger math used by analytics, planning and close. Internal module: the public names are
 * re-exported from analytics.ts / planning.ts. Formulas are documented in docs/FORMULAS.md.
 */
import type { AccountId, BalanceEntry, Goal, Loan, Recurring, Transaction } from "@marqum/schema";
import { carryId, isCf, OPENING_FROM_STATEMENT, OPENING_SET_BY_YOU } from "./carry.ts";
import { numericSetting, trackingStart, trackingStartMonth } from "./dataset.ts";
import { formatRs } from "./money.ts";
import { addMonths, completeMonthsBefore, dayLabel, daysInMonth, monthOf } from "./time.ts";
import type { Dataset, GoalStatus, LoanStatus, WalletPosition } from "./types.ts";

/** Non-deleted transactions on or after tracking start. Everything before tracking start does not exist. */
export function liveTxns(ds: Dataset): Transaction[] {
  const start = `${trackingStart(ds)}T00:00`;
  return ds.transactions.filter((t) => !t.deleted && t.occurred_at >= start);
}

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
 * Spend events for a set of category ids: +spendOf for expenses tagged with one of the ids, −amount for
 * reimbursements whose linked expense is tagged with one of the ids (dated when the money came back).
 */
export function spendEvents(ds: Dataset, ids: Set<string>): { at: string; value: number }[] {
  const txns = liveTxns(ds);
  const byId = new Map(ds.transactions.map((t) => [t.id, t]));
  const out: { at: string; value: number }[] = [];
  for (const t of txns) {
    if (t.category_id && ids.has(t.category_id)) {
      const s = spendOf(t);
      if (s) out.push({ at: t.occurred_at, value: s });
    }
    if (t.flow === "reimbursement" && t.amount > 0 && t.linked_txn_id) {
      const e = byId.get(t.linked_txn_id);
      if (e?.category_id && ids.has(e.category_id)) out.push({ at: t.occurred_at, value: -t.amount });
    }
  }
  return out;
}

/** Monthly spend for a set of category ids, floored at 0 per month. */
export function monthlySpendOf(ds: Dataset, ids: Set<string>): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of spendEvents(ds, ids)) {
    const m = monthOf(e.at);
    out.set(m, (out.get(m) ?? 0) + e.value);
  }
  for (const [m, v] of out) if (v < 0) out.set(m, 0);
  return out;
}

/**
 * Monthly spend of a category subtree: Σ spendOf − Σ linked reimbursements (in the reimbursement's month),
 * floored at 0 per month.
 */
export function categoryMonthlySpend(ds: Dataset, categoryId: string): Map<string, number> {
  return monthlySpendOf(ds, subtreeIds(ds, categoryId));
}

/** First tracked month with any non-carry transaction, or null. */
export function firstDataMonth(ds: Dataset): string | null {
  let first: string | null = null;
  for (const t of liveTxns(ds)) {
    if (t.flow === "carry") continue;
    const m = monthOf(t.occurred_at);
    if (first === null || m < first) first = m;
  }
  return first;
}

/** Money you sent yourself from your bank (Arqam · Meezan → a wallet) in `month`: flow "funding" inflows. */
export function incomeIn(ds: Dataset, month: string): number {
  let sum = 0;
  for (const t of liveTxns(ds))
    if (t.flow === "funding" && t.amount > 0 && monthOf(t.occurred_at) === month) sum += t.amount;
  return sum;
}

/**
 * Monthly income = what you sent from your bank account into the wallets. Average of the complete months that had
 * any; else this month so far; else the `income_monthly` setting (a fresh install with nothing imported).
 */
export function monthlyIncome(
  ds: Dataset,
  now: string,
): {
  amount: number;
  basis: "average" | "this_month" | "setting";
  months: { month: string; amount: number }[];
} {
  const current = monthOf(now);
  const months = averageMonths(ds, current)
    .map((m) => ({ month: m, amount: incomeIn(ds, m) }))
    .filter((m) => m.amount > 0);
  if (months.length > 0)
    return {
      amount: Math.round(months.reduce((s, m) => s + m.amount, 0) / months.length),
      basis: "average",
      months,
    };
  const sofar = incomeIn(ds, current);
  if (sofar > 0) return { amount: sofar, basis: "this_month", months: [{ month: current, amount: sofar }] };
  return { amount: Math.round(numericSetting(ds, "income_monthly")), basis: "setting", months: [] };
}

/** Days tracked so far: tracking start → today inclusive (≥ 1). */
export function daysTracked(ds: Dataset, now: string): number {
  const start = Date.parse(`${trackingStart(ds)}T00:00Z`);
  const today = Date.parse(`${now.slice(0, 10)}T00:00Z`);
  return Math.max(1, Math.round((today - start) / 86_400_000) + 1);
}

/**
 * A category's usual month before there's a complete month to average: variable spending at the daily rate since
 * tracking started (total ÷ days × 30-ish days of this month); fixed spending as it stands this month.
 */
export function categoryRunRate(ds: Dataset, categoryId: string, now: string): number {
  const current = monthOf(now);
  const monthly = categoryMonthlySpend(ds, categoryId);
  const cat = ds.categories.find((c) => c.id === categoryId);
  if (cat?.nature === "fixed") return monthly.get(current) ?? 0;
  let total = 0;
  for (const [m, v] of monthly) if (m >= trackingStartMonth(ds) && m <= current) total += v;
  const days = daysTracked(ds, now);
  return Math.round((total / days) * daysInMonth(current));
}

export const averageWindow = (ds: Dataset): number => (numericSetting(ds, "avg_window") === 3 ? 3 : 6);

/**
 * Months used for averages before `month`: the window's complete months on/after tracking start and on/after
 * the first month with data.
 */
export function averageMonths(ds: Dataset, month: string): string[] {
  const first = firstDataMonth(ds);
  if (first === null) return [];
  const start = trackingStartMonth(ds);
  return completeMonthsBefore(month, averageWindow(ds)).filter((m) => m >= first && m >= start);
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

/**
 * Ledger balance at an instant: Σ tracked transactions with occurred_at ≤ at. A c/f row dated exactly `at` is
 * left out, so the balance at a month's last 23:59 is that month's closing (c/f and the next b/f cancel later).
 */
export function balanceAt(ds: Dataset, account: AccountId, at: string): number {
  let bal = 0;
  for (const t of liveTxns(ds)) {
    if (t.account_id !== account || t.occurred_at > at) continue;
    if (t.occurred_at === at && isCf(t)) continue;
    bal += t.amount;
  }
  return bal;
}

/** Balance assertions (statement/manual balance entries) on or after tracking start, oldest first. */
export function assertions(ds: Dataset, account: AccountId): BalanceEntry[] {
  const start = `${trackingStart(ds)}T00:00`;
  return ds.balances
    .filter((b) => !b.deleted && b.account_id === account && b.as_of >= start)
    .sort((a, b) => a.as_of.localeCompare(b.as_of) || a.id.localeCompare(b.id));
}

/** Σ goal envelopes (each floored at 0) + Σ active SadaPay recurring amounts (next month's bills). */
export function vaultFloor(ds: Dataset): number {
  const env = new Map<string, number>();
  for (const m of ds.goal_moves) if (!m.deleted) env.set(m.goal_id, (env.get(m.goal_id) ?? 0) + m.amount);
  let floor = 0;
  for (const v of env.values()) floor += Math.max(0, v);
  for (const r of ds.recurring)
    if (!r.deleted && r.active && r.account_id === "sadapay") floor += monthlyEquivalent(r);
  return floor;
}

/** Monthly cost of a fixed charge: monthly = amount; yearly = amount / 12 (a sinking fund set aside monthly). */
export const monthlyEquivalent = (r: Pick<Recurring, "amount" | "cadence">): number =>
  r.cadence === "yearly" ? Math.round(Math.abs(r.amount) / 12) : Math.abs(r.amount);

/** Balance you stated (manual entry) or the bank stated (notification "available balance"). */
const isStatedBalance = (b: BalanceEntry) => b.source === "manual" || b.source === "notification";

/** Latest manual/notification balance for the wallet on or after tracking start. */
export const latestStatedBalance = (ds: Dataset, account: AccountId): BalanceEntry | undefined =>
  assertions(ds, account).filter(isStatedBalance).at(-1);

/**
 * When the first tracked month's opening (b/f) is unknown and a balance was stated (by you or a notification),
 * the opening that makes the ledger agree with it: stated − Σ ledger up to that instant (excluding the b/f).
 */
export function suggestOpeningBalance(
  ds: Dataset,
  accountId: AccountId,
): { amount: number; from: string } | null {
  const bf = ds.transactions.find(
    (t) => t.id === carryId("bf", accountId, trackingStartMonth(ds)) && !t.deleted,
  );
  if (bf && bf.reason !== null) return null;
  const stated = latestStatedBalance(ds, accountId);
  if (!stated) return null;
  const amount = stated.balance - (balanceAt(ds, accountId, stated.as_of) - (bf?.amount ?? 0));
  return { amount, from: `${stated.source} ${dayLabel(stated.as_of)} ${stated.as_of.slice(11, 16)}` };
}

export type OpeningSource = "statement" | "you" | "none";

/** The first tracked month's opening (b/f) for a wallet and where it came from. */
export function openingInfo(ds: Dataset, account: AccountId): { amount: number; source: OpeningSource } {
  const bf = ds.transactions.find(
    (t) => t.id === carryId("bf", account, trackingStartMonth(ds)) && !t.deleted,
  );
  if (!bf) return { amount: 0, source: "none" };
  const source: OpeningSource =
    bf.reason === OPENING_FROM_STATEMENT ? "statement" : bf.reason === OPENING_SET_BY_YOU ? "you" : "none";
  return { amount: bf.amount, source };
}

/**
 * The opening that makes Marqūm's balance at `at` equal `balance` (what the bank app shows):
 * balance − (ledger balance at `at` − current opening). Every recorded transaction is kept as is.
 */
export function openingToMatch(ds: Dataset, account: AccountId, balance: number, at: string): number {
  return balance - (balanceAt(ds, account, at) - openingInfo(ds, account).amount);
}

function unaccountedHint(
  ds: Dataset,
  account: AccountId,
  name: string,
  gap: number,
  stated?: BalanceEntry,
): string | null {
  if (!stated || Math.abs(gap) <= 100) return null;
  const opening = suggestOpeningBalance(ds, account);
  if (opening)
    return `Opening balance not set — set ${name}'s ${dayLabel(trackingStart(ds))} opening to ${formatRs(opening.amount, { decimals: true })}?`;
  if (gap < 0)
    return stated.source === "notification"
      ? `${formatRs(-gap)} not in your notifications yet — likely fees or tax; your next statement will show it`
      : `${formatRs(-gap)} spent that isn't recorded yet — add it, or wait for the statement`;
  return `${formatRs(gap)} more than recorded — an incoming payment may be missing`;
}

export function walletPosition(ds: Dataset, account: AccountId): WalletPosition {
  const acc = ds.accounts.find((a) => a.id === account);
  const role = acc?.role ?? (account === "sadapay" ? "vault" : "pocket");
  let balance = 0;
  let provisional_delta = 0;
  for (const t of liveTxns(ds)) {
    if (t.account_id !== account) continue;
    balance += t.amount;
    if (t.status !== "verified") provisional_delta += t.amount;
  }
  const stated = latestStatedBalance(ds, account);
  const unaccounted = stated ? stated.balance - balanceAt(ds, account, stated.as_of) : 0;
  const name = acc?.name ?? account;
  let verified_until: string | null = null;
  for (const s of ds.statements)
    if (!s.deleted && s.account_id === account && (verified_until === null || s.period_to > verified_until))
      verified_until = s.period_to;
  return {
    account_id: account,
    name,
    role,
    balance,
    verified_until,
    provisional_delta,
    unaccounted,
    unaccounted_hint: unaccountedHint(ds, account, name, unaccounted, stated),
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
