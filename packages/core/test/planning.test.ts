import { describe, expect, it } from "vitest";
import { applyMutations } from "../src/dataset.ts";
import { budgetModel, goalStatus, loanStatus, suggestedSplit, whatIf } from "../src/planning.ts";
import type { Dataset } from "../src/types.ts";
import { bal, goal, loan, move, recurring, seeded, txn, withRows } from "./builders.ts";

const NOW = "2026-11-15T12:00";
const rs = (n: number) => n * 100;

/**
 * Aug–Oct history (3 complete months with data):
 *   Food 30,000/mo, Car › Petrol 10,000/mo (variable)
 *   Bills › Electricity 4,000/mo (fixed, covered by the Guard recurring row)
 *   Subscriptions › VPS 2,000/mo (fixed, no recurring row → counted in committed)
 * Guard recurring Rs 5,000 (SadaPay), loan installment Rs 9,000, goal Bicycle Rs 10,000/mo (saved 10,000 of 50,000).
 * SadaPay balance Rs 25,000.
 */
function fixture(extra: Partial<Dataset> = {}): Dataset {
  const months = ["2026-08", "2026-09", "2026-10"];
  const hist = months.flatMap((m) => [
    txn({ occurred_at: `${m}-05T12:00`, amount: -rs(30000), category_id: "food" }),
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
  return withRows(seeded(), {
    transactions: hist,
    recurring: [recurring("Guard", rs(5000), { category_id: "bills.guard" })],
    loans: [loan({ id: "L1", principal: rs(90000), installment: rs(9000), started_on: "2026-10-01" })],
    goals: [bike],
    goal_moves: [move("bike", rs(10000), "2026-08-01")],
    balances: [bal("sadapay", "2026-11-10T10:00", rs(25000))],
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
      ["committed", "Recurring payments (1)", rs(5000)],
      ["committed", "Bicycle loan (Mom)", rs(9000)],
      ["committed", "Subscriptions (average, no recurring set)", rs(2000)],
      ["variable", "Car (average)", rs(10000)],
      ["variable", "Food (average)", rs(30000)],
      ["goals", "Goal: Bicycle", rs(10000)],
      ["surplus", "Surplus", rs(19000)],
    ]);
  });
  it("levers adjust category averages, including via a subcategory", () => {
    expect(budgetModel(fixture(), NOW, [{ category_id: "food", pct: -50 }]).surplus).toBe(rs(34000));
    expect(budgetModel(fixture(), NOW, [{ category_id: "car.petrol", pct: -100 }]).variable).toBe(rs(30000));
  });
});

describe("whatIf: save", () => {
  const ds = fixture();
  it("now — when free savings cover it", () => {
    const r = whatIf(ds, { price: rs(8000), mode: "save" }, NOW);
    expect(r).toMatchObject({
      verdict: "now",
      headline: "Affordable now — leaves Rs 2,000 free in SadaPay",
      months_to_save: 0,
      ready_month: "2026-11",
    });
  });
  it("easy — one month", () => {
    const r = whatIf(ds, { price: rs(25000), mode: "save" }, NOW);
    expect(r).toMatchObject({
      verdict: "easy",
      months_to_save: 1,
      ready_month: "2026-12",
      headline: "Save Rs 15,000/month for 1 month — ready Dec 2026",
    });
  });
  it("stretch — 2 to 6 months", () => {
    const r = whatIf(ds, { price: rs(60000), mode: "save" }, NOW);
    expect(r).toMatchObject({
      verdict: "stretch",
      months_to_save: 3,
      ready_month: "2027-02",
      headline: "Save Rs 16,667/month for 3 months — ready Feb 2027",
    });
    expect(r.goal_delays).toEqual([{ goal_id: "bike", name: "Bicycle", months: 0 }]);
  });
  it("no — more than 6 months", () => {
    const r = whatIf(ds, { price: rs(200000), mode: "save" }, NOW);
    expect(r).toMatchObject({
      verdict: "no",
      months_to_save: 10,
      headline: "Not affordable within 6 months — saving Rs 19,000/month takes 10 months (ready Sep 2027)",
    });
  });
  it("no — surplus ≤ 0", () => {
    const poor = applyMutations(ds, [
      {
        table: "settings",
        row: { id: "income_monthly", value: String(rs(50000)), version: 1, deleted: false },
      },
    ]);
    const r = whatIf(poor, { price: rs(20000), mode: "save" }, NOW);
    expect(r).toMatchObject({
      verdict: "no",
      months_to_save: null,
      ready_month: null,
      headline: "Not affordable — your monthly surplus is −Rs 16,000",
    });
  });
  it("levers change the verdict", () => {
    const r = whatIf(
      ds,
      { price: rs(60000), mode: "save", levers: [{ category_id: "food", pct: -50 }] },
      NOW,
    );
    expect(r).toMatchObject({ verdict: "stretch", months_to_save: 2 });
    expect(r.model.variable).toBe(rs(25000));
  });
});

describe("whatIf: loan", () => {
  const ds = fixture();
  it("easy — installment ≤ 50% of surplus; debt-free accounts for the existing loan", () => {
    const r = whatIf(ds, { price: rs(90000), mode: "loan", loan_months: 10 }, NOW);
    expect(r).toMatchObject({
      verdict: "easy",
      installment: rs(9000),
      debt_free_month: "2027-09",
      headline: "Rs 9,000/month over 10 months — debt-free by Sep 2027",
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
  });
  it("stretch — installment ≤ surplus", () => {
    expect(whatIf(ds, { price: rs(150000), mode: "loan", loan_months: 10 }, NOW)).toMatchObject({
      verdict: "stretch",
      installment: rs(15000),
    });
  });
  it("no — installment above surplus; goals slip", () => {
    const r = whatIf(ds, { price: rs(300000), mode: "loan", loan_months: 10 }, NOW);
    expect(r).toMatchObject({
      verdict: "no",
      headline: "Not affordable — Rs 30,000/month is more than your Rs 19,000 monthly surplus",
    });
    expect(r.goal_delays).toEqual([{ goal_id: "bike", name: "Bicycle", months: 10 }]);
  });
  it("installment rounds up to whole rupees", () => {
    expect(whatIf(ds, { price: rs(100000), mode: "loan", loan_months: 3 }, NOW).installment).toBe(rs(33334));
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

describe("loanStatus, goalStatus, suggestedSplit", () => {
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
  it("split: SadaPay gets committed + uncovered bills + goals, NayaPay the rest", () => {
    const s = suggestedSplit(fixture(), NOW);
    expect(s).toMatchObject({ sadapay: rs(26000), nayapay: rs(59000) });
    expect(s.lines.map((l) => [l.account_id, l.amount])).toEqual([
      ["sadapay", rs(5000)],
      ["sadapay", rs(9000)],
      ["sadapay", rs(2000)],
      ["sadapay", rs(10000)],
      ["nayapay", rs(59000)],
    ]);
  });
});
