import { describe, expect, it } from "vitest";
import {
  categoryMonthDetail,
  detectRecurring,
  expectedCharges,
  netPosition,
  suggestOpeningBalance,
} from "../src/analytics.ts";
import { execute } from "../src/commands.ts";
import { budgetModel, project, suggestedSplit } from "../src/planning.ts";
import { matchProvisional } from "../src/reconcile.ts";
import type { Dataset } from "../src/types.ts";
import {
  apply,
  bal,
  cmd,
  cp,
  ctx,
  importCmd,
  parsed,
  prov,
  recurring,
  rowsOf,
  seeded,
  srow,
  txn,
  withOpening,
  withRows,
} from "./builders.ts";

const NOW = "2026-11-15T12:00";
const rs = (n: number) => n * 100;

describe("yearly fixed charges", () => {
  const domain = recurring("Domain", rs(12000), {
    cadence: "yearly",
    month_of_year: 3,
    category_id: "subscriptions.professional",
    kind: "subscription",
  });
  const ds = withRows(seeded("2026-11-01"), { recurring: [domain, recurring("iCloud", rs(900))] });
  it("plan as a sinking fund: amount ÷ 12 per month", () => {
    const m = budgetModel(ds, NOW);
    expect(m.committed).toBe(rs(1000 + 900));
    expect(m.lines.filter((l) => l.kind === "committed").map((l) => [l.label, l.amount])).toEqual([
      ["Domain (yearly ÷ 12, set aside monthly)", rs(1000)],
      ["iCloud", rs(900)],
    ]);
    expect(m.floor).toBe(rs(1900));
    expect(
      suggestedSplit(ds, NOW)
        .lines.slice(0, 2)
        .map((l) => [l.label, l.amount]),
    ).toEqual([
      ["Fixed charges from SadaPay (1)", rs(900)],
      ["Set aside for yearly charges (1)", rs(1000)],
    ]);
  });
  it("projection books the full charge in its month", () => {
    const p = project(ds, NOW, { horizon_months: 5 });
    expect(p.map((x) => [x.month, x.fixed])).toEqual([
      ["2026-12", rs(900)],
      ["2027-01", rs(900)],
      ["2027-02", rs(900)],
      ["2027-03", rs(12900)],
      ["2027-04", rs(900)],
    ]);
  });
  it("detectRecurring proposes yearly charges (≥ 2 payments 350–380 days apart)", () => {
    const pay = (on: string, amount: number) =>
      txn({
        account_id: "sadapay",
        occurred_at: `${on}T09:00`,
        amount: -amount,
        description: "Card payment NAMEHOST INC",
      });
    const d = withRows(seeded("2025-01-01"), {
      transactions: [pay("2025-03-04", rs(12000)), pay("2026-03-06", rs(12500))],
    });
    expect(detectRecurring(d)[0]).toMatchObject({
      key: "NAMEHOST INC",
      cadence: "yearly",
      month_of_year: 3,
      occurrences: 2,
    });
    const monthly = withRows(seeded(), {
      transactions: ["2026-07-03", "2026-08-02", "2026-09-03"].map((d2) => pay(d2, rs(900))),
    });
    expect(detectRecurring(monthly)[0]).toMatchObject({ cadence: "monthly", month_of_year: null });
  });
});

describe("expectedCharges", () => {
  const guard = cp("Guard Sahib");
  const base = (extra: Partial<Dataset> = {}) =>
    withRows(seeded("2026-11-01"), {
      counterparties: [guard],
      recurring: [
        recurring("Guard", rs(5000), {
          id: "r-guard",
          counterparty_id: guard.id,
          day_of_month: 1,
          kind: "bill",
        }),
        recurring("iCloud", rs(900), {
          id: "r-icloud",
          category_id: "subscriptions.essentials",
          day_of_month: 31,
          kind: "subscription",
        }),
        recurring("Electricity", rs(4000), {
          id: "r-elec",
          category_id: "bills.electricity",
          day_of_month: 20,
        }),
        recurring("Domain", rs(12000), { id: "r-dom", cadence: "yearly", month_of_year: 3, day_of_month: 5 }),
      ],
      ...extra,
    });
  const byId = (xs: ReturnType<typeof expectedCharges>) =>
    Object.fromEntries(xs.map((x) => [x.recurring.id, x]));

  it("due dates clamp to the month; yearly charges only in their month", () => {
    const e = byId(expectedCharges(base(), "2026-11", NOW));
    expect(Object.keys(e).sort()).toEqual(["r-elec", "r-guard", "r-icloud"]);
    expect(e["r-icloud"]?.due_date).toBe("2026-11-30");
    expect(expectedCharges(base(), "2027-03", NOW).map((x) => x.recurring.id)).toContain("r-dom");
  });
  it("statuses: paid by counterparty, missed after due+10, due from due−2, else upcoming", () => {
    const ds = base({
      transactions: [
        txn({
          account_id: "nayapay",
          occurred_at: "2026-11-02T10:00",
          amount: -rs(5200),
          counterparty_id: guard.id,
        }),
      ],
    });
    const e = byId(expectedCharges(ds, "2026-11", NOW));
    // paid from the other wallet (no same-wallet match), any amount for a counterparty match
    expect(e["r-guard"]).toMatchObject({ status: "paid", amount: rs(5200), due_date: "2026-11-01" });
    expect(e["r-elec"]?.status).toBe("upcoming"); // due 20 Nov, today 15 Nov
    expect(byId(expectedCharges(ds, "2026-11", "2026-11-18T09:00"))["r-elec"]?.status).toBe("due");
    expect(byId(expectedCharges(ds, "2026-11", "2026-11-30T09:00"))["r-elec"]?.status).toBe("due");
    expect(byId(expectedCharges(ds, "2026-11", "2026-12-01T09:00"))["r-guard"]?.status).toBe("paid");
    expect(byId(expectedCharges(ds, "2026-11", "2026-12-01T09:00"))["r-elec"]?.status).toBe("missed");
    expect(byId(expectedCharges(base(), "2026-11", NOW))["r-guard"]?.status).toBe("missed"); // due 1 Nov + 10 < 15 Nov
  });
  it("category match needs the amount within ±15% and the date within −7…+10 days", () => {
    const at = (on: string, amount: number) =>
      txn({
        account_id: "sadapay",
        occurred_at: `${on}T10:00`,
        amount: -amount,
        category_id: "bills.electricity",
      });
    const now = "2026-11-29T10:00";
    expect(
      byId(expectedCharges(base({ transactions: [at("2026-11-22", rs(4500))] }), "2026-11", now))["r-elec"]
        ?.status,
    ).toBe("paid");
    expect(
      byId(expectedCharges(base({ transactions: [at("2026-11-22", rs(4700))] }), "2026-11", now))["r-elec"]
        ?.status,
    ).toBe("due");
    expect(
      byId(expectedCharges(base({ transactions: [at("2026-11-12", rs(4000))] }), "2026-11", now))["r-elec"]
        ?.status,
    ).toBe("due");
  });
  it("a charge created from a transaction is paid by it", () => {
    const t = txn({
      id: "t-src",
      account_id: "sadapay",
      occurred_at: "2026-11-03T10:00",
      amount: -rs(700),
      description: "Card payment MUSICCO",
    });
    const ds = withRows(seeded("2026-11-01"), {
      transactions: [t],
      recurring: [recurring("MusicCo", rs(800), { day_of_month: 3, source_txn_id: "t-src" })],
    });
    expect(expectedCharges(ds, "2026-11", NOW)[0]).toMatchObject({
      status: "paid",
      matched_txn_id: "t-src",
      amount: rs(700),
    });
  });
  it("each transaction pays one charge; category detail shows the category's expected charges", () => {
    const ds = base({
      recurring: [
        recurring("Elec A", rs(4000), { id: "a", category_id: "bills.electricity", day_of_month: 10 }),
        recurring("Elec B", rs(4000), { id: "b", category_id: "bills.electricity", day_of_month: 12 }),
      ],
      transactions: [
        txn({
          account_id: "sadapay",
          occurred_at: "2026-11-11T10:00",
          amount: -rs(4000),
          category_id: "bills.electricity",
        }),
      ],
    });
    const paid = expectedCharges(ds, "2026-11", NOW).filter((e) => e.status === "paid");
    expect(paid.map((e) => e.recurring.id)).toEqual(["a"]);
    const bills = categoryMonthDetail(ds, "bills", "2026-11", NOW).expected.map((e) => e.recurring.id);
    expect(bills.sort()).toEqual(["a", "b"]);
  });
});

describe("upsertRecurring from a transaction", () => {
  const t = txn({
    id: "t1",
    account_id: "sadapay",
    occurred_at: "2026-11-04T10:00",
    amount: -rs(679),
    category_id: "subscriptions",
    counterparty_id: "cpx",
  });
  const ds = withRows(seeded("2026-11-01"), { transactions: [t] });
  const up = (args: Record<string, unknown>) =>
    cmd("upsertRecurring", {
      recurring_id: "r1",
      name: "MusicCo",
      account_id: "sadapay",
      category_id: null,
      counterparty_id: null,
      amount: rs(800),
      day_of_month: 4,
      active: true,
      ...args,
    } as never);
  it("fills counterparty/category from the source transaction; yearly month from its date", () => {
    const out = execute(ds, up({ source_txn_id: "t1", cadence: "yearly", kind: "subscription" }), ctx());
    expect(rowsOf(out.mutations, "recurring")[0]).toMatchObject({
      category_id: "subscriptions",
      counterparty_id: "cpx",
      cadence: "yearly",
      month_of_year: 11,
      kind: "subscription",
      source_txn_id: "t1",
    });
  });
  it("keeps existing cadence/kind/source when omitted; validates", () => {
    const d2 = apply(
      ds,
      execute(ds, up({ source_txn_id: "t1", cadence: "yearly", kind: "subscription" }), ctx()).mutations,
    );
    const again = rowsOf(execute(d2, up({ amount: rs(850) }), ctx()).mutations, "recurring")[0];
    expect(again).toMatchObject({
      amount: rs(850),
      cadence: "yearly",
      month_of_year: 11,
      kind: "subscription",
      source_txn_id: "t1",
    });
    expect(execute(ds, up({ cadence: "yearly" }), ctx()).error).toBe("invalid");
    expect(execute(ds, up({ source_txn_id: "nope" }), ctx()).error).toBe("invalid");
  });
});

describe("notification balances", () => {
  // SadaPay: opening unknown (b/f 0). A spend notification at 18:58 says the available balance is Rs 31,349.94.
  const spend = prov({
    id: "n1",
    account_id: "sadapay",
    source: "notification",
    occurred_at: "2026-11-08T18:58",
    amount: -67900,
    description: "MusicCoP48F8F2310 Stockholm SWE",
  });
  const stated = bal("sadapay", "2026-11-08T18:58", 3134994, { source: "notification" });
  const ds = withRows(seeded("2026-11-01"), { transactions: [spend], balances: [stated] });
  const sada = (d: Dataset) => netPosition(d, NOW).wallets.find((w) => w.account_id === "sadapay");

  it("suggests the opening that makes the ledger agree", () => {
    expect(suggestOpeningBalance(ds, "sadapay")).toEqual({
      amount: 3202894,
      from: "notification 8 Nov 18:58",
    });
    expect(sada(ds)).toMatchObject({
      unaccounted: 3202894,
      unaccounted_hint: "Opening balance not set — set SadaPay's 1 Nov opening to Rs 32,028.94?",
    });
    expect(suggestOpeningBalance(ds, "nayapay")).toBeNull();
  });
  it("once the opening is set: no suggestion, and a later shortfall is explained as fees/tax", () => {
    const set = withOpening(ds, { sadapay: 3202894 });
    expect(suggestOpeningBalance(set, "sadapay")).toBeNull();
    expect(sada(set)).toMatchObject({ unaccounted: 0, unaccounted_hint: null });
    const later = withRows(set, {
      balances: [bal("sadapay", "2026-11-09T09:00", 3134994 - 12100, { source: "notification" })],
    });
    expect(sada(later)).toMatchObject({
      unaccounted: -12100,
      unaccounted_hint:
        "Rs 121 not in your notifications yet — likely fees or tax; your next statement will show it",
    });
    const manual = withRows(set, { balances: [bal("sadapay", "2026-11-09T09:00", 3134994 - 12100)] });
    expect(sada(manual)?.unaccounted_hint).toBe(
      "Rs 121 spent that isn't recorded yet — add it, or wait for the statement",
    );
  });
});

describe("tolerant statement matching", () => {
  const notif = prov({
    id: "n1",
    account_id: "sadapay",
    source: "notification",
    occurred_at: "2026-11-08T18:58",
    amount: -67900,
    description: "MusicCoP48F8F2310 Stockholm SWE",
  });
  const row = (amount: number, description = "MUSICCO P48F8F2310 STOCKHOLM", ext = "sada:h1") =>
    srow(ext, "2026-11-08T19:01", amount, description);

  it("matches when the statement charges up to 40% more for the same merchant; reports the correction", () => {
    const ds = withRows(withOpening(seeded("2026-11-01"), { sadapay: 3202894 }), { transactions: [notif] });
    const out = execute(
      ds,
      importCmd(
        parsed("sadapay", "2026-11-01", "2026-11-14", [
          row(-80000),
          srow("sada:h2", "2026-11-09T02:00", -12100, "International transaction tax"),
        ]),
      ),
      ctx(),
    );
    expect(out.result).toMatchObject({
      matched: 1,
      added: 1,
      disputed: 0,
      corrected: [{ txn_id: "n1", from: -67900, to: -80000 }],
      fees: [{ external_id: "sada:h2", near_txn_id: "n1" }],
    });
    const after = apply(ds, out.mutations);
    expect(after.transactions.find((t) => t.id === "n1")).toMatchObject({
      status: "verified",
      amount: -80000,
      description: "MUSICCO P48F8F2310 STOCKHOLM",
    });
    expect(after.transactions.find((t) => t.external_id === "sada:h2")).toMatchObject({
      flow: "fee",
      category_id: "fees",
    });
  });
  it("exact amounts still win; too large a difference or another merchant doesn't match", () => {
    expect(matchProvisional([{ ...row(-67900), account_id: "sadapay" }], [notif])).toEqual([
      { external_id: "sada:h1", txn_id: "n1" },
    ]);
    expect(matchProvisional([{ ...row(-95100), account_id: "sadapay" }], [notif])).toEqual([]); // > 1.40×
    expect(matchProvisional([{ ...row(-60000), account_id: "sadapay" }], [notif])).toEqual([]); // less than notified
    expect(
      matchProvisional([{ ...row(-80000, "POS Purchase OTHER SHOP"), account_id: "sadapay" }], [notif]),
    ).toEqual([]);
    expect(matchProvisional([{ ...row(-80000), account_id: "sadapay" }], [notif])).toEqual([
      { external_id: "sada:h1", txn_id: "n1", corrected: true },
    ]);
  });
});
