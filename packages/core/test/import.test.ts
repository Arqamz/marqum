import { describe, expect, it } from "vitest";
import { execute } from "../src/commands.ts";
import type { Dataset } from "../src/types.ts";
import {
  apply,
  closeMonthRecord,
  cmd,
  ctx,
  importCmd,
  parsed,
  prov,
  seeded,
  srow,
  withRows,
} from "./builders.ts";

const R1 = srow(
  "naya:1",
  "2026-11-02T10:00",
  -50000,
  "Outgoing fund transfer to Danish Ahmed\nMeezan-0000|Transaction ID 000001",
);
const R2 = srow("naya:2", "2026-11-03T18:30", -300000, "POS Purchase SHELL 001 KARACHI");
const R3 = srow("naya:3", "2026-11-05T09:00", 1000000, "Incoming fund transfer from Test User SadaPay");
const NOV1_7 = (rows = [R1, R2, R3], opening: number | null = 500000, closing: number | null = 1150000) =>
  parsed("nayapay", "2026-11-01", "2026-11-07", rows, opening, closing);

function imported(ds: Dataset = seeded()) {
  const out = execute(ds, importCmd(NOV1_7()), ctx());
  expect(out.ok).toBe(true);
  return { out, ds: apply(ds, out.mutations) };
}

describe("importStatement: first import", () => {
  it("adds verified rows, classifies them and creates counterparties", () => {
    const { out, ds } = imported();
    expect(out.result).toMatchObject({
      added: 3,
      updated: 0,
      unchanged: 0,
      removed: 0,
      matched: 0,
      disputed: 0,
    });
    const byExt = new Map(ds.transactions.map((t) => [t.external_id, t]));
    expect(byExt.get("naya:1")).toMatchObject({
      status: "verified",
      source: "statement",
      flow: "spend",
      version: 0,
    });
    expect(byExt.get("naya:2")).toMatchObject({ category_id: "car.petrol", flow: "spend" });
    expect(byExt.get("naya:3")).toMatchObject({ flow: "internal", category_id: null });
    const danish = ds.counterparties.find((c) => c.aliases.includes("DANISH AHMED"));
    expect(danish).toMatchObject({ name: "Danish Ahmed", kind: "person" });
    expect(byExt.get("naya:1")?.counterparty_id).toBe(danish?.id);
    expect(ds.counterparties.find((c) => c.aliases.includes("SHELL"))?.kind).toBe("merchant");
  });
  it("writes the statement and its opening/closing anchors", () => {
    const { ds } = imported();
    expect(ds.statements).toHaveLength(1);
    expect(ds.statements[0]).toMatchObject({
      period_from: "2026-11-01",
      period_to: "2026-11-07",
      row_count: 3,
    });
    const anchors = ds.balances.map((b) => [b.source, b.as_of, b.balance]);
    expect(anchors).toEqual([
      ["statement_open", "2026-10-31T23:59", 500000],
      ["statement_close", "2026-11-07T23:59", 1150000],
    ]);
  });
  it("rejects rows outside the period and duplicate external ids", () => {
    const outside = srow("naya:9", "2026-11-08T00:00", -1, "x");
    expect(execute(seeded(), importCmd(NOV1_7([R1, outside])), ctx()).error).toBe("invalid");
    expect(execute(seeded(), importCmd(NOV1_7([R1, R1])), ctx()).error).toBe("invalid");
  });
});

describe("importStatement: replace semantics", () => {
  it("re-importing the identical statement changes nothing", () => {
    const { ds } = imported();
    const again = execute(ds, importCmd(NOV1_7()), ctx());
    expect(again.result).toMatchObject({
      added: 0,
      updated: 0,
      unchanged: 3,
      removed: 0,
      matched: 0,
      disputed: 0,
    });
    expect(again.mutations).toEqual([]);
  });
  it("a changed row is updated in place and keeps the user's tags", () => {
    const { ds } = imported();
    const t1 = ds.transactions.find((t) => t.external_id === "naya:1");
    const tagged = apply(
      ds,
      execute(
        ds,
        cmd("tagTransaction", { txn_id: t1?.id ?? "", category_id: "food.friends", reason: "lunch" }),
        ctx(),
      ).mutations,
    );
    const changed = {
      ...R1,
      amount: -55000,
      description: "Outgoing fund transfer to Danish Ahmed (corrected)",
    };
    const out = execute(tagged, importCmd(NOV1_7([changed, R2, R3])), ctx());
    expect(out.result).toMatchObject({ added: 0, updated: 1, unchanged: 2, removed: 0 });
    const row = apply(tagged, out.mutations).transactions.find((t) => t.external_id === "naya:1");
    expect(row).toMatchObject({ id: t1?.id, amount: -55000, category_id: "food.friends", reason: "lunch" });
  });
  it("a row missing from the new statement is deleted", () => {
    const { ds } = imported();
    const out = execute(ds, importCmd(NOV1_7([R1, R3])), ctx());
    expect(out.result).toMatchObject({ removed: 1, unchanged: 2 });
    expect(
      apply(ds, out.mutations)
        .transactions.filter((t) => t.flow !== "carry")
        .map((t) => t.external_id)
        .sort(),
    ).toEqual(["naya:1", "naya:3"]);
  });
  it("only touches the statement's wallet and period", () => {
    const { ds } = imported();
    const later = parsed("nayapay", "2026-11-08", "2026-11-14", [
      srow("naya:4", "2026-11-09T10:00", -1000, "POS Purchase CAFE ONE"),
    ]);
    const out = execute(ds, importCmd(later), ctx());
    expect(out.result).toMatchObject({ added: 1, removed: 0 });
    const sada = parsed("sadapay", "2026-11-01", "2026-11-07", []);
    expect(execute(ds, importCmd(sada), ctx()).result).toMatchObject({ removed: 0 });
  });
  it("replaces its own balance anchors on re-import with a corrected closing", () => {
    const { ds } = imported();
    const out = execute(ds, importCmd(NOV1_7(undefined, 500000, 1150100)), ctx());
    const after = apply(ds, out.mutations);
    expect(after.balances.filter((b) => b.source === "statement_close").map((b) => b.balance)).toEqual([
      1150100,
    ]);
    expect(after.balances).toHaveLength(2);
  });
});

describe("importStatement: provisional rows", () => {
  const p1 = prov({
    id: "p1",
    occurred_at: "2026-11-02T08:00",
    amount: -50000,
    reason: "lunch with Danish",
    category_id: "food.friends",
  });
  const p2 = prov({ id: "p2", occurred_at: "2026-11-04T12:00", amount: -99900, reason: "phantom" });
  const p3 = prov({ id: "p3", occurred_at: "2026-11-09T12:00", amount: -100 });
  const ds = withRows(seeded(), { transactions: [p1, p2, p3] });

  it("a matched provisional row becomes the verified row (keeps id, reason, category); not inserted twice", () => {
    const out = execute(ds, importCmd(NOV1_7()), ctx());
    expect(out.result).toMatchObject({ added: 2, matched: 1, disputed: 1 });
    const after = apply(ds, out.mutations);
    const m = after.transactions.find((t) => t.id === "p1");
    expect(m).toMatchObject({
      status: "verified",
      source: "statement",
      external_id: "naya:1",
      reason: "lunch with Danish",
      category_id: "food.friends",
      occurred_at: "2026-11-02T10:00",
    });
    expect(after.transactions.filter((t) => t.external_id === "naya:1")).toHaveLength(1);
  });
  it("unmatched provisional rows inside the period become disputed; outside stay provisional", () => {
    const after = apply(ds, execute(ds, importCmd(NOV1_7()), ctx()).mutations);
    expect(after.transactions.find((t) => t.id === "p2")?.status).toBe("disputed");
    expect(after.transactions.find((t) => t.id === "p3")?.status).toBe("provisional");
  });
});

describe("importStatement: closed months", () => {
  const OCT = (rows = [srow("naya:o1", "2026-10-10T10:00", -20000, "POS Purchase CAFE ONE")]) =>
    parsed("nayapay", "2026-10-01", "2026-10-31", rows, 100000, 80000);
  const base = () => {
    const ds = seeded();
    return closeMonthRecord(apply(ds, execute(ds, importCmd(OCT()), ctx()).mutations), "2026-10");
  };

  it("re-importing an identical closed-month statement is a no-op", () => {
    const out = execute(base(), importCmd(OCT()), ctx());
    expect(out.ok).toBe(true);
    expect(out.mutations).toEqual([]);
  });
  it("a statement that changes a closed month is refused, even with step-up", () => {
    const changed = OCT([srow("naya:o1", "2026-10-10T10:00", -21000, "POS Purchase CAFE ONE")]);
    expect(execute(base(), importCmd(changed), ctx(undefined, true)).error).toBe("closed_month");
    const added = OCT([
      srow("naya:o1", "2026-10-10T10:00", -20000, "POS Purchase CAFE ONE"),
      srow("naya:o2", "2026-10-11T10:00", -1, "x"),
    ]);
    expect(execute(base(), importCmd(added), ctx()).error).toBe("closed_month");
  });
  it("a longer statement overlapping a closed month is fine when the closed part is identical", () => {
    const longer = parsed(
      "nayapay",
      "2026-10-01",
      "2026-11-07",
      [
        srow("naya:o1", "2026-10-10T10:00", -20000, "POS Purchase CAFE ONE"),
        srow("naya:n1", "2026-11-02T10:00", -500, "POS Purchase CAFE TWO"),
      ],
      100000,
      79500,
    );
    const out = execute(base(), importCmd(longer), ctx());
    expect(out.ok).toBe(true);
    expect(out.result).toMatchObject({ added: 1, unchanged: 1 });
    const wrong = { ...longer, opening: 100100 };
    expect(execute(base(), importCmd(wrong), ctx()).error).toBe("closed_month");
  });
});

describe("importStatement: SadaPay re-parse and the statement holder", () => {
  const SADA = (rows: ReturnType<typeof srow>[], holder: string | null = "Test User Zia") => ({
    ...parsed("sadapay", "2026-11-01", "2026-11-10", rows),
    holder,
  });
  const FUND = srow("sada:hA", "2026-11-03T16:49", 163500, "From TEST USER (Meezan Bank (MBL))");
  const OTHER = srow("sada:hB", "2026-11-09T17:36", 300000, "From OTHER PERSON (Meezan Bank (MBL))");
  const WALLET = srow("sada:hC", "2026-11-05T10:00", 500000, "From TEST USER (NayaPay)");

  it("a transfer naming the holder is you: Meezan → funding, NayaPay → internal; others at Meezan are income", () => {
    const out = execute(seeded(), importCmd(SADA([FUND, OTHER, WALLET])), ctx());
    expect(out.ok).toBe(true);
    const ds = apply(seeded(), out.mutations);
    const by = new Map(ds.transactions.map((t) => [t.external_id, t]));
    expect(by.get("sada:hA")?.flow).toBe("funding");
    expect(by.get("sada:hB")?.flow).toBe("income");
    expect(by.get("sada:hC")?.flow).toBe("internal");
    expect(ds.counterparties.find((c) => c.aliases.includes("TEST USER"))?.kind).toBe("self");
    expect(ds.counterparties.find((c) => c.aliases.includes("OTHER PERSON"))?.kind).toBe("person");
  });

  it("upgrades an existing 'person' counterparty that is really the holder to self", () => {
    const base = withRows(seeded(), {
      counterparties: [
        {
          id: "cp-me",
          name: "Test User",
          kind: "person",
          aliases: ["TEST USER"],
          default_category_id: null,
          default_flow: null,
          version: 1,
          deleted: false,
        },
      ],
    });
    const out = execute(base, importCmd(SADA([FUND])), ctx());
    const ds = apply(base, out.mutations);
    expect(ds.counterparties.find((c) => c.id === "cp-me")?.kind).toBe("self");
    expect(ds.transactions.find((t) => t.external_id === "sada:hA")?.flow).toBe("funding");
  });

  it("re-keys rows whose text now parses differently, keeping your tags", () => {
    // first import: the old parser glued the next merchant onto this row and lost the sender's name
    const oldOther = srow("sada:hOLD", OTHER.occurred_at, OTHER.amount, "(MBL))");
    const oldCard = srow("sada:hOLDCARD", "2026-11-06T20:48", -278799, "Karachi Si Pak");
    let ds = apply(seeded(), execute(seeded(), importCmd(SADA([oldOther, oldCard])), ctx()).mutations);
    const tagged = ds.transactions.find((t) => t.external_id === "sada:hOLD");
    if (!tagged) throw new Error("missing");
    ds = apply(
      ds,
      execute(
        ds,
        cmd("tagTransaction", { txn_id: tagged.id, flow: "reimbursement", category_id: "food" }),
        ctx(),
      ).mutations,
    );
    // corrected statement: new ids and descriptions for the same two transactions
    const newCard = srow(
      "sada:hNEWCARD",
      oldCard.occurred_at,
      oldCard.amount,
      "Food Panda 18th Floor, Office # 1-4, Karachi Si Pak",
    );
    const out = execute(ds, importCmd(SADA([OTHER, newCard]), "b".repeat(64)), ctx());
    expect(out.result).toMatchObject({ added: 0, updated: 2, removed: 0 });
    ds = apply(ds, out.mutations);
    const live = ds.transactions.filter((t) => !t.deleted && t.source === "statement");
    expect(live).toHaveLength(2);
    const reimb = live.find((t) => t.id === tagged.id);
    expect(reimb).toMatchObject({
      external_id: "sada:hB",
      description: "From OTHER PERSON (Meezan Bank (MBL))",
      flow: "reimbursement",
      category_id: "food",
    });
    const card = live.find((t) => t.external_id === "sada:hNEWCARD");
    expect(card?.category_id).toBe("food");
    expect(ds.counterparties.find((c) => c.id === card?.counterparty_id)?.name).toBe("Food Panda");
  });
});
