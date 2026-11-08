import type { AccountId, Goal } from "@marqum/schema";
import { numericSetting } from "./dataset.ts";
import {
  categoryAverage,
  goalEta,
  goalStatusOf,
  loanStatuses,
  nextPaymentMonth,
  openLoans,
  subtreeIds,
  unachievedGoals,
  vaultFloor,
  walletPosition,
} from "./ledger.ts";
import { formatRs } from "./money.ts";
import { addMonths, monthLabel, monthOf } from "./time.ts";
import type {
  BudgetModel,
  Dataset,
  GoalStatus,
  LoanStatus,
  SplitSuggestion,
  WhatIfInput,
  WhatIfResult,
} from "./types.ts";

type Lever = { category_id: string; pct: number };

interface ModelParts {
  income: number;
  recurring: { account_id: AccountId; name: string; amount: number }[];
  installments: { name: string; amount: number }[];
  fixedUncovered: { name: string; amount: number }[];
  variableCats: { name: string; amount: number }[];
  goals: { goal: Goal; amount: number }[];
}

/** Category average with levers applied: avg + Σ (lever target's avg × pct/100) for targets in its subtree. */
function adjustedAverage(ds: Dataset, categoryId: string, month: string, levers: Lever[]): number {
  const base = categoryAverage(ds, categoryId, month).average ?? 0;
  const ids = subtreeIds(ds, categoryId);
  let adj = base;
  for (const l of levers) {
    if (!ids.has(l.category_id)) continue;
    const target =
      l.category_id === categoryId ? base : (categoryAverage(ds, l.category_id, month).average ?? 0);
    adj += (target * l.pct) / 100;
  }
  return Math.max(0, Math.round(adj));
}

function modelParts(ds: Dataset, now: string, levers: Lever[] = []): ModelParts {
  const month = monthOf(now);
  const activeRecurring = ds.recurring.filter((r) => !r.deleted && r.active);
  const recurring = activeRecurring.map((r) => ({
    account_id: r.account_id,
    name: r.name,
    amount: Math.abs(r.amount),
  }));
  const installments = openLoans(ds, now).map((l) => ({
    name: `${l.loan.purpose} loan (${l.loan.lender})`,
    amount: Math.min(l.loan.installment, l.outstanding),
  }));
  const fixedUncovered: ModelParts["fixedUncovered"] = [];
  const variableCats: ModelParts["variableCats"] = [];
  const tops = ds.categories
    .filter((c) => !c.deleted && c.parent_id === null)
    .sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id));
  for (const c of tops) {
    const amount = adjustedAverage(ds, c.id, month, levers);
    if (c.nature === "fixed") {
      const ids = subtreeIds(ds, c.id);
      const covered = activeRecurring.some((r) => r.category_id !== null && ids.has(r.category_id));
      if (!covered && amount > 0) fixedUncovered.push({ name: c.name, amount });
    } else if (amount > 0) variableCats.push({ name: c.name, amount });
  }
  const goals = unachievedGoals(ds).map((goal) => ({ goal, amount: goal.monthly }));
  return {
    income: Math.round(numericSetting(ds, "income_monthly")),
    recurring,
    installments,
    fixedUncovered,
    variableCats,
    goals,
  };
}

const sum = (xs: { amount: number }[]) => xs.reduce((s, x) => s + x.amount, 0);

function modelFromParts(ds: Dataset, p: ModelParts): BudgetModel {
  const committed = sum(p.recurring) + sum(p.installments) + sum(p.fixedUncovered);
  const variable = sum(p.variableCats);
  const goal_contributions = sum(p.goals);
  const surplus = p.income - committed - variable - goal_contributions;
  const floor = vaultFloor(ds);
  const free_savings = walletPosition(ds, "sadapay").balance - floor;
  const lines: BudgetModel["lines"] = [{ label: "Income into wallets", amount: p.income, kind: "income" }];
  if (p.recurring.length)
    lines.push({
      label: `Recurring payments (${p.recurring.length})`,
      amount: sum(p.recurring),
      kind: "committed",
    });
  for (const l of p.installments) lines.push({ label: l.name, amount: l.amount, kind: "committed" });
  for (const f of p.fixedUncovered)
    lines.push({ label: `${f.name} (average, no recurring set)`, amount: f.amount, kind: "committed" });
  for (const v of p.variableCats)
    lines.push({ label: `${v.name} (average)`, amount: v.amount, kind: "variable" });
  for (const g of p.goals) lines.push({ label: `Goal: ${g.goal.name}`, amount: g.amount, kind: "goals" });
  lines.push({ label: "Surplus", amount: surplus, kind: "surplus" });
  return { income: p.income, committed, variable, goal_contributions, surplus, floor, free_savings, lines };
}

/** Monthly budget: income − committed − variable − goal contributions = surplus. See FORMULAS.md. */
export function budgetModel(ds: Dataset, now: string, levers?: Lever[]): BudgetModel {
  return modelFromParts(ds, modelParts(ds, now, levers ?? []));
}

export function loanStatus(ds: Dataset, now: string): LoanStatus[] {
  return loanStatuses(ds, now);
}

export function goalStatus(ds: Dataset, now: string): GoalStatus[] {
  return ds.goals
    .filter((g) => !g.deleted)
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
    .map((g) => goalStatusOf(ds, g, now));
}

const monthsDiff = (a: string, b: string): number => {
  const [ay, am] = a.split("-").map(Number) as [number, number];
  const [by, bm] = b.split("-").map(Number) as [number, number];
  return (by - ay) * 12 + (bm - am);
};

/**
 * How many months each unachieved goal slips when `shortfall` per month is taken from goal contributions for
 * `duration` months, lowest-priority goals first.
 */
function goalDelays(
  ds: Dataset,
  now: string,
  shortfall: number,
  duration: number,
): WhatIfResult["goal_delays"] {
  const goals = unachievedGoals(ds);
  const cut = new Map<string, number>();
  let left = shortfall;
  for (const g of [...goals].reverse()) {
    const c = Math.min(left, g.monthly);
    cut.set(g.id, c);
    left -= c;
  }
  const NEVER = 600;
  return goals.map((g) => {
    const before = goalEta(ds, g, now);
    const reduction = cut.get(g.id) ?? 0;
    const after =
      reduction > 0 ? goalEta(ds, g, now, (k) => (k < duration ? g.monthly - reduction : g.monthly)) : before;
    let months = 0;
    if (before !== null && after !== null) months = monthsDiff(before, after);
    else if (before !== null && after === null) months = NEVER;
    return { goal_id: g.id, name: g.name, months };
  });
}

function waterfall(model: BudgetModel, planLabel: string, plan: number): WhatIfResult["waterfall"] {
  return [
    { label: "Income", amount: model.income },
    { label: "Committed", amount: -model.committed },
    { label: "Variable spending", amount: -model.variable },
    { label: "Goals", amount: -model.goal_contributions },
    { label: "Surplus", amount: model.surplus },
    { label: planLabel, amount: -plan },
    { label: "Left", amount: model.surplus - plan },
  ];
}

/**
 * Debt-free month when the new loan is added: every loan pays its installment from its next payment month
 * (the new loan from next month); money freed by a cleared loan rolls onto the next-oldest one (sequential
 * repayment at a constant monthly debt budget). null if never within 600 months.
 */
function sequentialDebtFree(
  ds: Dataset,
  existing: LoanStatus[],
  newPrincipal: number,
  newInstallment: number,
  now: string,
): string | null {
  const current = monthOf(now);
  const loans = [
    ...existing.map((l) => ({
      left: l.outstanding,
      installment: l.loan.installment,
      start: nextPaymentMonth(ds, l.loan, current),
    })),
    { left: newPrincipal, installment: newInstallment, start: addMonths(current, 1) },
  ].filter((l) => l.left > 0);
  if (loans.length === 0) return null;
  for (let k = 0, month = current; k < 600; k++, month = addMonths(month, 1)) {
    let budget = loans.filter((l) => l.start <= month).reduce((s, l) => s + l.installment, 0);
    for (const l of loans) {
      if (l.start > month || budget <= 0) continue;
      const pay = Math.min(l.left, budget);
      l.left -= pay;
      budget -= pay;
    }
    if (loans.every((l) => l.left <= 0)) return month;
  }
  return null;
}

/** What-if for a purchase of `price`: save first, or borrow over `loan_months`. See FORMULAS.md. */
export function whatIf(ds: Dataset, input: WhatIfInput, now: string): WhatIfResult {
  const current = monthOf(now);
  const model = budgetModel(ds, now, input.levers);
  const P = Math.max(0, Math.round(input.price));
  const S = model.surplus;
  const F = model.free_savings;
  const notAffordable = `Not affordable — your monthly surplus is ${formatRs(S)}`;
  const base = {
    model,
    months_to_save: null as number | null,
    ready_month: null as string | null,
    installment: null as number | null,
    debt_free_month: null as string | null,
  };

  if (input.mode === "save") {
    if (F >= P) {
      return {
        ...base,
        verdict: "now",
        headline: `Affordable now — leaves ${formatRs(F - P)} free in SadaPay`,
        months_to_save: 0,
        ready_month: current,
        goal_delays: goalDelays(ds, now, 0, 0),
        waterfall: waterfall(model, "Saving for this", 0),
      };
    }
    const need = P - Math.max(F, 0);
    if (S <= 0) {
      return {
        ...base,
        verdict: "no",
        headline: notAffordable,
        goal_delays: goalDelays(ds, now, 0, 0),
        waterfall: waterfall(model, "Saving for this", 0),
      };
    }
    const m = Math.ceil(need / S);
    const plan = Math.ceil(need / m / 100) * 100;
    const ready = addMonths(current, m);
    const verdict = m <= 1 ? "easy" : m <= 6 ? "stretch" : "no";
    const plural = m === 1 ? "month" : "months";
    const headline =
      verdict === "no"
        ? `Not affordable within 6 months — saving ${formatRs(plan)}/month takes ${m} months (ready ${monthLabel(ready)})`
        : `Save ${formatRs(plan)}/month for ${m} ${plural} — ready ${monthLabel(ready)}`;
    return {
      ...base,
      verdict,
      headline,
      months_to_save: m,
      ready_month: ready,
      // plan ≤ S by construction (up to rupee rounding), so goals are untouched while saving
      goal_delays: goalDelays(ds, now, 0, m),
      waterfall: waterfall(model, "Saving for this", plan),
    };
  }

  const n = Math.max(1, Math.round(input.loan_months ?? 1));
  const installment = Math.ceil(P / n / 100) * 100;
  const existing = openLoans(ds, now);
  const debt_free_month = sequentialDebtFree(ds, existing, P, installment, now);
  const verdict = S <= 0 ? "no" : installment <= S * 0.5 ? "easy" : installment <= S ? "stretch" : "no";
  let headline: string;
  if (S <= 0) headline = notAffordable;
  else if (verdict === "no")
    headline = `Not affordable — ${formatRs(installment)}/month is more than your ${formatRs(S)} monthly surplus`;
  else
    headline = `${formatRs(installment)}/month over ${n} ${n === 1 ? "month" : "months"} — debt-free by ${
      debt_free_month ? monthLabel(debt_free_month) : "never"
    }`;
  return {
    ...base,
    verdict,
    headline,
    installment,
    debt_free_month,
    goal_delays: goalDelays(ds, now, Math.max(0, installment - Math.max(S, 0)), n),
    waterfall: waterfall(model, "Loan installment", installment),
  };
}

/**
 * How to split the monthly income: SadaPay gets everything committed that lives there (SadaPay recurring, loan
 * installments, fixed bills without a recurring row) plus goal contributions; NayaPay gets the rest (floor 0).
 */
export function suggestedSplit(ds: Dataset, now: string): SplitSuggestion {
  const p = modelParts(ds, now);
  const lines: SplitSuggestion["lines"] = [];
  const sadaRecurring = p.recurring.filter((r) => r.account_id === "sadapay");
  if (sadaRecurring.length)
    lines.push({
      account_id: "sadapay",
      label: `Recurring payments from SadaPay (${sadaRecurring.length})`,
      amount: sum(sadaRecurring),
    });
  for (const l of p.installments) lines.push({ account_id: "sadapay", label: l.name, amount: l.amount });
  for (const f of p.fixedUncovered)
    lines.push({ account_id: "sadapay", label: `${f.name} (average bills)`, amount: f.amount });
  if (p.goals.length)
    lines.push({
      account_id: "sadapay",
      label: `Goal contributions (${p.goals.length})`,
      amount: sum(p.goals),
    });
  const sadapay = lines.reduce((s, l) => s + l.amount, 0);
  const nayapay = Math.max(0, p.income - sadapay);
  lines.push({ account_id: "nayapay", label: "Everyday spending (the rest)", amount: nayapay });
  return { sadapay, nayapay, lines };
}
