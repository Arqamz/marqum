import { describe, expect, it } from "vitest";
import { applyMutations } from "../src/dataset.ts";
import {
  allocation,
  budgetModel,
  defaultAssumptions,
  goalStatus,
  loanStatus,
  plannedCategories,
  project,
  suggestedSplit,
  whatIf,
} from "../src/planning.ts";
import type { Dataset } from "../src/types.ts";
import { goal, loan, move, recurring, seeded, txn, withOpening, withRows } from "./builders.ts";

const NOW = "2026-11-15T12:00";
const rs = (n: number) => n * 100;
const set = (ds: Dataset, id: string, value: string) =>
  applyMutations(ds, [{ table: "settings", row: { id, value, version: 1, deleted: false } }]);

/**
 * Aug–Oct history (3 complete months with data; tracking from Jan 2026):
 *   Food (default Rs 30,000/mo), Car › Petrol Rs 10,000/mo (variable)
 *   Bills › Electricity Rs 4,000/mo (fixed, covered by the Guard fixed charge)
 *   Subscriptions › VPS Rs 2,000/mo (fixed, no fixed charge → counted in committed)
 * Guard fixed charge Rs 5,000 (SadaPay), loan Rs 90,000 at Rs 9,000 (next payment this month),
 * goal Bicycle Rs 10,000/mo (Rs 10,000 of 50,000 saved). SadaPay ledger balance Rs 25,000.
 */
function fixture(food = [30000, 30000, 30000], extra: Partial<Dataset> = {}): Dataset {
  const months = ["2026-08", "2026-09", "2026-10"];
  const hist = months.flatMap((m, i) => [
    txn({ occurred_at: `${m}-05T12:00`, amount: -rs(food[i] ?? 0), category_id: "food" }),
    txn({ occurred_at: `${m}-06T12:00`, amount: -rs(10000), category_id: "car.petrol" }),
    txn({
      account_id: "sadapay",
      occurred_at: `${m}-07T12:00`,
      amount: -rs(4000),
      category_id: "bills.electricity",
    }),
    txn({
      account_id: "sadapay",
      occurred_at: `${m}-08T12:00`,
      amount: -rs(2000),
      category_id: "subscriptions.vps",
    }),
  ]);
  const bike = goal({ id: "bike", name: "Bicycle", target: rs(50000), monthly: rs(10000), priority: 1 });
  // SadaPay opening 43,000 − 18,000 of Aug–Oct bills = 25,000 now
  return withRows(withOpening(seeded(), { sadapay: rs(43000) }), {
    transactions: hist,
    recurring: [recurring("Guard", rs(5000), { category_id: "bills.guard" })],
    loans: [loan({ id: "L1", principal: rs(90000), installment: rs(9000), started_on: "2026-10-01" })],
    goals: [bike],
    goal_moves: [move("bike", rs(10000), "2026-08-01")],
    ...extra,
  });
}

describe("budgetModel", () => {
  it("income − committed − variable − goals = surplus", () => {
    const m = budgetModel(fixture(), NOW);
    expect(m).toMatchObject({
      income: rs(85000),
      committed: rs(5000 + 9000 + 2000),
      variable: rs(40000),
      goal_contributions: rs(10000),
      surplus: rs(19000),
      floor: rs(10000 + 5000),
      free_savings: rs(10000),
    });
    expect(m.lines.map((l) => [l.kind, l.label, l.amount])).toEqual([
      ["income", "Income into wallets", rs(85000)],
      ["committed", "Fixed charges (1)", rs(5000)],
      ["committed", "Bicycle loan (Mom)", rs(9000)],
      ["committed", "Subscriptions (average, no fixed charge set)", rs(2000)],
      ["variable", "Car (average)", rs(10000)],
      ["variable", "Food (average)", rs(30000)],
      ["goals", "Goal: Bicycle", rs(10000)],
      ["surplus", "Surplus", rs(19000)],
    ]);
  });
  it("planned spend = budget ?? average ?? 0, with its source", () => {
    const ds = fixture();
    const withBudget = {
      ...ds,
      categories: ds.categories.map((c) => (c.id === "food" ? { ...c, budget: rs(25000) } : c)),
    };
    const cats = new Map(plannedCategories(withBudget, NOW).map((c) => [c.category_id, c]));
    expect(cats.get("food")).toMatchObject({ planned: rs(25000), source: "budget" });
    expect(cats.get("car")).toMatchObject({ planned: rs(10000), source: "average" });
    expect(cats.get("bills")).toMatchObject({ source: "recurring" });
    expect(cats.get("charity")).toMatchObject({ planned: 0, source: "average" }); // history says 0
    const fresh = new Map(plannedCategories(seeded("2026-11-01"), NOW).map((c) => [c.category_id, c]));
    expect(fresh.get("charity")).toMatchObject({ planned: 0, source: "none" });
    expect(budgetModel(withBudget, NOW).variable).toBe(rs(35000));
  });
  it("levers adjust planned spend, including via a subcategory", () => {
    expect(budgetModel(fixture(), NOW, [{ category_id: "food", pct: -50 }]).surplus).toBe(rs(34000));
    expect(budgetModel(fixture(), NOW, [{ category_id: "car.petrol", pct: -100 }]).variable).toBe(rs(30000));
  });
});

describe("allocation", () => {
  it("suggests SadaPay = fixed charges + installments + goals + SadaPay categories not covered", () => {
    const a = allocation(fixture(), NOW);
    expect(a).toMatchObject({
      income: rs(85000),
      sadapay: rs(26000),
      nayapay: rs(59000),
      source: "suggested",
    });
    expect(a.suggested.lines.map((l) => [l.account_id, l.label, l.amount])).toEqual([
      ["sadapay", "Fixed charges from SadaPay (1)", rs(5000)],
      ["sadapay", "Bicycle loan (Mom)", rs(9000)],
      ["sadapay", "Goal contributions (1)", rs(10000)],
      ["sadapay", "Subscriptions (average)", rs(2000)],
      ["nayapay", "Everyday spending (the rest)", rs(59000)],
    ]);
    expect(suggestedSplit(fixture(), NOW)).toEqual(a.suggested);
  });
  it("uses the user's allocation when set", () => {
    expect(allocation(set(fixture(), "allocation_sadapay", String(rs(30000))), NOW)).toMatchObject({
      sadapay: rs(30000),
      nayapay: rs(55000),
      source: "user",
    });
  });
  it("falls back to SadaPay category budgets, then to 50/50 — never a silent 0", () => {
    const empty = seeded("2026-11-01");
    const budgets = {
      ...empty,
      categories: empty.categories.map((c) => (c.id === "bills" ? { ...c, budget: rs(12000) } : c)),
    };
    expect(allocation(budgets, NOW)).toMatchObject({ sadapay: rs(12000), nayapay: rs(73000) });
    const a = allocation(empty, NOW);
    expect(a).toMatchObject({ sadapay: rs(42500), nayapay: rs(42500), source: "suggested" });
    expect(a.suggested.lines[0]?.label).toBe("Add your fixed charges to get a real suggestion");
  });
});

describe("forecast assumptions & projection", () => {
  it("parses the forecast setting leniently", () => {
    expect(defaultAssumptions(seeded(), NOW)).toEqual({
      horizon_months: 12,
      income: [],
      spend_adjust_pct: 0,
      category_adjust: [],
      one_offs: [],
      uncertainty: "normal",
    });
    const ds = set(
      seeded(),
      "forecast",
      JSON.stringify({
        horizon_months: 6,
        income: [{ from: "2027-01", amount: 1 }, { from: "bad" }],
        uncertainty: "x",
      }),
    );
    expect(defaultAssumptions(ds, NOW)).toMatchObject({
      horizon_months: 6,
      income: [{ from: "2027-01", amount: 1 }],
      uncertainty: "normal",
    });
    expect(defaultAssumptions(set(seeded(), "forecast", "{not json"), NOW).horizon_months).toBe(12);
  });
  it("projects month by month: goals stop when reached, installments until the loan is repaid", () => {
    const p = project(fixture(), NOW);
    expect(p).toHaveLength(12);
    expect(p[0]).toMatchObject({
      month: "2026-12",
      income: rs(85000),
      fixed: rs(7000),
      goals: rs(10000),
      loans: rs(9000),
      surplus: { expected: rs(19000) },
      savings: { expected: rs(29000) },
      debt: rs(72000),
    });
    // Bicycle: this month's 10,000 + Dec, Jan, Feb → reached; from Mar the surplus grows by 10,000
    expect(p[3]).toMatchObject({ month: "2027-03", goals: 0, surplus: { expected: rs(29000) } });
    // loan: Nov (this month) + Dec…Aug → cleared in Aug 2027
    expect(p[8]).toMatchObject({ month: "2027-08", loans: rs(9000), debt: 0 });
    expect(p[9]).toMatchObject({ month: "2027-09", loans: 0 });
  });
  it("variable band: std-dev of history (≥ 3 months, min 5%), scaled by uncertainty", () => {
    // flat history → 5% floor: 40,000 ± 2,000
    expect(project(fixture(), NOW)[0]?.variable).toEqual({
      expected: rs(40000),
      low: rs(38000),
      high: rs(42000),
    });
    // Food 20k/30k/40k → monthly totals 30k/40k/50k → σ = 8,164.97
    const v = project(fixture([20000, 30000, 40000]), NOW)[0]?.variable;
    expect(v?.expected).toBe(rs(40000));
    expect(v?.high).toBe(rs(40000) + 816497);
    const hi = project(fixture([20000, 30000, 40000]), NOW, { uncertainty: "high" })[0]?.variable;
    expect(Math.abs((hi?.high ?? 0) - (rs(40000) + 816497 * 1.5))).toBeLessThanOrEqual(1);
  });
  it("thin history: ±5% / ±15% / ±30% of expected", () => {
    const ds = seeded("2026-11-01");
    const fresh = {
      ...ds,
      categories: ds.categories.map((c) => (c.id === "food" ? { ...c, budget: rs(20000) } : c)),
    };
    expect(project(fresh, NOW)[0]?.variable).toEqual({
      expected: rs(20000),
      low: rs(17000),
      high: rs(23000),
    });
    expect(project(fresh, NOW, { uncertainty: "low" })[0]?.variable.high).toBe(rs(21000));
    expect(project(fresh, NOW, { uncertainty: "high" })[0]?.variable.high).toBe(rs(26000));
  });
  it("applies income steps, spend adjustment and one-offs", () => {
    const p = project(fixture(), NOW, {
      horizon_months: 3,
      income: [{ from: "2027-01", amount: rs(95000) }],
      spend_adjust_pct: -10,
      one_offs: [{ month: "2027-02", amount: -rs(5000), label: "Wedding gift" }],
    });
    expect(p.map((m) => [m.month, m.income, m.variable.expected, m.one_offs])).toEqual([
      ["2026-12", rs(85000), rs(36000), 0],
      ["2027-01", rs(95000), rs(36000), 0],
      ["2027-02", rs(95000), rs(36000), -rs(5000)],
    ]);
    expect(p[2]?.surplus.expected).toBe(rs(95000 - 7000 - 36000 - 10000 - 9000 - 5000));
  });
});

describe("whatIf: save", () => {
  const ds = fixture();
  it("now — free savings cover it", () => {
    expect(whatIf(ds, { price: rs(8000), mode: "save" }, NOW)).toMatchObject({
      verdict: "now",
      confidence: "solid",
      headline: "Affordable now — leaves Rs 2,000 free in SadaPay",
      months_to_save: 0,
      ready_month: "2026-11",
      ready_month_range: { best: "2026-11", expected: "2026-11", worst: "2026-11" },
    });
  });
  it("easy / stretch with a tight band", () => {
    expect(whatIf(ds, { price: rs(25000), mode: "save" }, NOW)).toMatchObject({
      verdict: "easy",
      confidence: "solid",
      months_to_save: 1,
      ready_month: "2026-12",
      headline: "Ready by Dec 2026 — save Rs 15,000/month",
    });
    const r = whatIf(ds, { price: rs(60000), mode: "save" }, NOW);
    expect(r).toMatchObject({
      verdict: "stretch",
      months_to_save: 3,
      ready_month: "2027-02",
      headline: "Ready by Feb 2027 — save Rs 16,667/month",
    });
    expect(r.goal_delays).toEqual([{ goal_id: "bike", name: "Bicycle", months: 0 }]);
    // the purchase is applied in the expected month
    expect(r.projection.find((m) => m.month === "2027-02")?.one_offs).toBe(-rs(60000));
  });
  it("a range when spending varies, and confidence from the bad case", () => {
    const v = fixture([20000, 30000, 40000]);
    const r = whatIf(v, { price: rs(60000), mode: "save" }, NOW);
    expect(r).toMatchObject({
      verdict: "stretch",
      confidence: "solid",
      ready_month_range: { best: "2027-01", expected: "2027-02", worst: "2027-03" },
      headline: "Ready between Jan and Mar 2027 (most likely Feb)",
    });
    expect(whatIf(v, { price: rs(120000), mode: "save" }, NOW)).toMatchObject({
      confidence: "likely",
      ready_month_range: { best: "2027-03", expected: "2027-04", worst: "2027-06" },
    });
  });
  it("no — more than 6 months, and the headline says so", () => {
    expect(whatIf(ds, { price: rs(200000), mode: "save" }, NOW)).toMatchObject({
      verdict: "no",
      confidence: "no",
      months_to_save: 8,
      headline: "Not within 6 months — ready between Jul and Aug 2027 (most likely Jul)",
    });
  });
  it("no — surplus ≤ 0", () => {
    const poor = set(ds, "income_monthly", String(rs(30000)));
    expect(whatIf(poor, { price: rs(20000), mode: "save" }, NOW)).toMatchObject({
      verdict: "no",
      confidence: "no",
      months_to_save: null,
      ready_month: null,
      headline: "Not affordable — your monthly surplus is −Rs 36,000",
    });
  });
  it("levers and assumptions change the result", () => {
    const r = whatIf(
      ds,
      { price: rs(60000), mode: "save", levers: [{ category_id: "food", pct: -50 }] },
      NOW,
    );
    expect(r).toMatchObject({ verdict: "stretch", months_to_save: 2 });
    expect(r.model.variable).toBe(rs(25000));
    const later = whatIf(ds, { price: rs(25000), mode: "save", start_month: "2027-03" }, NOW);
    expect(later.ready_month).toBe("2027-03");
  });
});

describe("whatIf: loan", () => {
  const ds = fixture();
  it("solid — works even in a bad month; debt-free accounts for the existing loan", () => {
    const r = whatIf(ds, { price: rs(90000), mode: "loan", loan_months: 10 }, NOW);
    expect(r).toMatchObject({
      verdict: "easy",
      confidence: "solid",
      installment: rs(9000),
      debt_free_month: "2027-09",
      risk_months: [],
      headline: "Rs 9,000/month over 10 months works even in a bad month — debt-free by Sep 2027",
    });
    expect(r.waterfall.map((w) => w.amount)).toEqual([
      rs(85000),
      -rs(16000),
      -rs(40000),
      -rs(10000),
      rs(19000),
      -rs(9000),
      rs(10000),
    ]);
    expect(r.projection[0]).toMatchObject({ month: "2026-12", loans: rs(18000), debt: rs(72000 + 81000) });
  });
  it("likely — risk months where a bad month can't cover it", () => {
    const r = whatIf(
      fixture([20000, 30000, 40000]),
      { price: rs(190000), mode: "loan", loan_months: 10 },
      NOW,
    );
    expect(r).toMatchObject({
      verdict: "stretch",
      confidence: "likely",
      risk_months: ["2026-12", "2027-01", "2027-02"],
      headline:
        "Rs 19,000/month over 10 months works in a normal month; 3 bad months would be tight — debt-free by Sep 2027",
    });
  });
  it("no — installment above surplus; goals slip", () => {
    const r = whatIf(ds, { price: rs(300000), mode: "loan", loan_months: 10 }, NOW);
    expect(r).toMatchObject({
      verdict: "no",
      headline: "Not affordable — Rs 30,000/month is more than your Rs 19,000 monthly surplus",
    });
    expect(r.risk_months.length).toBeGreaterThan(0);
    expect(r.goal_delays).toEqual([{ goal_id: "bike", name: "Bicycle", months: 10 }]);
  });
  it("installment instead of months; rounds up to whole rupees", () => {
    expect(whatIf(ds, { price: rs(100000), mode: "loan", loan_months: 3 }, NOW).installment).toBe(rs(33334));
    const r = whatIf(ds, { price: rs(30000), mode: "loan", installment: rs(3000) }, NOW);
    expect(r).toMatchObject({ installment: rs(3000), confidence: "solid" });
    expect(r.headline).toBe(
      "Rs 3,000/month over 10 months works even in a bad month — debt-free by Sep 2027",
    );
  });
  it("custom schedule, and a schedule that doesn't cover the price", () => {
    const schedule = [
      { month: "2027-01", amount: rs(10000) },
      { month: "2027-03", amount: rs(20000) },
    ];
    const r = whatIf(ds, { price: rs(30000), mode: "loan", schedule }, NOW);
    expect(r).toMatchObject({ installment: rs(20000), confidence: "solid" });
    expect(r.projection.find((m) => m.month === "2027-02")?.loans).toBe(rs(9000));
    expect(r.projection.find((m) => m.month === "2027-03")?.loans).toBe(rs(29000));
    expect(whatIf(ds, { price: rs(50000), mode: "loan", schedule }, NOW)).toMatchObject({
      verdict: "no",
      confidence: "no",
      headline: "Your schedule repays only Rs 30,000 of Rs 50,000",
    });
  });
  it("lowest-priority goals absorb a shortfall first", () => {
    const phone = goal({ id: "phone", name: "Phone", target: rs(10000), monthly: rs(5000), priority: 2 });
    const d2 = withRows(ds, { goals: [phone] });
    expect(budgetModel(d2, NOW).surplus).toBe(rs(14000));
    const r = whatIf(d2, { price: rs(170000), mode: "loan", loan_months: 10 }, NOW);
    expect(r.verdict).toBe("no");
    expect(r.goal_delays).toEqual([
      { goal_id: "bike", name: "Bicycle", months: 0 },
      { goal_id: "phone", name: "Phone", months: 3 },
    ]);
  });
});

describe("loanStatus, goalStatus", () => {
  it("loan payoff from the planned installment", () => {
    expect(loanStatus(fixture(), NOW)[0]).toMatchObject({
      outstanding: rs(90000),
      payoff_month: "2027-08",
      progress: 0,
    });
  });
  it("goal ETA and progress", () => {
    expect(goalStatus(fixture(), NOW)[0]).toMatchObject({
      saved: rs(10000),
      remaining: rs(40000),
      eta_month: "2027-02",
      progress: 0.2,
    });
    const moved = withRows(fixture(), { goal_moves: [move("bike", rs(10000), "2026-11-02")] });
    expect(goalStatus(moved, NOW)[0]).toMatchObject({ remaining: rs(30000), eta_month: "2027-02" });
    const done = withRows(seeded(), { goals: [goal({ target: 1, monthly: 0, achieved_on: "2026-09-09" })] });
    expect(goalStatus(done, NOW)[0]?.eta_month).toBe("2026-09");
    const stalled = withRows(seeded(), { goals: [goal({ target: 100, monthly: 0 })] });
    expect(goalStatus(stalled, NOW)[0]?.eta_month).toBeNull();
  });
});
