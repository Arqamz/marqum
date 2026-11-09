import { describe, expect, it } from "vitest";
import { execute } from "../src/commands.ts";
import type { Dataset } from "../src/types.ts";
import {
  apply,
  closeMonthRecord,
  cmd,
  cp,
  ctx,
  goal,
  move,
  NOW,
  prov,
  recurring,
  rowsOf,
  seeded,
  txn,
  withRows,
} from "./builders.ts";

const addProv = (over: Partial<Parameters<typeof base>[0]> = {}) => cmd("addProvisional", base(over));
function base(over: Record<string, unknown> = {}) {
  return {
    txn_id: "p1",
    account_id: "nayapay" as const,
    occurred_at: "2026-11-14T13:00",
    amount: -150000,
    reason: "petrol",
    category_id: null,
    flow: null,
    counterparty_name: null,
    ...over,
  };
}

describe("execute: validation", () => {
  it("rejects args that fail the zod schema", () => {
    const bad = { id: "c1", name: "addProvisional", at: NOW, args: { txn_id: "p1" } } as never;
    expect(execute(seeded(), bad, ctx())).toMatchObject({ ok: false, error: "invalid" });
  });
});

describe("addProvisional", () => {
  it("creates a provisional manual row, classified, with timestamps from ctx and version 0", () => {
    const out = execute(seeded(), addProv(), ctx());
    expect(out.ok).toBe(true);
    const [row] = rowsOf(out.mutations, "transactions");
    expect(row).toMatchObject({
      id: "p1",
      status: "provisional",
      source: "manual",
      category_id: "car.petrol",
      flow: "spend",
      description: "",
      created_at: NOW,
      updated_at: NOW,
      version: 0,
      deleted: false,
    });
  });
  it("keeps explicit category/flow and creates an unknown counterparty", () => {
    const out = execute(
      seeded(),
      addProv({ category_id: "misc", flow: "fee", counterparty_name: "Corner Shop" }),
      ctx(),
    );
    const [c] = rowsOf(out.mutations, "counterparties");
    expect(c).toMatchObject({ name: "Corner Shop", kind: "person", aliases: ["CORNER SHOP"] });
    expect(rowsOf(out.mutations, "transactions")[0]).toMatchObject({
      category_id: "misc",
      flow: "fee",
      counterparty_id: c?.id,
    });
  });
  it("reuses a known counterparty and its defaults", () => {
    const guard = cp("Guard Sahib", { default_category_id: "bills.guard" });
    const ds = withRows(seeded(), { counterparties: [guard] });
    const out = execute(ds, addProv({ reason: null, counterparty_name: "guard sahib" }), ctx());
    expect(rowsOf(out.mutations, "counterparties")).toHaveLength(0);
    expect(rowsOf(out.mutations, "transactions")[0]).toMatchObject({
      counterparty_id: guard.id,
      category_id: "bills.guard",
    });
  });
  it("conflicts on an existing id and rejects zero / unknown category", () => {
    const ds = withRows(seeded(), {
      transactions: [prov({ id: "p1", occurred_at: "2026-11-01T10:00", amount: -1 })],
    });
    expect(execute(ds, addProv(), ctx()).error).toBe("conflict");
    expect(execute(seeded(), addProv({ amount: 0 }), ctx()).error).toBe("invalid");
    expect(execute(seeded(), addProv({ category_id: "nope" }), ctx()).error).toBe("invalid");
  });
});

describe("deleteProvisional / resolveDisputed", () => {
  const p = prov({ id: "p1", occurred_at: "2026-11-10T10:00", amount: -500 });
  const d = prov({ id: "d1", status: "disputed", occurred_at: "2026-11-10T10:00", amount: -500 });
  const v = txn({ id: "v1", occurred_at: "2026-11-10T10:00", amount: -500 });
  const ds = withRows(seeded(), { transactions: [p, d, v] });

  it("deletes provisional and disputed rows only", () => {
    expect(
      rowsOf(execute(ds, cmd("deleteProvisional", { txn_id: "p1" }), ctx()).mutations, "transactions")[0],
    ).toMatchObject({
      id: "p1",
      deleted: true,
    });
    expect(execute(ds, cmd("deleteProvisional", { txn_id: "d1" }), ctx()).ok).toBe(true);
    expect(execute(ds, cmd("deleteProvisional", { txn_id: "v1" }), ctx()).error).toBe("invalid");
    expect(execute(ds, cmd("deleteProvisional", { txn_id: "zz" }), ctx()).error).toBe("not_found");
  });
  it("resolves disputed by delete or revert to provisional", () => {
    expect(
      rowsOf(
        execute(ds, cmd("resolveDisputed", { txn_id: "d1", action: "delete" }), ctx()).mutations,
        "transactions",
      )[0],
    ).toMatchObject({
      deleted: true,
    });
    expect(
      rowsOf(
        execute(ds, cmd("resolveDisputed", { txn_id: "d1", action: "keep_provisional" }), ctx()).mutations,
        "transactions",
      )[0],
    ).toMatchObject({ status: "provisional", updated_at: NOW });
    expect(execute(ds, cmd("resolveDisputed", { txn_id: "p1", action: "delete" }), ctx()).error).toBe(
      "invalid",
    );
  });
});

describe("tagTransaction", () => {
  const t = txn({
    id: "v1",
    occurred_at: "2026-11-10T10:00",
    amount: -50000,
    description: "Outgoing fund transfer to Danish",
  });
  const ds = withRows(seeded(), { transactions: [t] });

  it("partially updates, leaving other fields untouched", () => {
    const out = execute(ds, cmd("tagTransaction", { txn_id: "v1", reason: "lunch" }), ctx());
    expect(rowsOf(out.mutations, "transactions")[0]).toMatchObject({
      reason: "lunch",
      category_id: null,
      flow: "spend",
      updated_at: NOW,
    });
  });
  it("is a no-op when nothing changes", () => {
    expect(execute(ds, cmd("tagTransaction", { txn_id: "v1", category_id: null }), ctx()).mutations).toEqual(
      [],
    );
  });
  it("remember creates a rule above seeds with the resulting category/flow", () => {
    const out = execute(
      ds,
      cmd("tagTransaction", { txn_id: "v1", category_id: "food.friends", remember: { pattern: "danish" } }),
      ctx(),
    );
    const [rule] = rowsOf(out.mutations, "rules");
    expect(rule).toMatchObject({
      pattern: "danish",
      category_id: "food.friends",
      flow: "spend",
      priority: 1000,
    });
    // the counterparty's default is not touched
    expect(rowsOf(out.mutations, "counterparties")).toHaveLength(0);
    const ds2 = apply(ds, out.mutations);
    const again = execute(ds2, cmd("tagTransaction", { txn_id: "v1", remember: { pattern: "x" } }), ctx());
    expect(rowsOf(again.mutations, "rules")[0]?.priority).toBe(1001);
  });
  it("validates references and patterns", () => {
    expect(execute(ds, cmd("tagTransaction", { txn_id: "v1", category_id: "nope" }), ctx()).error).toBe(
      "invalid",
    );
    expect(execute(ds, cmd("tagTransaction", { txn_id: "v1", loan_id: "nope" }), ctx()).error).toBe(
      "invalid",
    );
    expect(execute(ds, cmd("tagTransaction", { txn_id: "v1", linked_txn_id: "v1" }), ctx()).error).toBe(
      "invalid",
    );
    expect(
      execute(ds, cmd("tagTransaction", { txn_id: "v1", remember: { pattern: "([" } }), ctx()).error,
    ).toBe("invalid");
    expect(execute(ds, cmd("tagTransaction", { txn_id: "zz", reason: "x" }), ctx()).error).toBe("not_found");
  });
});

describe("closed months", () => {
  const oct = txn({ id: "o1", occurred_at: "2026-10-10T10:00", amount: -50000, category_id: "food" });
  const octProv = prov({ id: "op", occurred_at: "2026-10-12T10:00", amount: -100 });
  const ds: Dataset = closeMonthRecord(withRows(seeded(), { transactions: [oct, octProv] }), "2026-10");

  it("rejects new rows dated in a closed month", () => {
    expect(execute(ds, addProv({ occurred_at: "2026-10-20T10:00" }), ctx(NOW, true)).error).toBe(
      "closed_month",
    );
    expect(execute(ds, cmd("deleteProvisional", { txn_id: "op" }), ctx(NOW, true)).error).toBe(
      "closed_month",
    );
    expect(
      execute(
        ds,
        cmd("recordBalance", {
          entry_id: "b1",
          account_id: "nayapay",
          balance: 1,
          as_of: "2026-10-31T20:00",
        }),
        ctx(NOW, true),
      ).error,
    ).toBe("closed_month");
    expect(
      execute(
        ds,
        cmd("recordBalance", {
          entry_id: "b1",
          account_id: "nayapay",
          balance: 1,
          as_of: "2026-11-01T00:00",
        }),
        ctx(),
      ).ok,
    ).toBe(true);
  });
  it("tagTransaction category/reason needs step-up", () => {
    const c = cmd("tagTransaction", { txn_id: "o1", category_id: "food.friends", reason: "dinner" });
    expect(execute(ds, c, ctx()).error).toBe("step_up_required");
    const out = execute(ds, c, ctx(NOW, true));
    expect(out.ok).toBe(true);
    expect(rowsOf(out.mutations, "transactions")[0]).toMatchObject({
      category_id: "food.friends",
      reason: "dinner",
    });
  });
  it("tagTransaction other fields stay closed even with step-up", () => {
    expect(execute(ds, cmd("tagTransaction", { txn_id: "o1", flow: "income" }), ctx(NOW, true)).error).toBe(
      "closed_month",
    );
    expect(
      execute(
        ds,
        cmd("tagTransaction", { txn_id: "o1", category_id: "misc", loan_id: null, linked_txn_id: null }),
        ctx(NOW, true),
      ).ok,
    ).toBe(true);
  });
  it("reopenMonth requires step-up and a closed month", () => {
    expect(execute(ds, cmd("reopenMonth", { month: "2026-10", reason: "bank fix" }), ctx()).error).toBe(
      "step_up_required",
    );
    const out = execute(ds, cmd("reopenMonth", { month: "2026-10", reason: "bank fix" }), ctx(NOW, true));
    expect(rowsOf(out.mutations, "months")[0]).toMatchObject({
      id: "2026-10",
      status: "open",
      closed_at: null,
    });
    expect(execute(ds, cmd("reopenMonth", { month: "2026-09", reason: "nope" }), ctx(NOW, true)).error).toBe(
      "invalid",
    );
  });
  it("closeMonth refuses an already-closed month", () => {
    expect(execute(ds, cmd("closeMonth", { month: "2026-10" }), ctx()).error).toBe("invalid");
  });
  it("mergeCounterparties may repoint closed-month rows (identity only)", () => {
    const a = cp("Danish");
    const b = cp("Danish A", { aliases: ["DANISH A"] });
    const d2 = closeMonthRecord(
      withRows(seeded(), { counterparties: [a, b], transactions: [{ ...oct, counterparty_id: b.id }] }),
      "2026-10",
    );
    expect(execute(d2, cmd("mergeCounterparties", { into_id: a.id, from_ids: [b.id] }), ctx()).ok).toBe(true);
  });
});

describe("closeMonth", () => {
  it("is refused with the blocking items listed when the checklist fails", () => {
    const out = execute(seeded(), cmd("closeMonth", { month: "2026-10" }), ctx());
    expect(out.error).toBe("invalid");
    expect(out.message).toContain("Can't close Oct 2026");
    expect(out.message).toContain("SadaPay statement missing for 1–31 Oct");
  });
});

describe("reference data commands", () => {
  const ds = seeded();
  it("upsertCategory enforces two levels", () => {
    const c = (parent_id: string | null, id = "x") =>
      cmd("upsertCategory", {
        category_id: id,
        parent_id,
        name: "X",
        icon: "coins",
        wallet_hint: null,
        nature: "variable",
        hidden: false,
        sort: 99,
      });
    expect(execute(ds, c("food"), ctx()).ok).toBe(true);
    expect(execute(ds, c("food.friends"), ctx()).error).toBe("invalid");
    expect(execute(ds, c("nope"), ctx()).error).toBe("invalid");
    expect(execute(ds, c("car", "food"), ctx()).error).toBe("invalid"); // food has children
  });
  it("upsertRule validates the regex; deleteRule tombstones", () => {
    const r = (pattern: string) =>
      cmd("upsertRule", {
        rule_id: "r1",
        pattern,
        category_id: "misc",
        flow: null,
        counterparty_id: null,
        priority: 5,
      });
    expect(execute(ds, r("(["), ctx()).error).toBe("invalid");
    const ds2 = apply(ds, execute(ds, r("tea"), ctx()).mutations);
    expect(
      rowsOf(execute(ds2, cmd("deleteRule", { rule_id: "r1" }), ctx()).mutations, "rules")[0],
    ).toMatchObject({ id: "r1", deleted: true });
    expect(execute(ds, cmd("deleteRule", { rule_id: "r1" }), ctx()).error).toBe("not_found");
  });
  it("upsertCounterparty normalises aliases", () => {
    const out = execute(
      ds,
      cmd("upsertCounterparty", {
        counterparty_id: "c1",
        name: "Ali",
        kind: "person",
        aliases: ["ali khan", "ALI KHAN 0300"],
        default_category_id: null,
        default_flow: null,
      }),
      ctx(),
    );
    expect(rowsOf(out.mutations, "counterparties")[0]?.aliases).toEqual(["ALI KHAN"]);
  });
  it("mergeCounterparties repoints transactions, recurring, loans and merges aliases", () => {
    const a = cp("Danish", { aliases: ["DANISH"] });
    const b = cp("Danish Ahmed", { aliases: ["DANISH AHMED"], default_category_id: "food" });
    const t = txn({ occurred_at: "2026-11-02T10:00", amount: -1, counterparty_id: b.id });
    const r = recurring("Danish rent", 100, { counterparty_id: b.id });
    const d2 = withRows(ds, { counterparties: [a, b], transactions: [t], recurring: [r] });
    const out = execute(d2, cmd("mergeCounterparties", { into_id: a.id, from_ids: [b.id] }), ctx());
    const after = apply(d2, out.mutations);
    expect(after.counterparties.find((c) => c.id === a.id)).toMatchObject({
      aliases: ["DANISH", "DANISH AHMED"],
      default_category_id: "food",
    });
    expect(after.counterparties.some((c) => c.id === b.id)).toBe(false);
    expect(after.transactions.find((x) => x.id === t.id)?.counterparty_id).toBe(a.id);
    expect(after.recurring[0]?.counterparty_id).toBe(a.id);
    expect(execute(d2, cmd("mergeCounterparties", { into_id: a.id, from_ids: [a.id] }), ctx()).error).toBe(
      "invalid",
    );
  });
  it("recurring, loan and goal upserts produce full rows", () => {
    const rec = execute(
      ds,
      cmd("upsertRecurring", {
        recurring_id: "r1",
        name: "iCloud",
        account_id: "sadapay",
        category_id: "subscriptions.icloud",
        counterparty_id: null,
        amount: -90000,
        day_of_month: 3,
        active: true,
      }),
      ctx(),
    );
    expect(rowsOf(rec.mutations, "recurring")[0]).toMatchObject({
      amount: 90000,
      detected: false,
      version: 0,
    });
    const ds2 = apply(ds, rec.mutations);
    expect(
      rowsOf(execute(ds2, cmd("deleteRecurring", { recurring_id: "r1" }), ctx()).mutations, "recurring")[0]
        ?.deleted,
    ).toBe(true);
    const ln = execute(
      ds,
      cmd("upsertLoan", {
        loan_id: "l1",
        lender: "Mom",
        counterparty_id: null,
        principal: 9000000,
        started_on: "2026-11-01",
        purpose: "Bicycle",
        installment: 900000,
        note: null,
        manual_repaid: 0,
        closed_on: null,
      }),
      ctx(),
    );
    expect(rowsOf(ln.mutations, "loans")[0]).toMatchObject({ principal: 9000000, installment: 900000 });
    expect(
      execute(
        ds,
        cmd("upsertLoan", {
          loan_id: "l1",
          lender: "Mom",
          counterparty_id: null,
          principal: 0,
          started_on: "2026-11-01",
          purpose: "x",
          installment: 1,
          note: null,
          manual_repaid: 0,
          closed_on: null,
        }),
        ctx(),
      ).error,
    ).toBe("invalid");
  });
  it("moveGoal can't overdraw an envelope; deleteGoal tombstones its moves", () => {
    const g = goal({ id: "g1", target: 100000, monthly: 10000 });
    const m = move("g1", 30000, "2026-10-01");
    const d2 = withRows(ds, { goals: [g], goal_moves: [m] });
    expect(
      execute(
        d2,
        cmd("moveGoal", { move_id: "m2", goal_id: "g1", amount: -40000, on: "2026-11-01", note: null }),
        ctx(),
      ).error,
    ).toBe("invalid");
    expect(
      execute(
        d2,
        cmd("moveGoal", { move_id: "m2", goal_id: "g1", amount: -30000, on: "2026-11-01", note: null }),
        ctx(),
      ).ok,
    ).toBe(true);
    expect(
      execute(
        d2,
        cmd("moveGoal", { move_id: "m2", goal_id: "zz", amount: 1, on: "2026-11-01", note: null }),
        ctx(),
      ).error,
    ).toBe("not_found");
    const del = execute(d2, cmd("deleteGoal", { goal_id: "g1" }), ctx());
    expect(del.mutations.map((x) => `${x.table}:${x.row.deleted}`)).toEqual([
      "goals:true",
      "goal_moves:true",
    ]);
  });
  it("setSetting validates known keys", () => {
    expect(execute(ds, cmd("setSetting", { key: "avg_window", value: "3" }), ctx()).ok).toBe(true);
    expect(execute(ds, cmd("setSetting", { key: "avg_window", value: "4" }), ctx()).error).toBe("invalid");
    expect(execute(ds, cmd("setSetting", { key: "income_monthly", value: "-1" }), ctx()).error).toBe(
      "invalid",
    );
  });
});
