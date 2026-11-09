import { describe, expect, it } from "vitest";
import {
  categoryCards,
  categorySeries,
  counterpartyStats,
  detectRecurring,
  netPosition,
  robustZ,
  spendOf,
  unverifiedSummary,
} from "../src/analytics.ts";
import { applyMutations } from "../src/dataset.ts";
import type { Dataset } from "../src/types.ts";
import {
  bal,
  cp,
  goal,
  loan,
  move,
  prov,
  recurring,
  seeded,
  stmt,
  txn,
  withOpening,
  withRows,
} from "./builders.ts";

const NOW = "2026-11-15T12:00";

describe("spendOf", () => {
  it("counts only spend/fee outflows", () => {
    expect(spendOf(txn({ occurred_at: NOW, amount: -500, flow: "spend" }))).toBe(500);
    expect(spendOf(txn({ occurred_at: NOW, amount: -500, flow: "fee" }))).toBe(500);
    expect(spendOf(txn({ occurred_at: NOW, amount: -500, flow: "internal" }))).toBe(0);
    expect(spendOf(txn({ occurred_at: NOW, amount: -500, flow: "loan_repay" }))).toBe(0);
    expect(spendOf(txn({ occurred_at: NOW, amount: 500, flow: "spend" }))).toBe(0);
  });
});

describe("wallet positions (ledger-derived)", () => {
  const base = () => withOpening(seeded("2026-11-01"), { nayapay: 500000 });

  it("balance = b/f + every tracked transaction; balance entries are assertions, not anchors", () => {
    const ds = withRows(base(), {
      statements: [stmt("nayapay", "2026-11-01", "2026-11-07", { closing: 999999 })],
      balances: [bal("nayapay", "2026-11-07T23:59", 999999, { source: "statement_close" })],
      transactions: [
        txn({ occurred_at: "2026-10-30T10:00", amount: -777777 }), // before tracking start: doesn't exist
        txn({ occurred_at: "2026-11-08T10:00", amount: -20000 }),
        prov({ occurred_at: "2026-11-09T10:00", amount: -10000 }),
        prov({ occurred_at: "2026-11-09T11:00", amount: 5000, status: "disputed" }),
      ],
    });
    const w = netPosition(ds, NOW).wallets.find((x) => x.account_id === "nayapay");
    expect(w).toMatchObject({
      balance: 475000,
      provisional_delta: -5000,
      verified_until: "2026-11-07",
      unaccounted: 0,
      floor: null,
      role: "pocket",
    });
  });
  it("unaccounted = latest manual balance − ledger balance at that moment", () => {
    const ds = withRows(base(), {
      balances: [bal("nayapay", "2026-11-09T12:00", 470000)],
      transactions: [
        txn({ occurred_at: "2026-11-08T10:00", amount: -20000 }),
        prov({ occurred_at: "2026-11-10T10:00", amount: -5000 }),
      ],
    });
    const w = netPosition(ds, NOW).wallets.find((x) => x.account_id === "nayapay");
    // ledger at 9 Nov 12:00 = 500,000 − 20,000 = 480,000; typed 470,000 → −10,000 unaccounted
    expect(w).toMatchObject({ balance: 475000, unaccounted: -10000, provisional_delta: -5000 });
  });
  it("vault floor = goal envelopes + active SadaPay recurring", () => {
    const g = goal({ target: 1000000, monthly: 100000 });
    const ds = withRows(seeded(), {
      goals: [g],
      goal_moves: [move(g.id, 50000, "2026-10-01"), move(g.id, 30000, "2026-11-01")],
      recurring: [
        recurring("iCloud", 90000),
        recurring("Old", 1000, { active: false }),
        recurring("Gym", 5000, { account_id: "nayapay" }),
      ],
    });
    expect(netPosition(ds, NOW).wallets.find((w) => w.account_id === "sadapay")?.floor).toBe(170000);
  });
});

describe("loans and net position", () => {
  const l = loan({ id: "L1", principal: 9000000, installment: 900000, started_on: "2026-08-10" });
  const repay = (on: string) =>
    txn({ account_id: "sadapay", occurred_at: on, amount: -900000, flow: "loan_repay", loan_id: "L1" });
  const ds = withRows(withOpening(seeded(), { sadapay: 3800000, nayapay: 500000 }), {
    loans: [l],
    transactions: [repay("2026-09-05T10:00"), repay("2026-10-05T10:00")],
  });
  it("repaid, outstanding, payoff month and progress", () => {
    const n = netPosition(ds, NOW);
    expect(n.loans[0]).toMatchObject({
      repaid: 1800000,
      outstanding: 7200000,
      payoff_month: "2027-06",
      progress: 0.2,
    });
    expect(n).toMatchObject({
      wallet_total: 2500000,
      debt: 7200000,
      net: -4700000,
      in_debt: true,
      debt_free_month: "2027-06",
    });
  });
  it("a payment already made this month pushes the payoff by one", () => {
    const d2 = withRows(ds, { transactions: [repay("2026-11-05T10:00")] });
    expect(netPosition(d2, NOW).loans[0]).toMatchObject({ outstanding: 6300000, payoff_month: "2027-06" });
  });
  it("manual repayments count; closed loans have nothing outstanding", () => {
    const d2 = withRows(seeded(), { loans: [{ ...l, manual_repaid: 9000000 }] });
    expect(netPosition(d2, NOW)).toMatchObject({ debt: 0, in_debt: false, debt_free_month: null });
    const d3 = withRows(seeded(), { loans: [{ ...l, closed_on: "2026-10-01" }] });
    expect(netPosition(d3, NOW).loans[0]).toMatchObject({ outstanding: 0, payoff_month: "2026-10" });
  });
});

/** Food spend per month (Rs), first data in May 2026. */
function foodHistory(perMonth: Record<string, number>): Dataset {
  const txns = Object.entries(perMonth).flatMap(([m, rs]) =>
    rs > 0 ? [txn({ occurred_at: `${m}-10T13:00`, amount: -rs * 100, category_id: "food.friends" })] : [],
  );
  return withRows(seeded(), {
    transactions: [txn({ occurred_at: "2026-05-01T09:00", amount: 100, flow: "income" }), ...txns],
  });
}

describe("category cards & averages", () => {
  const ds = foodHistory({
    "2026-05": 100,
    "2026-06": 100,
    "2026-07": 100,
    "2026-08": 400,
    "2026-09": 400,
    "2026-10": 400,
    "2026-11": 300,
  });
  const food = (d: Dataset) => categoryCards(d, "2026-11", NOW).find((c) => c.category.id === "food");

  it("6-month window averages the last 6 complete months, rolling up subcategories", () => {
    expect(food(ds)).toMatchObject({
      spent: 30000,
      average: 25000,
      months_in_average: 6,
      over_average: true,
      pace: 12500,
    });
    expect(food(ds)?.children.find((c) => c.category.id === "food.friends")).toMatchObject({
      spent: 30000,
      average: 25000,
    });
  });
  it("3-month window", () => {
    const d3 = applyMutations(ds, [
      { table: "settings", row: { id: "avg_window", value: "3", version: 1, deleted: false } },
    ]);
    expect(food(d3)).toMatchObject({ average: 40000, months_in_average: 3, over_average: false });
  });
  it("sparse history: months before the first data month are ignored; empty months with data count as 0", () => {
    const sparse = withRows(seeded(), {
      transactions: [
        txn({ occurred_at: "2026-09-01T09:00", amount: 100, flow: "income" }),
        txn({ occurred_at: "2026-10-05T10:00", amount: -60000, category_id: "food" }),
      ],
    });
    expect(food(sparse)).toMatchObject({ average: 30000, months_in_average: 2 });
    const empty = categoryCards(seeded(), "2026-11", NOW);
    expect(empty.map((c) => c.category.id)).toEqual([
      "car",
      "food",
      "enjoyments",
      "self",
      "bills",
      "subscriptions",
      "charity",
      "misc",
    ]);
    expect(empty.every((c) => c.spent === 0 && c.average === null)).toBe(true);
  });
  it("no history → average null", () => {
    const only = withRows(seeded(), {
      transactions: [txn({ occurred_at: "2026-11-05T10:00", amount: -100, category_id: "food" })],
    });
    expect(food(only)).toMatchObject({
      spent: 100,
      average: null,
      months_in_average: 0,
      over_average: false,
      pace: null,
    });
  });
  it("reimbursements offset the linked expense's category in the reimbursement's month", () => {
    const e = txn({ id: "e1", occurred_at: "2026-10-20T20:00", amount: -10000, category_id: "food.friends" });
    const r = txn({
      occurred_at: "2026-11-02T10:00",
      amount: 4000,
      flow: "reimbursement",
      linked_txn_id: "e1",
    });
    const d2 = withRows(ds, { transactions: [e, r] });
    expect(food(d2)?.spent).toBe(26000);
  });
  it("hidden categories appear once used; sorted by spend", () => {
    const d2 = withRows(ds, {
      transactions: [
        txn({ occurred_at: "2026-11-03T10:00", amount: -99999, category_id: "health.pharmacy" }),
      ],
    });
    const cards = categoryCards(d2, "2026-11", NOW);
    expect(cards[0]?.category.id).toBe("health");
    expect(cards.some((c) => c.category.id === "gifts")).toBe(false);
  });
});

describe("robustZ & outliers", () => {
  it("uses MAD", () => {
    const z = robustZ([10, 12, 11, 13, 50]);
    expect(z[4]).toBeCloseTo(38 / 1.4826, 4);
    expect(z[0]).toBeCloseTo(2 / 1.4826, 4);
  });
  it("falls back to mean absolute deviation when MAD = 0", () => {
    const z = robustZ([10, 10, 10, 10, 30]);
    expect(z[4]).toBeCloseTo(20 / (1.2533 * 4), 4);
    expect(z[0]).toBe(0);
  });
  it("identical values → 0; fewer than 3 → null", () => {
    expect(robustZ([5, 5, 5])).toEqual([0, 0, 0]);
    expect(robustZ([1, 2])).toEqual([null, null]);
  });
  it("categorySeries flags outlier months and scores the current month against complete ones", () => {
    const ds = foodHistory({
      "2026-05": 100,
      "2026-06": 110,
      "2026-07": 90,
      "2026-08": 105,
      "2026-09": 400,
      "2026-10": 95,
      "2026-11": 100,
    });
    const s = categorySeries(ds, "food", 12, NOW);
    expect(s.map((p) => p.month)).toEqual([
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
      "2026-11",
    ]);
    expect(s.filter((p) => p.outlier).map((p) => p.month)).toEqual(["2026-09"]);
    expect(s.at(-1)?.z).not.toBeNull();
    expect(categorySeries(ds, "food", 3, NOW).map((p) => p.month)).toEqual(["2026-09", "2026-10", "2026-11"]);
  });
});

describe("detectRecurring", () => {
  const pay = (on: string, amount: number, description = "Card payment APPLE.COM/BILL") =>
    txn({ account_id: "sadapay", occurred_at: `${on}T09:00`, amount: -amount, description });
  it("finds ≥3 similar payments ~monthly", () => {
    const ds = withRows(seeded(), {
      transactions: [
        pay("2026-07-03", 90000),
        pay("2026-08-02", 90000),
        pay("2026-09-03", 92000),
        pay("2026-10-03", 89000),
        pay("2026-10-15", 300000),
      ],
    });
    const [c] = detectRecurring(ds);
    expect(c).toMatchObject({
      key: "APPLE COM BILL",
      account_id: "sadapay",
      amount: 90000,
      occurrences: 4,
      day_of_month: 3,
      last_seen: "2026-10-03T09:00",
    });
  });
  it("ignores irregular gaps, too few payments, and ones already covered", () => {
    const irregular = withRows(seeded(), {
      transactions: [pay("2026-07-03", 90000), pay("2026-07-13", 90000), pay("2026-07-23", 90000)],
    });
    expect(detectRecurring(irregular)).toEqual([]);
    const two = withRows(seeded(), { transactions: [pay("2026-08-03", 90000), pay("2026-09-03", 90000)] });
    expect(detectRecurring(two)).toEqual([]);
    const covered = withRows(seeded(), {
      transactions: [pay("2026-08-03", 90000), pay("2026-09-03", 90000), pay("2026-10-03", 90000)],
      recurring: [recurring("Apple com bill", 90000)],
    });
    expect(detectRecurring(covered)).toEqual([]);
  });
  it("groups by counterparty when set", () => {
    const g = cp("Guard Sahib");
    const ds = withRows(seeded(), {
      counterparties: [g],
      transactions: ["2026-08-01", "2026-09-01", "2026-10-01"].map((d, i) => ({
        ...pay(d, 500000, `To GUARD ${i} (Meezan)`),
        counterparty_id: g.id,
      })),
    });
    expect(detectRecurring(ds)[0]).toMatchObject({
      counterparty_id: g.id,
      name: "Guard Sahib",
      occurrences: 3,
    });
  });
});

describe("unverifiedSummary", () => {
  it("counts provisional and disputed rows per wallet", () => {
    const ds = withRows(seeded(), {
      transactions: [
        prov({ occurred_at: "2026-11-07T10:00", amount: -2000 }),
        prov({ occurred_at: "2026-11-09T10:00", amount: -450, account_id: "sadapay", status: "disputed" }),
        txn({ occurred_at: "2026-11-01T10:00", amount: -1 }),
      ],
    });
    expect(unverifiedSummary(ds)).toEqual({
      count: 2,
      total: -2450,
      since: "2026-11-07T10:00",
      disputed: 1,
      by_account: {
        sadapay: { count: 1, since: "2026-11-09T10:00" },
        nayapay: { count: 1, since: "2026-11-07T10:00" },
      },
    });
  });
});

describe("counterpartyStats", () => {
  it("summarises sent/received, typical amount, timing and categories", () => {
    const d = cp("Danish");
    const ds = withRows(seeded(), {
      counterparties: [d],
      transactions: [
        txn({ occurred_at: "2026-09-07T13:00", amount: -10000, counterparty_id: d.id, category_id: "food" }), // Monday
        txn({ occurred_at: "2026-10-07T13:00", amount: -30000, counterparty_id: d.id, category_id: "food" }),
        txn({ occurred_at: "2026-10-17T20:00", amount: 5000, counterparty_id: d.id }),
      ],
    });
    const s = counterpartyStats(ds, d.id, NOW);
    expect(s).toMatchObject({
      total_sent: 40000,
      total_received: 5000,
      count: 3,
      typical_amount: 20000,
      avg_interval_days: 20,
    });
    expect(s.series.map((p) => p.month)).toEqual(["2026-09", "2026-10", "2026-11"]);
    expect(s.series[1]).toEqual({ month: "2026-10", sent: 30000, received: 5000 });
    expect(s.weekday[0]).toBe(1);
    expect(s.hour[13]).toBe(2);
    expect(s.categories[0]).toEqual({ category_id: "food", total: 40000 });
    expect(() => counterpartyStats(ds, "zz", NOW)).toThrow();
  });
});
