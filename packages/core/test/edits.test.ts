import { describe, expect, it } from "vitest";
import { execute } from "../src/commands.ts";
import { apply, cmd, ctx, prov, seeded, withRows } from "./builders.ts";

const lunch = prov({
  id: "lunch",
  account_id: "nayapay",
  occurred_at: "2026-11-10T13:00",
  amount: -145000,
  flow: "spend",
});
const ds0 = () => withRows(seeded("2026-11-01"), { transactions: [lunch] });

describe("editProvisional", () => {
  it("fixes amount, time and wallet and makes a disputed row provisional again", () => {
    const ds = withRows(seeded("2026-11-01"), { transactions: [{ ...lunch, status: "disputed" }] });
    const out = execute(
      ds,
      cmd("editProvisional", {
        txn_id: "lunch",
        amount: -150000,
        occurred_at: "2026-11-07T20:00",
        account_id: "sadapay",
      }),
      ctx(),
    );
    expect(out.ok).toBe(true);
    expect(apply(ds, out.mutations).transactions.find((t) => t.id === "lunch")).toMatchObject({
      amount: -150000,
      occurred_at: "2026-11-07T20:00",
      account_id: "sadapay",
      status: "provisional",
      flow: "spend",
    });
  });
  it("switches a spend to income when the direction flips", () => {
    const out = execute(
      ds0(),
      cmd("editProvisional", {
        txn_id: "lunch",
        amount: 145000,
        occurred_at: lunch.occurred_at,
        account_id: "nayapay",
      }),
      ctx(),
    );
    expect(apply(ds0(), out.mutations).transactions.find((t) => t.id === "lunch")?.flow).toBe("income");
  });
  it("refuses verified rows, zero amounts and dates before tracking", () => {
    const v = withRows(seeded("2026-11-01"), { transactions: [{ ...lunch, status: "verified" }] });
    const args = {
      txn_id: "lunch",
      amount: -1,
      occurred_at: "2026-11-10T13:00",
      account_id: "nayapay" as const,
    };
    expect(execute(v, cmd("editProvisional", args), ctx()).error).toBe("invalid");
    expect(execute(ds0(), cmd("editProvisional", { ...args, amount: 0 }), ctx()).error).toBe("invalid");
    expect(
      execute(ds0(), cmd("editProvisional", { ...args, occurred_at: "2026-10-30T10:00" }), ctx()).error,
    ).toBe("invalid");
  });
});

describe("deleteBalance", () => {
  const bal = (id: string, source: "manual" | "statement_close") => ({
    id,
    account_id: "nayapay" as const,
    as_of: "2026-11-10T10:00",
    balance: 100,
    source,
    statement_id: null,
    version: 1,
    deleted: false,
  });
  it("removes balances you typed only", () => {
    const ds = withRows(seeded("2026-11-01"), {
      balances: [bal("b1", "manual"), bal("b2", "statement_close")],
    });
    expect(execute(ds, cmd("deleteBalance", { entry_id: "b1" }), ctx()).ok).toBe(true);
    expect(execute(ds, cmd("deleteBalance", { entry_id: "b2" }), ctx()).error).toBe("invalid");
  });
});
