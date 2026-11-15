import { describe, expect, it } from "vitest";
import { execute } from "../src/commands.ts";
import { apply, cmd, ctx, importCmd, parsed, prov, seeded, srow, withRows } from "./builders.ts";

// The 15 Nov case: card payments notified on the 14th/15th aren't on a statement generated on the 15th yet.
const food = prov({
  id: "p-food",
  account_id: "sadapay",
  source: "notification",
  occurred_at: "2026-11-14T04:27",
  amount: -555999,
  description: "You spent PKR 5559.99 at FOOD PANDA KARACHI PAK.",
  reason: "Dinner",
});
const old = prov({ id: "p-old", account_id: "sadapay", occurred_at: "2026-11-05T10:00", amount: -1000 });
const posted = srow("sada:h1", "2026-11-02T10:00", -800000, "To BCCI FAST");
const ds0 = () => withRows(seeded("2026-11-01"), { transactions: [food, old] });

describe("importStatement: card payments that haven't posted yet", () => {
  it("keeps rows from the statement's last 3 days provisional (waiting), disputes older ones", () => {
    const st = parsed("sadapay", "2026-11-01", "2026-11-15", [posted], null, null);
    const out = execute(ds0(), importCmd(st), ctx());
    expect(out.result).toMatchObject({ added: 1, disputed: 1, waiting: 1 });
    const ds = apply(ds0(), out.mutations);
    expect(ds.transactions.find((t) => t.id === "p-food")?.status).toBe("provisional");
    expect(ds.transactions.find((t) => t.id === "p-old")?.status).toBe("disputed");
  });

  it("verifies the row when it posts days later, keeping its reason", () => {
    const late = srow("sada:h2", "2026-11-17T09:00", -555999, "Food Panda 18th Floor Karachi");
    const st = parsed("sadapay", "2026-11-01", "2026-11-18", [posted, late], null, null);
    const out = execute(ds0(), importCmd(st), ctx());
    expect(out.result).toMatchObject({ matched: 1, added: 1 });
    const ds = apply(ds0(), out.mutations);
    expect(ds.transactions.find((t) => t.id === "p-food")).toMatchObject({
      status: "verified",
      external_id: "sada:h2",
      reason: "Dinner",
    });
  });

  it("does not match a statement row more than 36h before the notification", () => {
    const early = srow("sada:h3", "2026-11-12T09:00", -555999, "Food Panda");
    const st = parsed("sadapay", "2026-11-01", "2026-11-15", [early], null, null);
    const out = execute(ds0(), importCmd(st), ctx());
    expect(out.result).toMatchObject({ matched: 0, added: 1 });
  });
});

describe("restoreTransaction", () => {
  const deleted = () => {
    const out = execute(ds0(), cmd("deleteProvisional", { txn_id: "p-food" }), ctx());
    return apply(ds0(), out.mutations);
  };
  const row = {
    id: food.id,
    account_id: food.account_id,
    occurred_at: food.occurred_at,
    amount: food.amount,
    flow: food.flow,
    source: "notification" as const,
    description: food.description,
    reason: food.reason,
    category_id: null,
    counterparty_id: "gone",
    loan_id: null,
    linked_txn_id: null,
    notification_id: null,
    created_at: food.created_at,
  };

  it("brings a deleted row back as provisional, dropping links to things that are gone", () => {
    const ds = deleted();
    expect(ds.transactions.find((t) => t.id === "p-food" && !t.deleted)).toBeUndefined();
    const out = execute(ds, cmd("restoreTransaction", { row }), ctx());
    expect(out.ok).toBe(true);
    const back = apply(ds, out.mutations).transactions.find((t) => t.id === "p-food" && !t.deleted);
    expect(back).toMatchObject({
      status: "provisional",
      reason: "Dinner",
      counterparty_id: null,
      deleted: false,
    });
  });

  it("refuses to duplicate a row that is still there", () => {
    expect(execute(ds0(), cmd("restoreTransaction", { row }), ctx()).error).toBe("conflict");
  });
});

describe("deleteLoan", () => {
  it("removes the loan; its payments stay loan payments", () => {
    const loan = {
      id: "L1",
      lender: "Mom",
      counterparty_id: null,
      principal: 1000000,
      started_on: "2026-11-01",
      purpose: "Bicycle",
      installment: 100000,
      note: null,
      manual_repaid: 0,
      closed_on: null,
      version: 1,
      deleted: false,
    };
    const pay = prov({
      id: "pay",
      occurred_at: "2026-11-05T10:00",
      amount: -100000,
      flow: "loan_repay",
      loan_id: "L1",
    });
    const ds = withRows(seeded("2026-11-01"), { loans: [loan], transactions: [pay] });
    const out = execute(ds, cmd("deleteLoan", { loan_id: "L1" }), ctx());
    expect(out.ok).toBe(true);
    const after = apply(ds, out.mutations);
    expect(after.loans.some((l) => l.id === "L1" && !l.deleted)).toBe(false);
    expect(after.transactions.find((t) => t.id === "pay")?.flow).toBe("loan_repay");
    expect(execute(after, cmd("deleteLoan", { loan_id: "L1" }), ctx()).error).toBe("not_found");
  });
});

describe("goal money", () => {
  const g = {
    id: "g1",
    name: "Bicycle",
    icon: "bike",
    target: 12000000,
    monthly: 3000000,
    priority: 1,
    achieved_on: null,
    version: 1,
    deleted: false,
  };
  const mv = (id: string, amount: number) => ({
    id,
    goal_id: "g1",
    amount,
    on: "2026-11-10",
    note: null,
    version: 1,
    deleted: false,
  });
  const ds = () =>
    withRows(seeded("2026-11-01"), { goals: [g], goal_moves: [mv("m1", 5000000), mv("m2", -2000000)] });

  it("deleteGoalMove removes a deposit unless a withdrawal depends on it", () => {
    expect(execute(ds(), cmd("deleteGoalMove", { move_id: "m2" }), ctx()).ok).toBe(true);
    // 50k in, 20k out: dropping the 50k would leave −20k
    expect(execute(ds(), cmd("deleteGoalMove", { move_id: "m1" }), ctx()).error).toBe("invalid");
  });

  it("a ledger reset keeps the money set aside for goals", () => {
    const out = execute(
      ds(),
      cmd("resetLedger", { tracking_start: "2026-12-01", confirm: "RESET" }),
      ctx(undefined, true),
    );
    expect(out.ok).toBe(true);
    expect(out.mutations.some((m) => m.table === "goal_moves")).toBe(false);
  });
});
