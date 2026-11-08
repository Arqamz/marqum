import { describe, expect, it } from "vitest";
import { buildSnapshot, closeChecklist } from "../src/close.ts";
import { execute } from "../src/commands.ts";
import type { Dataset } from "../src/types.ts";
import {
  apply,
  bal,
  cmd,
  ctx,
  loan,
  prov,
  recurring,
  rowsOf,
  seeded,
  stmt,
  txn,
  withRows,
} from "./builders.ts";

const NOW = "2026-11-08T10:00";
const item = (ds: Dataset, id: string, now = NOW) =>
  closeChecklist(ds, "2026-10", now).items.find((i) => i.id === id);

/** October fully covered by both wallets' statements, everything verified and categorised. */
function closable(): Dataset {
  return withRows(seeded(), {
    statements: [
      stmt("sadapay", "2026-10-01", "2026-10-31", { opening: 100000, closing: 80000 }),
      stmt("nayapay", "2026-10-01", "2026-10-15", { opening: 5000, closing: 3000 }),
      stmt("nayapay", "2026-10-16", "2026-10-31", { opening: 3000, closing: 1000 }),
    ],
    transactions: [
      txn({
        account_id: "sadapay",
        occurred_at: "2026-10-05T10:00",
        amount: -20000,
        category_id: "bills.electricity",
      }),
      txn({
        occurred_at: "2026-10-10T10:00",
        amount: -2000,
        category_id: "food",
        description: "POS Purchase CAFE ONE",
      }),
      txn({
        occurred_at: "2026-10-20T10:00",
        amount: -2000,
        category_id: "food",
        description: "Outgoing fund transfer to Danish",
        reason: "lunch",
      }),
    ],
  });
}

describe("closeChecklist", () => {
  it("passes for a clean month and allows closeMonth", () => {
    const c = closeChecklist(closable(), "2026-10", NOW);
    expect(c.closable_from).toBe("2026-11-01");
    expect(c.items.filter((i) => !i.ok)).toEqual([]);
    expect(c.can_close).toBe(true);
    expect(c.items.find((i) => i.id === "closing_sadapay")?.label).toBe(
      "SadaPay closing balance on 31 Oct: Rs 800",
    );
    expect(c.items.find((i) => i.id === "statements_nayapay")?.label).toBe(
      "NayaPay statements cover 1–31 Oct",
    );
    const out = execute(closable(), cmd("closeMonth", { month: "2026-10" }), ctx(NOW));
    expect(rowsOf(out.mutations, "months")[0]).toMatchObject({
      id: "2026-10",
      status: "closed",
      closed_at: NOW,
      snapshot_key: null,
      snapshot_sha256: null,
    });
  });
  it("can't close before the month has ended", () => {
    const i = item(closable(), "month_ended", "2026-10-31T22:00");
    expect(i).toMatchObject({ ok: false, label: "Month ends 31 Oct — close from 1 Nov" });
    expect(closeChecklist(closable(), "2026-10", "2026-10-31T22:00").can_close).toBe(false);
  });
  it("blocks on missing statement coverage", () => {
    const ds = {
      ...closable(),
      statements: closable().statements.filter((s) => s.period_from !== "2026-10-16"),
    };
    expect(item(ds, "statements_nayapay")).toMatchObject({
      ok: false,
      label: "NayaPay statement missing for 16–31 Oct",
      action: "/statements?account=nayapay&month=2026-10",
    });
  });
  it("blocks on failing checks and broken chains", () => {
    const base = closable();
    const ds = {
      ...base,
      statements: base.statements.map((s) =>
        s.period_from === "2026-10-16"
          ? { ...s, opening: 2000, checks: [{ ok: false, label: "Totals don't add up" }] }
          : s,
      ),
    };
    const i = item(ds, "statement_checks");
    expect(i).toMatchObject({ ok: false, label: "Fix 2 statement problems" });
    expect(i?.detail).toContain("NayaPay 16–31 Oct: Totals don't add up");
    expect(i?.detail).toContain("NayaPay: closing Rs 30 on 15 Oct ≠ opening Rs 20 on 16 Oct");
    const within = {
      ...base,
      statements: base.statements.map((s) => (s.period_from === "2026-10-16" ? { ...s, opening: 3050 } : s)),
    };
    expect(item(within, "statement_checks")?.ok).toBe(true);
  });
  it("blocks on unverified and uncategorised spend, with counts and amounts", () => {
    const ds = withRows(closable(), {
      transactions: [
        prov({ occurred_at: "2026-10-30T10:00", amount: -50000 }),
        txn({ occurred_at: "2026-10-29T10:00", amount: -30000, category_id: null }),
        txn({ occurred_at: "2026-10-29T11:00", amount: 30000, flow: "income", category_id: null }),
      ],
    });
    expect(item(ds, "unverified")).toMatchObject({
      ok: false,
      label: "Resolve 1 unverified transaction (Rs 500)",
      action: "/activity?month=2026-10&filter=unverified",
    });
    // the provisional row is spend without a category too
    expect(item(ds, "uncategorised")).toMatchObject({
      ok: false,
      label: "Categorise 2 transactions (Rs 800)",
      action: "/activity?month=2026-10&filter=untagged",
    });
  });
  it("closing balance is derived from a statement extending past month end, else blocks", () => {
    const ds = withRows(seeded(), {
      statements: [stmt("sadapay", "2026-10-01", "2026-11-07", { closing: 50000 })],
      transactions: [txn({ account_id: "sadapay", occurred_at: "2026-11-03T10:00", amount: -10000 })],
    });
    expect(item(ds, "closing_sadapay")?.label).toBe("SadaPay closing balance on 31 Oct: Rs 600");
    expect(item(ds, "closing_nayapay")).toMatchObject({
      ok: false,
      label: "NayaPay closing balance on 31 Oct unknown — import a statement covering it",
    });
    const next = withRows(seeded(), {
      statements: [stmt("nayapay", "2026-11-01", "2026-11-07", { opening: 7000 })],
    });
    expect(item(next, "closing_nayapay")?.label).toBe("NayaPay closing balance on 31 Oct: Rs 70");
  });
  it("SadaPay with no statement balances: closing derived from a manual entry after month end", () => {
    const ds = withRows(seeded(), {
      statements: [stmt("sadapay", "2026-10-01", "2026-10-31")],
      transactions: [
        txn({ account_id: "sadapay", occurred_at: "2026-10-20T10:00", amount: -5000 }),
        txn({ account_id: "sadapay", occurred_at: "2026-11-03T10:00", amount: -20000 }),
        prov({ account_id: "sadapay", occurred_at: "2026-11-06T10:00", amount: 1000 }),
      ],
      balances: [bal("sadapay", "2026-11-07T09:00", 100000)],
    });
    // 1,000 = x − 200 + 10 → x = 1,190
    expect(item(ds, "closing_sadapay")).toMatchObject({
      ok: true,
      label: "SadaPay closing balance on 31 Oct: Rs 1,190",
    });
  });
  it("SadaPay closing derived forward from a manual entry inside a covered month", () => {
    const ds = withRows(seeded(), {
      statements: [stmt("sadapay", "2026-10-01", "2026-10-31")],
      balances: [bal("sadapay", "2026-10-02T10:00", 100000), bal("sadapay", "2026-11-07T09:00", 1)],
      transactions: [txn({ account_id: "sadapay", occurred_at: "2026-10-20T10:00", amount: -5000 })],
    });
    expect(item(ds, "closing_sadapay")?.label).toBe("SadaPay closing balance on 31 Oct: Rs 950");
  });
  it("SadaPay closing unknown without any anchor, or when statements don't cover the month", () => {
    const noAnchor = withRows(seeded(), { statements: [stmt("sadapay", "2026-10-01", "2026-10-31")] });
    expect(item(noAnchor, "closing_sadapay")?.ok).toBe(false);
    const gap = withRows(seeded(), {
      statements: [stmt("sadapay", "2026-10-01", "2026-10-20")],
      balances: [bal("sadapay", "2026-11-07T09:00", 100000)],
    });
    expect(item(gap, "closing_sadapay")?.ok).toBe(false);
  });
  it("a whole month closes with SadaPay statements that carry no balances", () => {
    const base = closable();
    const ds = withRows(
      {
        ...base,
        statements: base.statements.map((s) =>
          s.account_id === "sadapay" ? { ...s, opening: null, closing: null } : s,
        ),
      },
      { balances: [bal("sadapay", "2026-11-05T10:00", 80000)] },
    );
    expect(closeChecklist(ds, "2026-10", NOW).can_close).toBe(true);
  });
  it("warns (not blocks) on person transfers without reasons, unseen recurring and unseen loan installments", () => {
    const ds = withRows(closable(), {
      transactions: [
        txn({
          occurred_at: "2026-10-21T10:00",
          amount: -150000,
          category_id: "misc",
          description: "Outgoing fund transfer to Ali Khan",
        }),
      ],
      recurring: [
        recurring("iCloud", 90000, { category_id: "subscriptions.icloud" }),
        recurring("Electricity", 20000, { category_id: "bills.electricity" }),
      ],
      loans: [
        loan({ purpose: "Bicycle", principal: 9000000, installment: 900000, started_on: "2026-08-01" }),
      ],
    });
    const c = closeChecklist(ds, "2026-10", NOW);
    expect(c.can_close).toBe(true);
    expect(c.items.find((i) => i.id === "reasons")).toMatchObject({
      ok: false,
      severity: "warn",
      label: "Add a reason to 1 transfer to people (Rs 1,500)",
    });
    expect(c.items.find((i) => i.id === "recurring")).toMatchObject({
      ok: false,
      label: "1 recurring payment not seen: iCloud (Rs 900)",
    });
    expect(c.items.find((i) => i.id === "loans")).toMatchObject({
      ok: false,
      label: "Loan installment not seen: Bicycle (Rs 9,000)",
    });
  });
});

describe("buildSnapshot", () => {
  it("is deterministic regardless of row order and versions", async () => {
    const a = closable();
    const b = {
      ...a,
      transactions: [...a.transactions].reverse().map((t) => ({ ...t, version: 99 })),
      statements: [...a.statements].reverse(),
    };
    const sa = await buildSnapshot(a, "2026-10");
    const sb = await buildSnapshot(b, "2026-10");
    expect(sa.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(sb).toEqual(sa);
    expect(sa.json).not.toContain('"version"');
    const doc = JSON.parse(sa.json);
    expect(Object.keys(doc)).toEqual([...Object.keys(doc)].sort());
    expect(doc.transactions).toHaveLength(3);
    expect(doc.categories.map((c: { id: string }) => c.id)).toEqual(["bills", "bills.electricity", "food"]);
  });
  it("changes when month content changes, not when other months change", async () => {
    const a = closable();
    const base = await buildSnapshot(a, "2026-10");
    const other = withRows(a, { transactions: [txn({ occurred_at: "2026-11-02T10:00", amount: -1 })] });
    expect((await buildSnapshot(other, "2026-10")).sha256).toBe(base.sha256);
    const t0 = a.transactions[0];
    const changed = apply(a, t0 ? [{ table: "transactions", row: { ...t0, reason: "edited" } }] : []);
    expect((await buildSnapshot(changed, "2026-10")).sha256).not.toBe(base.sha256);
  });
});
