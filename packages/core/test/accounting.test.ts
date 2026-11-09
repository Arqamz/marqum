import { describe, expect, it } from "vitest";
import {
  availableMonths,
  categoryBreakdown,
  categoryCards,
  categoryMonthDetail,
  monthLedger,
  monthsToClose,
  netPosition,
  trackedMonths,
  walletMonthDetail,
} from "../src/analytics.ts";
import { buildSnapshot, closeChecklist } from "../src/close.ts";
import { execute } from "../src/commands.ts";
import { applyMutations, emptyDataset, seedMutations, trackingStart } from "../src/dataset.ts";
import type { Dataset } from "../src/types.ts";
import { apply, cmd, ctx, importCmd, parsed, prov, rowsOf, seeded, srow, txn, withRows } from "./builders.ts";

const DEC2 = "2026-12-02T10:00";
const run = (ds: Dataset, c: ReturnType<typeof cmd>, now = DEC2, steppedUp = false) => {
  const out = execute(ds, c, ctx(now, steppedUp));
  if (!out.ok) throw new Error(`${out.error}: ${out.message}`);
  return apply(ds, out.mutations);
};
const bf = (ds: Dataset, acc: string, month: string) =>
  ds.transactions.find((t) => t.id === `carry:bf:${acc}:${month}` && !t.deleted);
const cf = (ds: Dataset, acc: string, month: string) =>
  ds.transactions.find((t) => t.id === `carry:cf:${acc}:${month}` && !t.deleted);

/**
 * November 2026 = first tracked month.
 *   NayaPay: statement 1–30 Nov, opening Rs 5,000 → Shell −3,000, transfer in from SadaPay +1,000 → closing Rs 3,000
 *   SadaPay: statement 1–30 Nov without balances; opening set to Rs 2,000 → to NayaPay −1,000, iCloud −900 → Rs 100
 */
function november(): Dataset {
  let ds = seeded("2026-11-01");
  ds = run(
    ds,
    importCmd(
      parsed(
        "nayapay",
        "2026-11-01",
        "2026-11-30",
        [
          srow("naya:1", "2026-11-03T18:30", -300000, "POS Purchase SHELL 001 KARACHI"),
          srow("naya:2", "2026-11-04T09:00", 100000, "Incoming fund transfer from Test User SadaPay"),
        ],
        500000,
        300000,
      ),
    ),
  );
  ds = run(
    ds,
    importCmd(
      parsed("sadapay", "2026-11-01", "2026-11-30", [
        srow("sada:1", "2026-11-04T08:59", -100000, "To TEST USER (NayaPay)"),
        srow("sada:2", "2026-11-05T10:00", -90000, "Card payment APPLE.COM/BILL"),
      ]),
      "b".repeat(64),
    ),
  );
  return run(ds, cmd("setOpeningBalance", { account_id: "sadapay", amount: 200000 }));
}

describe("tracking start", () => {
  it("defaults to 1 Nov 2026 and seeds a b/f row per wallet", () => {
    const ds = applyMutations(emptyDataset(), seedMutations("2026-11-09T10:00"));
    expect(trackingStart(ds)).toBe("2026-11-01");
    expect(ds.transactions.map((t) => [t.id, t.amount, t.occurred_at, t.description])).toEqual([
      ["carry:bf:sadapay:2026-11", 0, "2026-11-01T00:00", "Balance brought forward from Oct 2026"],
      ["carry:bf:nayapay:2026-11", 0, "2026-11-01T00:00", "Balance brought forward from Oct 2026"],
    ]);
  });
  it("nothing before it exists: no October to close, no October in balances or months", () => {
    const ds = withRows(seeded("2026-11-01"), {
      transactions: [txn({ occurred_at: "2026-10-20T10:00", amount: -999900, category_id: "food" })],
    });
    expect(trackedMonths(ds, "2026-11-09T10:00")).toEqual(["2026-11"]);
    expect(availableMonths(ds, "2027-01-02T10:00")).toEqual(["2026-11", "2026-12", "2027-01"]);
    expect(monthsToClose(ds, "2026-11-09T10:00")).toEqual([]);
    expect(monthsToClose(ds, DEC2)).toEqual(["2026-11"]);
    expect(closeChecklist(ds, "2026-10", "2026-11-09T10:00").can_close).toBe(false);
    expect(netPosition(ds, "2026-11-09T10:00").wallet_total).toBe(0);
    expect(
      categoryCards(ds, "2026-10", "2026-11-09T10:00").find((c) => c.category.id === "food"),
    ).toBeUndefined();
  });
  it("rejects new data dated before it and ignores statement rows before it", () => {
    const ds = seeded("2026-11-01");
    const add = cmd("addProvisional", {
      txn_id: "p1",
      account_id: "nayapay",
      occurred_at: "2026-10-31T10:00",
      amount: -100,
      reason: null,
      category_id: null,
      flow: null,
      counterparty_name: null,
    });
    expect(execute(ds, add, ctx()).error).toBe("invalid");
    const st = parsed(
      "nayapay",
      "2026-10-15",
      "2026-11-14",
      [
        srow("n:old", "2026-10-20T10:00", -20000, "POS Purchase CAFE ONE"),
        srow("n:new", "2026-11-02T10:00", -1000, "POS Purchase CAFE TWO"),
      ],
      100000,
      79000,
    );
    const out = execute(ds, importCmd(st), ctx());
    expect(out.result).toMatchObject({ added: 1, ignored: 1 });
    const after = apply(ds, out.mutations);
    // b/f = opening + rows before tracking start = 100,000 − 20,000
    expect(bf(after, "nayapay", "2026-11")).toMatchObject({
      amount: 80000,
      reason: "Opening balance from statement",
    });
    expect(
      netPosition(after, "2026-11-09T10:00").wallets.find((w) => w.account_id === "nayapay")?.balance,
    ).toBe(79000);
  });
});

describe("opening balance (first-month b/f)", () => {
  it("comes from the statement opening, or setOpeningBalance, which a later import doesn't override", () => {
    const ds = november();
    expect(bf(ds, "nayapay", "2026-11")).toMatchObject({
      amount: 500000,
      reason: "Opening balance from statement",
      source: "system",
      flow: "carry",
      status: "verified",
      category_id: null,
    });
    expect(bf(ds, "sadapay", "2026-11")).toMatchObject({
      amount: 200000,
      reason: "Opening balance set by you",
    });
    const set = run(ds, cmd("setOpeningBalance", { account_id: "nayapay", amount: 450000 }));
    const reimport = execute(
      set,
      importCmd(parsed("nayapay", "2026-11-01", "2026-11-07", [], 500000, 500000), "c".repeat(64)),
      ctx(DEC2),
    );
    expect(bf(apply(set, reimport.mutations), "nayapay", "2026-11")?.amount).toBe(450000);
  });
  it("your own name seen on an internal transfer becomes a self counterparty, so later transfers stay internal", () => {
    const ds = november();
    expect(ds.counterparties.find((c) => c.aliases.includes("TEST USER"))?.kind).toBe("self");
    expect(ds.transactions.find((t) => t.external_id === "sada:1")?.flow).toBe("internal");
  });
  it("is added by any command when missing", () => {
    const bare = { ...seeded("2026-11-01"), transactions: [] };
    const out = execute(bare, cmd("setSetting", { key: "avg_window", value: "3" }), ctx());
    expect(rowsOf(out.mutations, "transactions").map((r) => [r.id, r.amount])).toEqual([
      ["carry:bf:sadapay:2026-11", 0],
      ["carry:bf:nayapay:2026-11", 0],
    ]);
    expect(
      execute(seeded("2026-11-01"), cmd("setSetting", { key: "avg_window", value: "3" }), ctx()).mutations,
    ).toHaveLength(1);
  });
  it("imports never delete or alter system rows", () => {
    const ds = november();
    const out = execute(
      ds,
      importCmd(parsed("nayapay", "2026-11-01", "2026-11-30", []), "d".repeat(64)),
      ctx(DEC2),
    );
    expect(out.result).toMatchObject({ removed: 2 });
    expect(rowsOf(out.mutations, "transactions").some((r) => String(r.id).startsWith("carry:"))).toBe(false);
  });
  it("can't be changed once the first month is closed", () => {
    const closed = run(november(), cmd("closeMonth", { month: "2026-11" }));
    expect(
      execute(closed, cmd("setOpeningBalance", { account_id: "sadapay", amount: 1 }), ctx(DEC2, true)).error,
    ).toBe("closed_month");
  });
});

describe("closing a month writes c/f and the next b/f (Nov → Dec)", () => {
  it("c/f = −closing on 30 Nov 23:59, b/f = +closing on 1 Dec 00:00; balances unchanged", () => {
    const ds = november();
    expect(closeChecklist(ds, "2026-11", DEC2).can_close).toBe(true);
    const before = netPosition(ds, DEC2).wallets.map((w) => [w.account_id, w.balance]);
    const closed = run(ds, cmd("closeMonth", { month: "2026-11" }));
    expect(cf(closed, "nayapay", "2026-11")).toMatchObject({
      amount: -300000,
      occurred_at: "2026-11-30T23:59",
      description: "Balance carried forward to Dec 2026",
      external_id: "carry:cf:nayapay:2026-11",
    });
    expect(bf(closed, "nayapay", "2026-12")).toMatchObject({
      amount: 300000,
      occurred_at: "2026-12-01T00:00",
      description: "Balance brought forward from Nov 2026",
    });
    expect(cf(closed, "sadapay", "2026-11")?.amount).toBe(-10000);
    expect(netPosition(closed, DEC2).wallets.map((w) => [w.account_id, w.balance])).toEqual(before);
    expect(before).toEqual([
      ["sadapay", 10000],
      ["nayapay", 300000],
    ]);
  });
  it("monthLedger reads b/f → in → out → closing → c/f", () => {
    const open = november();
    const nov = monthLedger(open, "nayapay", "2026-11", DEC2);
    expect(nov).toMatchObject({
      month: "2026-11",
      brought_forward: 500000,
      brought_forward_virtual: false,
      inflow: 100000,
      outflow: 300000,
      closing: 300000,
      carried_forward: null,
    });
    expect(nov.transactions.map((t) => t.external_id)).toEqual(["naya:1", "naya:2"]);
    // December while November is open: virtual b/f = November's computed closing
    expect(monthLedger(open, "nayapay", "2026-12", DEC2)).toMatchObject({
      brought_forward: 300000,
      brought_forward_virtual: true,
    });
    const closed = run(open, cmd("closeMonth", { month: "2026-11" }));
    expect(monthLedger(closed, "nayapay", "2026-11", DEC2)).toMatchObject({
      closing: 300000,
      carried_forward: -300000,
    });
    expect(monthLedger(closed, "nayapay", "2026-12", DEC2)).toMatchObject({
      brought_forward: 300000,
      brought_forward_virtual: false,
    });
  });
  it("carry rows are sealed in the snapshot and can't be edited", async () => {
    const closed = run(november(), cmd("closeMonth", { month: "2026-11" }));
    const snap = JSON.parse((await buildSnapshot(closed, "2026-11")).json);
    expect(
      snap.transactions
        .filter((t: { flow: string }) => t.flow === "carry")
        .map((t: { id: string }) => t.id)
        .sort(),
    ).toEqual([
      "carry:bf:nayapay:2026-11",
      "carry:bf:sadapay:2026-11",
      "carry:cf:nayapay:2026-11",
      "carry:cf:sadapay:2026-11",
    ]);
    expect(
      execute(
        closed,
        cmd("tagTransaction", { txn_id: "carry:cf:nayapay:2026-11", reason: "x" }),
        ctx(DEC2, true),
      ).error,
    ).toBe("invalid");
  });
  it("reopen removes the c/f and the next b/f; reopening needs the later month open", () => {
    const closed = run(november(), cmd("closeMonth", { month: "2026-11" }));
    const reopened = run(closed, cmd("reopenMonth", { month: "2026-11", reason: "bank fix" }), DEC2, true);
    expect(cf(reopened, "nayapay", "2026-11")).toBeUndefined();
    expect(bf(reopened, "nayapay", "2026-12")).toBeUndefined();
    expect(bf(reopened, "nayapay", "2026-11")?.amount).toBe(500000);
    const decClosed = {
      ...closed,
      months: [
        ...closed.months,
        {
          id: "2026-12",
          status: "closed" as const,
          closed_at: DEC2,
          snapshot_key: null,
          snapshot_sha256: null,
          version: 1,
          deleted: false,
        },
      ],
    };
    expect(
      execute(decClosed, cmd("reopenMonth", { month: "2026-11", reason: "bank fix" }), ctx(DEC2, true)),
    ).toMatchObject({
      error: "invalid",
      message: "Reopen Dec 2026 first",
    });
  });
  it("walletMonthDetail: daily net flow and closing", () => {
    const d = walletMonthDetail(november(), "nayapay", "2026-11", DEC2);
    expect(d.daily).toHaveLength(30);
    expect(d.daily[2]).toEqual({ date: "2026-11-03", net: -300000, closing: 200000 });
    expect(d.daily[3]).toEqual({ date: "2026-11-04", net: 100000, closing: 300000 });
    expect(d.daily.at(-1)?.closing).toBe(d.closing);
  });
});

describe("resetLedger", () => {
  it("needs step-up, wipes the ledger, moves tracking start and re-opens with b/f 0", () => {
    const ds = run(november(), cmd("closeMonth", { month: "2026-11" }));
    const reset = cmd("resetLedger", { tracking_start: "2027-01-01", confirm: "RESET" });
    expect(execute(ds, reset, ctx(DEC2)).error).toBe("step_up_required");
    const out = execute(ds, reset, ctx(DEC2, true));
    expect(out.ok).toBe(true);
    const after = apply(ds, out.mutations);
    expect(trackingStart(after)).toBe("2027-01-01");
    expect(after.statements).toEqual([]);
    expect(after.balances).toEqual([]);
    expect(after.months).toEqual([]);
    expect(after.transactions.map((t) => [t.id, t.amount])).toEqual([
      ["carry:bf:sadapay:2027-01", 0],
      ["carry:bf:nayapay:2027-01", 0],
    ]);
    // configuration is kept
    expect(after.categories.length).toBe(ds.categories.length);
  });
  it("re-using the same start keeps one b/f row per wallet (no tombstone + insert of the same id)", () => {
    const out = execute(
      november(),
      cmd("resetLedger", { tracking_start: "2026-11-01", confirm: "RESET" }),
      ctx(DEC2, true),
    );
    const bfWrites = rowsOf(out.mutations, "transactions").filter((r) =>
      String(r.id).startsWith("carry:bf:"),
    );
    expect(bfWrites.map((r) => [r.id, r.amount, r.deleted])).toEqual([
      ["carry:bf:sadapay:2026-11", 0, false],
      ["carry:bf:nayapay:2026-11", 0, false],
    ]);
    expect(
      execute(
        november(),
        cmd("resetLedger", { tracking_start: "2026-11-15", confirm: "RESET" }),
        ctx(DEC2, true),
      ).error,
    ).toBe("invalid");
  });
  it("tracking start can't be changed with setSetting", () => {
    expect(
      execute(seeded(), cmd("setSetting", { key: "tracking_start", value: "2026-12-01" }), ctx()).error,
    ).toBe("invalid");
  });
});

describe("category breakdown", () => {
  // Car: Petrol 6,000 + Car wash 1,000 + 2,500 tagged directly with Car ("Other Car")
  const ds = withRows(seeded("2026-11-01"), {
    transactions: [
      txn({ occurred_at: "2026-11-03T10:00", amount: -600000, category_id: "car.petrol" }),
      txn({ occurred_at: "2026-11-04T10:00", amount: -100000, category_id: "car.carwash" }),
      txn({ occurred_at: "2026-11-04T12:00", amount: -250000, category_id: "car" }),
      prov({ occurred_at: "2026-11-05T12:00", amount: -50000, category_id: "car.petrol" }),
    ],
  });
  const NOW = "2026-11-15T12:00";
  it("splits into subcategories plus Other <Parent>, sorted by spend", () => {
    const b = categoryBreakdown(ds, "car", "2026-11", NOW);
    expect(b).toMatchObject({ total: 1000000, average: null, budget: null });
    expect(b.parts.map((p) => [p.id, p.name, p.spent, p.share])).toEqual([
      ["car.petrol", "Petrol", 650000, 0.65],
      ["car.__other", "Other Car", 250000, 0.25],
      ["car.carwash", "Car wash", 100000, 0.1],
    ]);
  });
  it("no Other bucket when nothing is tagged directly with the parent", () => {
    const only = withRows(seeded("2026-11-01"), {
      transactions: [txn({ occurred_at: "2026-11-03T10:00", amount: -600000, category_id: "car.petrol" })],
    });
    expect(categoryBreakdown(only, "car", "2026-11", NOW).parts.map((p) => p.id)).toEqual([
      "car.petrol",
      "car.carwash",
    ]);
  });
  it("card children include the Other bucket", () => {
    const card = categoryCards(ds, "2026-11", NOW).find((c) => c.category.id === "car");
    expect(card?.children.map((c) => [c.category.id, c.category.name, c.spent])).toEqual([
      ["car.petrol", "Petrol", 650000],
      ["car.__other", "Other Car", 250000],
      ["car.carwash", "Car wash", 100000],
    ]);
  });
  it("month detail: every day, change vs previous month", () => {
    const withDec = withRows(ds, {
      transactions: [txn({ occurred_at: "2026-12-01T10:00", amount: -500000, category_id: "car.petrol" })],
    });
    const d = categoryMonthDetail(withDec, "car", "2026-12", "2026-12-15T10:00");
    expect(d).toMatchObject({ month: "2026-12", total: 500000, prev_month_total: 1000000, change_pct: -50 });
    expect(d.daily).toHaveLength(31);
    expect(d.daily[0]).toEqual({ date: "2026-12-01", value: 500000 });
    expect(categoryMonthDetail(ds, "car", "2026-11", NOW).change_pct).toBeNull();
  });
});
