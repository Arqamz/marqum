import type { AccountId, Category, Goal } from "@marqum/schema";
import { numericSetting, setting, trackingStartMonth } from "./dataset.ts";
import {
  categoryAverage,
  categoryMonthlySpend,
  firstDataMonth,
  goalEta,
  goalSaved,
  goalStatusOf,
  loanStatuses,
  nextContributionMonth,
  nextPaymentMonth,
  openLoans,
  subtreeIds,
  unachievedGoals,
  vaultFloor,
  walletPosition,
} from "./ledger.ts";
import { formatRs } from "./money.ts";
import { addMonths, monthLabel, monthOf, monthsBetween } from "./time.ts";
import type {
  Allocation,
  BudgetModel,
  Dataset,
  ForecastAssumptions,
  GoalStatus,
  LoanStatus,
  PlannedCategory,
  ProjectionMonth,
  SplitSuggestion,
  WhatIfInput,
  WhatIfResult,
} from "./types.ts";

type Lever = { category_id: string; pct: number };

const sum = (xs: { amount: number }[]) => xs.reduce((s, x) => s + x.amount, 0);
const roundUpRupee = (paisa: number) => Math.ceil(paisa / 100) * 100;
const monthsDiff = (a: string, b: string): number => {
  const [ay, am] = a.split("-").map(Number) as [number, number];
  const [by, bm] = b.split("-").map(Number) as [number, number];
  return (by - ay) * 12 + (bm - am);
};

// ───────────────────────── planned spend ─────────────────────────

/** Planned monthly spend of one category on its own: budget ?? average ?? 0. */
function basePlan(
  ds: Dataset,
  cat: Category,
  month: string,
): { amount: number; source: PlannedCategory["source"] } {
  if (cat.budget != null) return { amount: cat.budget, source: "budget" };
  const avg = categoryAverage(ds, cat.id, month).average;
  if (avg !== null) return { amount: avg, source: "average" };
  return { amount: 0, source: "none" };
}

const activeRecurring = (ds: Dataset) => ds.recurring.filter((r) => !r.deleted && r.active);

/** true when an active fixed charge (Recurring) is tagged with the category or one of its subcategories */
function coveredByRecurring(ds: Dataset, categoryId: string): boolean {
  const ids = subtreeIds(ds, categoryId);
  return activeRecurring(ds).some((r) => r.category_id !== null && ids.has(r.category_id));
}

/**
 * Planned monthly spend per top-level category: budget ?? average ?? 0, then levers (avg + target plan × pct/100
 * for each lever on the category or a subcategory). Fixed categories covered by Recurring rows are reported with
 * source "recurring" and are not counted again.
 */
export function plannedCategories(ds: Dataset, now: string, levers: Lever[] = []): PlannedCategory[] {
  const month = monthOf(now);
  const cats = ds.categories.filter((c) => !c.deleted);
  return cats
    .filter((c) => c.parent_id === null)
    .sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id))
    .map((c) => {
      const base = basePlan(ds, c, month);
      const ids = subtreeIds(ds, c.id);
      let planned = base.amount;
      for (const l of levers) {
        if (!ids.has(l.category_id)) continue;
        const target = cats.find((x) => x.id === l.category_id);
        const t = l.category_id === c.id || !target ? base.amount : basePlan(ds, target, month).amount;
        planned += (t * l.pct) / 100;
      }
      planned = Math.max(0, Math.round(planned));
      const source = c.nature === "fixed" && coveredByRecurring(ds, c.id) ? "recurring" : base.source;
      return { category_id: c.id, name: c.name, nature: c.nature, planned, source };
    });
}

interface ModelParts {
  income: number;
  recurring: { account_id: AccountId; name: string; amount: number }[];
  installments: { name: string; amount: number }[];
  fixedUncovered: { category_id: string; name: string; amount: number; source: string }[];
  variableCats: { category_id: string; name: string; amount: number; source: string }[];
  goals: { goal: Goal; amount: number }[];
  categories: PlannedCategory[];
}

function modelParts(ds: Dataset, now: string, levers: Lever[] = []): ModelParts {
  const categories = plannedCategories(ds, now, levers);
  const fixedUncovered: ModelParts["fixedUncovered"] = [];
  const variableCats: ModelParts["variableCats"] = [];
  for (const c of categories) {
    if (c.planned <= 0 || c.source === "recurring") continue;
    const row = { category_id: c.category_id, name: c.name, amount: c.planned, source: c.source };
    if (c.nature === "fixed") fixedUncovered.push(row);
    else variableCats.push(row);
  }
  return {
    income: Math.round(numericSetting(ds, "income_monthly")),
    recurring: activeRecurring(ds).map((r) => ({
      account_id: r.account_id,
      name: r.name,
      amount: Math.abs(r.amount),
    })),
    installments: openLoans(ds, now).map((l) => ({
      name: `${l.loan.purpose} loan (${l.loan.lender})`,
      amount: Math.min(l.loan.installment, l.outstanding),
    })),
    fixedUncovered,
    variableCats,
    goals: unachievedGoals(ds).map((goal) => ({ goal, amount: goal.monthly })),
    categories,
  };
}

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
      label: `Fixed charges (${p.recurring.length})`,
      amount: sum(p.recurring),
      kind: "committed",
    });
  for (const l of p.installments) lines.push({ label: l.name, amount: l.amount, kind: "committed" });
  for (const f of p.fixedUncovered)
    lines.push({
      label: `${f.name} (${f.source}, no fixed charge set)`,
      amount: f.amount,
      kind: "committed",
    });
  for (const v of p.variableCats)
    lines.push({ label: `${v.name} (${v.source})`, amount: v.amount, kind: "variable" });
  for (const g of p.goals) lines.push({ label: `Goal: ${g.goal.name}`, amount: g.amount, kind: "goals" });
  lines.push({ label: "Surplus", amount: surplus, kind: "surplus" });
  return {
    income: p.income,
    committed,
    variable,
    goal_contributions,
    surplus,
    floor,
    free_savings,
    lines,
    categories: p.categories,
  };
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

// ───────────────────────── allocation ─────────────────────────

/**
 * Suggested monthly split of income: SadaPay gets its fixed charges, loan installments, goal contributions and the
 * planned spend of SadaPay categories not covered by fixed charges; NayaPay the rest. With nothing to go on, 50/50.
 */
export function suggestedSplit(ds: Dataset, now: string): SplitSuggestion {
  const p = modelParts(ds, now);
  const lines: SplitSuggestion["lines"] = [];
  const sadaRecurring = p.recurring.filter((r) => r.account_id === "sadapay");
  if (sadaRecurring.length)
    lines.push({
      account_id: "sadapay",
      label: `Fixed charges from SadaPay (${sadaRecurring.length})`,
      amount: sum(sadaRecurring),
    });
  for (const l of p.installments) lines.push({ account_id: "sadapay", label: l.name, amount: l.amount });
  if (p.goals.length)
    lines.push({
      account_id: "sadapay",
      label: `Goal contributions (${p.goals.length})`,
      amount: sum(p.goals),
    });
  const hints = new Map(ds.categories.map((c) => [c.id, c.wallet_hint]));
  for (const c of p.categories) {
    if (c.source === "recurring" || c.planned <= 0 || hints.get(c.category_id) !== "sadapay") continue;
    lines.push({ account_id: "sadapay", label: `${c.name} (${c.source})`, amount: c.planned });
  }
  let sadapay = lines.reduce((s, l) => s + l.amount, 0);
  if (sadapay === 0) {
    sadapay = roundUpRupee(Math.floor(p.income / 2));
    lines.push({
      account_id: "sadapay",
      label: "Add your fixed charges to get a real suggestion",
      amount: sadapay,
    });
  }
  sadapay = Math.min(sadapay, p.income);
  const nayapay = Math.max(0, p.income - sadapay);
  lines.push({ account_id: "nayapay", label: "Everyday spending (the rest)", amount: nayapay });
  return { sadapay, nayapay, lines };
}

/** How income is split between the wallets: the user's setting `allocation_sadapay` if set, else the suggestion. */
export function allocation(ds: Dataset, now: string): Allocation {
  const income = Math.round(numericSetting(ds, "income_monthly"));
  const suggested = suggestedSplit(ds, now);
  const raw = setting(ds, "allocation_sadapay");
  if (/^\d+$/.test(raw)) {
    const sadapay = Math.min(Number(raw), income);
    return { income, sadapay, nayapay: income - sadapay, source: "user", suggested };
  }
  return { income, sadapay: suggested.sadapay, nayapay: suggested.nayapay, source: "suggested", suggested };
}

// ───────────────────────── forecast ─────────────────────────

const DEFAULT_ASSUMPTIONS: ForecastAssumptions = {
  horizon_months: 12,
  income: [],
  spend_adjust_pct: 0,
  category_adjust: [],
  one_offs: [],
  uncertainty: "normal",
};

const MONTH = /^\d{4}-\d{2}$/;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.map(rec) : []);

/** Keep only the well-formed parts of a (possibly partial or junk) assumptions object. */
function sanitize(v: unknown): Partial<ForecastAssumptions> {
  const o = rec(v);
  const out: Partial<ForecastAssumptions> = {};
  if (isNum(o.horizon_months)) out.horizon_months = Math.min(120, Math.max(1, Math.round(o.horizon_months)));
  if (Array.isArray(o.income))
    out.income = arr(o.income)
      .filter((x) => typeof x.from === "string" && MONTH.test(x.from) && isNum(x.amount))
      .map((x) => ({ from: x.from as string, amount: Math.round(x.amount as number) }));
  if (isNum(o.spend_adjust_pct)) out.spend_adjust_pct = o.spend_adjust_pct;
  if (Array.isArray(o.category_adjust))
    out.category_adjust = arr(o.category_adjust)
      .filter((x) => typeof x.category_id === "string" && isNum(x.pct))
      .map((x) => ({ category_id: x.category_id as string, pct: x.pct as number }));
  if (Array.isArray(o.one_offs))
    out.one_offs = arr(o.one_offs)
      .filter((x) => typeof x.month === "string" && MONTH.test(x.month) && isNum(x.amount))
      .map((x) => ({
        month: x.month as string,
        amount: Math.round(x.amount as number),
        label: typeof x.label === "string" ? x.label : "",
      }));
  if (o.uncertainty === "low" || o.uncertainty === "normal" || o.uncertainty === "high")
    out.uncertainty = o.uncertainty;
  return out;
}

/** Assumptions from setting `forecast` (lenient JSON: malformed parts fall back to defaults). */
export function defaultAssumptions(ds: Dataset, _now: string): ForecastAssumptions {
  let parsed: unknown = {};
  try {
    parsed = JSON.parse(setting(ds, "forecast") || "{}");
  } catch {
    parsed = {};
  }
  return { ...DEFAULT_ASSUMPTIONS, ...sanitize(parsed) };
}

function resolveAssumptions(
  ds: Dataset,
  now: string,
  over?: Partial<ForecastAssumptions>,
): ForecastAssumptions {
  return { ...defaultAssumptions(ds, now), ...sanitize(over ?? {}) };
}

const SPREAD_PCT = { low: 0.05, normal: 0.15, high: 0.3 } as const;
const SPREAD_FACTOR = { low: 0.5, normal: 1, high: 1.5 } as const;

/**
 * Spread of monthly variable spend: with ≥ 3 complete tracked months, the standard deviation of their variable
 * totals (at least 5% of expected) × 0.5/1/1.5 by uncertainty; otherwise 5%/15%/30% of expected.
 */
function variableSpread(
  ds: Dataset,
  now: string,
  expected: number,
  uncertainty: ForecastAssumptions["uncertainty"],
) {
  const current = monthOf(now);
  const first = firstDataMonth(ds);
  const start = trackingStartMonth(ds);
  const from = first && first > start ? first : start;
  const months = monthsBetween(from, addMonths(current, -1)).slice(-12);
  if (first === null || months.length < 3) return expected * SPREAD_PCT[uncertainty];
  const variableTops = ds.categories.filter(
    (c) => !c.deleted && c.parent_id === null && c.nature === "variable",
  );
  const series = variableTops.map((c) => categoryMonthlySpend(ds, c.id));
  const totals = months.map((m) => series.reduce((s, mp) => s + (mp.get(m) ?? 0), 0));
  const mean = totals.reduce((s, v) => s + v, 0) / totals.length;
  const std = Math.sqrt(totals.reduce((s, v) => s + (v - mean) ** 2, 0) / totals.length);
  return Math.max(std, expected * 0.05) * SPREAD_FACTOR[uncertainty];
}

interface SimLoan {
  left: number;
  due: (month: string, left: number) => number;
}

interface ProjectionExtra {
  loans?: SimLoan[];
  /** applied to the starting free savings (e.g. −price when buying now) */
  start_adjust?: number;
  one_offs?: { month: string; amount: number }[];
  months?: number;
}

function existingLoanSims(ds: Dataset, now: string): SimLoan[] {
  const current = monthOf(now);
  return openLoans(ds, now).map((l) => {
    const start = nextPaymentMonth(ds, l.loan, current);
    // this month's installment, if still due, is paid from this month's money (projection starts next month)
    const thisMonth = start === current ? Math.min(l.loan.installment, l.outstanding) : 0;
    return {
      left: l.outstanding - thisMonth,
      due: (m, left) => (m >= start ? Math.min(l.loan.installment, left) : 0),
    };
  });
}

function projectWith(ds: Dataset, now: string, a: ForecastAssumptions, extra: ProjectionExtra = {}) {
  const current = monthOf(now);
  const p = modelParts(ds, now, a.category_adjust);
  const baseIncome = p.income;
  const fixed = sum(p.recurring) + sum(p.fixedUncovered);
  const variableExpected = Math.round(sum(p.variableCats) * (1 + a.spend_adjust_pct / 100));
  const spread = Math.round(variableSpread(ds, now, variableExpected, a.uncertainty));
  const variable = {
    expected: variableExpected,
    low: Math.max(0, variableExpected - spread),
    high: variableExpected + spread,
  };
  const goals = p.goals.map((g) => {
    const start = nextContributionMonth(ds, g.goal, current);
    const left = Math.max(0, g.goal.target - goalSaved(ds, g.goal.id));
    // this month's contribution, if not made yet, comes from this month's money
    return { g: g.goal, left: start === current ? Math.max(0, left - g.goal.monthly) : left, start };
  });
  const loans = [...existingLoanSims(ds, now), ...(extra.loans ?? [])].map((l) => ({ ...l }));
  const incomeSteps = [...a.income].sort((x, y) => x.from.localeCompare(y.from));
  const oneOffs = [...a.one_offs, ...(extra.one_offs ?? [])];
  const free = vaultFloor(ds);
  const startSavings = walletPosition(ds, "sadapay").balance - free + (extra.start_adjust ?? 0);
  const savings = { expected: startSavings, low: startSavings, high: startSavings };
  const out: ProjectionMonth[] = [];
  const n = extra.months ?? a.horizon_months;
  for (let k = 1; k <= n; k++) {
    const month = addMonths(current, k);
    let income = baseIncome;
    for (const s of incomeSteps) if (s.from <= month) income = s.amount;
    let goalsDue = 0;
    for (const g of goals) {
      if (g.start > month || g.left <= 0) continue;
      const c = Math.min(g.g.monthly, g.left);
      g.left -= c;
      goalsDue += c;
    }
    let loansDue = 0;
    for (const l of loans) {
      const d = Math.max(0, Math.min(l.left, l.due(month, l.left)));
      l.left -= d;
      loansDue += d;
    }
    const one = oneOffs.filter((o) => o.month === month).reduce((s, o) => s + o.amount, 0);
    const base = income - fixed - goalsDue - loansDue + one;
    const surplus = {
      expected: base - variable.expected,
      low: base - variable.high,
      high: base - variable.low,
    };
    savings.expected += surplus.expected;
    savings.low += surplus.low;
    savings.high += surplus.high;
    out.push({
      month,
      income,
      fixed,
      variable: { ...variable },
      goals: goalsDue,
      loans: loansDue,
      one_offs: one,
      surplus,
      savings: { ...savings },
      debt: loans.reduce((s, l) => s + l.left, 0),
    });
  }
  return out;
}

/**
 * Month-by-month projection from next month for `horizon_months`: income (with step changes), fixed charges,
 * variable spend band, goal contributions, loan installments, one-offs, surplus band, cumulative free savings band
 * and debt. See FORMULAS.md › Projection.
 */
export function project(
  ds: Dataset,
  now: string,
  assumptions?: Partial<ForecastAssumptions>,
): ProjectionMonth[] {
  return projectWith(ds, now, resolveAssumptions(ds, now, assumptions));
}

// ───────────────────────── what-if ─────────────────────────

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

/** "Feb and Apr 2027", "Dec 2026 and Feb 2027" */
function rangeLabel(a: string, b: string): string {
  const [ma, ya] = monthLabel(a).split(" ");
  return a.slice(0, 4) === b.slice(0, 4) ? `${ma} and ${monthLabel(b)}` : `${ma} ${ya} and ${monthLabel(b)}`;
}

/** Month name alone when in the same year as `ref`, else with the year. */
const shortMonth = (m: string, ref: string) =>
  m.slice(0, 4) === ref.slice(0, 4) ? monthLabel(m).split(" ")[0] : monthLabel(m);

/** How many months saving or repaying may take and still count as affordable (the "stretch" limit). */
export const STRETCH_MONTHS = 6;

/**
 * What-if for a purchase of `price`: save first, or borrow (fixed months, fixed installment or a custom schedule).
 * Projection-based: see FORMULAS.md › What-if.
 */
export function whatIf(ds: Dataset, input: WhatIfInput, now: string): WhatIfResult {
  const current = monthOf(now);
  const a = resolveAssumptions(ds, now, input.assumptions);
  const levers = [...a.category_adjust, ...(input.levers ?? [])];
  const assumptions = { ...a, category_adjust: levers };
  const model = budgetModel(ds, now, levers);
  const P = Math.max(0, Math.round(input.price));
  const S = model.surplus;
  const F = model.free_savings;
  const notAffordable = `Not affordable — your monthly surplus is ${formatRs(S)}`;
  const empty = { best: null, expected: null, worst: null };

  if (input.mode === "save") {
    const earliest = input.start_month && input.start_month > current ? input.start_month : current;
    if (F >= P && earliest === current) {
      return {
        verdict: "now",
        headline: `Affordable now — leaves ${formatRs(F - P)} free in SadaPay`,
        model,
        months_to_save: 0,
        ready_month: current,
        installment: null,
        debt_free_month: null,
        goal_delays: goalDelays(ds, now, 0, 0),
        waterfall: waterfall(model, "Saving for this", 0),
        projection: projectWith(ds, now, assumptions, { start_adjust: -P }),
        ready_month_range: { best: current, expected: current, worst: current },
        risk_months: [],
        confidence: "solid",
      };
    }
    const base = projectWith(ds, now, assumptions);
    const reach = (key: "expected" | "low" | "high") =>
      base.find((m) => m.month >= earliest && m.savings[key] >= P)?.month ?? null;
    const range = { best: reach("high"), expected: reach("expected"), worst: reach("low") };
    const m = range.expected ? monthsDiff(current, range.expected) : null;
    const verdict = m === null ? "no" : m <= 1 ? "easy" : m <= STRETCH_MONTHS ? "stretch" : "no";
    const works = (r: string | null) => r !== null && monthsDiff(current, r) <= STRETCH_MONTHS;
    const confidence = works(range.worst)
      ? "solid"
      : works(range.expected)
        ? "likely"
        : works(range.best)
          ? "risky"
          : "no";
    const need = P - Math.max(F, 0);
    const plan = m ? roundUpRupee(need / Math.max(1, m)) : 0;
    let headline: string;
    if (range.expected === null) {
      if (S <= 0 && range.best === null) headline = notAffordable;
      else if (range.best)
        headline = `Only if spending stays low — ready ${monthLabel(range.best)} at best; not within ${a.horizon_months} months otherwise`;
      else headline = `Not affordable within ${a.horizon_months} months at your expected surplus`;
    } else if (verdict === "no") {
      headline = `Not within ${STRETCH_MONTHS} months — ${
        range.worst && range.worst !== range.expected
          ? `ready between ${rangeLabel(range.best ?? range.expected, range.worst)} (most likely ${shortMonth(range.expected, range.worst)})`
          : `ready ${monthLabel(range.expected)} at ${formatRs(plan)}/month`
      }`;
    } else if (range.best === range.expected && range.expected === range.worst) {
      headline = `Ready by ${monthLabel(range.expected)} — save ${formatRs(plan)}/month`;
    } else if (range.worst === null) {
      headline = `Ready from ${monthLabel(range.best ?? range.expected)} (most likely ${shortMonth(range.expected, range.best ?? range.expected)}); a run of bad months could push it past ${monthLabel(addMonths(current, a.horizon_months))}`;
    } else {
      headline = `Ready between ${rangeLabel(range.best ?? range.expected, range.worst)} (most likely ${shortMonth(range.expected, range.worst)})`;
    }
    return {
      verdict,
      headline,
      model,
      months_to_save: m,
      ready_month: range.expected,
      installment: null,
      debt_free_month: null,
      goal_delays: goalDelays(ds, now, 0, m ?? 0),
      waterfall: waterfall(model, "Saving for this", plan),
      projection: range.expected
        ? projectWith(ds, now, assumptions, { one_offs: [{ month: range.expected, amount: -P }] })
        : base,
      ready_month_range: range,
      risk_months: [],
      confidence,
    };
  }

  // ── loan ──
  const start = input.start_month && input.start_month > current ? input.start_month : addMonths(current, 1);
  let schedule: Map<string, number>;
  let installment: number;
  let label: string;
  if (input.schedule?.length) {
    schedule = new Map();
    for (const s of input.schedule)
      schedule.set(s.month, (schedule.get(s.month) ?? 0) + Math.max(0, s.amount));
    installment = Math.max(...schedule.values());
    label = `Your ${schedule.size}-payment schedule`;
  } else {
    installment = input.installment
      ? roundUpRupee(Math.max(1, input.installment))
      : roundUpRupee(P / Math.max(1, Math.round(input.loan_months ?? 1)));
    const n = Math.max(1, Math.ceil(P / installment));
    schedule = new Map();
    let left = P;
    for (let k = 0; k < n; k++) {
      const pay = Math.min(installment, left);
      schedule.set(addMonths(start, k), pay);
      left -= pay;
    }
    label = `${formatRs(installment)}/month over ${n} ${n === 1 ? "month" : "months"}`;
  }
  const scheduled = [...schedule.values()].reduce((s, v) => s + v, 0);
  const lastMonth = [...schedule.keys()].sort().at(-1) ?? start;
  const months = Math.min(120, Math.max(a.horizon_months, monthsDiff(current, lastMonth)));
  const newLoan: SimLoan = { left: P, due: (m) => schedule.get(m) ?? 0 };
  const projection = projectWith(ds, now, assumptions, { loans: [newLoan], months });

  // debt-free: every loan at its own schedule, simulated well past the horizon
  const longRun = projectWith(
    ds,
    now,
    { ...assumptions, one_offs: [] },
    { loans: [{ ...newLoan }], months: 600 },
  );
  const debt_free_month = longRun.find((m) => m.debt === 0)?.month ?? null;

  const repayMonths = projection.filter((m) => (schedule.get(m.month) ?? 0) > 0);
  const risk_months = repayMonths.filter((m) => m.surplus.low < 0).map((m) => m.month);
  const all = (key: "expected" | "low" | "high") => repayMonths.every((m) => m.surplus[key] >= 0);
  const short = scheduled < P;
  const confidence = short
    ? "no"
    : all("low")
      ? "solid"
      : all("expected")
        ? "likely"
        : all("high")
          ? "risky"
          : "no";
  const verdict =
    short || S <= 0 ? "no" : installment <= S * 0.5 ? "easy" : installment <= S ? "stretch" : "no";
  const by = debt_free_month ? monthLabel(debt_free_month) : "never";
  let headline: string;
  if (short) headline = `Your schedule repays only ${formatRs(scheduled)} of ${formatRs(P)}`;
  else if (S <= 0) headline = notAffordable;
  else if (confidence === "solid") headline = `${label} works even in a bad month — debt-free by ${by}`;
  else if (confidence === "likely")
    headline = `${label} works in a normal month; ${risk_months.length} bad ${risk_months.length === 1 ? "month" : "months"} would be tight — debt-free by ${by}`;
  else if (confidence === "risky")
    headline = `${label} only works if spending stays low — debt-free by ${by}`;
  else if (installment > S)
    headline = `Not affordable — ${formatRs(installment)}/month is more than your ${formatRs(S)} monthly surplus`;
  else headline = `Not affordable — ${label} leaves you short`;
  return {
    verdict,
    headline,
    model,
    months_to_save: null,
    ready_month: null,
    installment,
    debt_free_month,
    goal_delays: goalDelays(ds, now, Math.max(0, installment - Math.max(S, 0)), schedule.size),
    waterfall: waterfall(model, "Loan installment", installment),
    projection,
    ready_month_range: empty,
    risk_months,
    confidence,
  };
}
