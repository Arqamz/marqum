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
  withOpening,
  withRows,
} from "./builders.ts";

const NOW = "2026-11-08T10:00";
const item = (ds: Dataset, id: string, now = NOW) =>
  closeChecklist(ds, "2026-10", now).items.find((i) => i.id === id);

/** October = first tracked month, fully covered by both wallets' statements, verified and categorised. */
function closable(): Dataset {
  return withRows(withOpening(seeded("2026-10-01"), { sadapay: 100000, nayapay: 5000 }), {
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
    expect(c.items.find((i) => i.id === "reconcile_nayapay")?.label).toBe(
      "NayaPay ledger matches the statement closing",
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
  it("blocks when the ledger closing disagrees with a statement closing by more than Rs 1", () => {
    const ds = withRows(closable(), {
      transactions: [
        txn({ account_id: "sadapay", occurred_at: "2026-10-25T10:00", amount: -150, category_id: "misc" }),
      ],
    });
    expect(item(ds, "reconcile_sadapay")).toMatchObject({
      ok: false,
      label: "SadaPay ledger Rs 799 ≠ statement closing Rs 800 on 31 Oct (off by Rs 2)",
    });
    const tiny = withRows(closable(), {
      transactions: [
        txn({ account_id: "sadapay", occurred_at: "2026-10-25T10:00", amount: -100, category_id: "misc" }),
      ],
    });
    expect(item(tiny, "reconcile_sadapay")?.ok).toBe(true);
  });
  it("needs an established opening: statement/set b/f, or any balance assertion", () => {
    const base = closable();
    const unknown = {
      ...base,
      statements: base.statements.map((s) =>
        s.account_id === "sadapay" ? { ...s, opening: null, closing: null } : s,
      ),
      transactions: base.transactions.map((t) =>
        t.flow === "carry" && t.account_id === "sadapay" ? { ...t, reason: null } : t,
      ),
    };
    expect(item(unknown, "closing_sadapay")).toMatchObject({
      ok: false,
      label: "SadaPay opening balance unknown — set it or record your current balance",
    });
    // SadaPay statements carry no balances: a manual balance (any time after tracking start) is enough
    const manual = withRows(unknown, { balances: [bal("sadapay", "2026-11-05T10:00", 80000)] });
    expect(item(manual, "closing_sadapay")?.ok).toBe(true);
    expect(closeChecklist(manual, "2026-10", NOW).can_close).toBe(true);
  });
  it("warns when a manual balance in the month doesn't match the ledger", () => {
    const ds = withRows(closable(), { balances: [bal("nayapay", "2026-10-31T20:00", 1500)] });
    const i = item(ds, "unaccounted_nayapay");
    expect(i).toMatchObject({
      ok: false,
      severity: "warn",
      label: "NayaPay: Rs 5 unaccounted vs the balance you entered on 31 Oct",
    });
    expect(closeChecklist(ds, "2026-10", NOW).can_close).toBe(true);
  });
  it("months before tracking start have nothing to close", () => {
    const c = closeChecklist(closable(), "2026-09", NOW);
    expect(c).toMatchObject({ can_close: false });
    expect(c.items).toEqual([
      expect.objectContaining({
        id: "before_tracking",
        label: "Sep 2026 is before tracking started (1 Oct 2026) — nothing to close",
      }),
    ]);
    expect(execute(closable(), cmd("closeMonth", { month: "2026-09" }), ctx(NOW)).error).toBe("invalid");
  });
  it("a month can only be closed after the previous one", () => {
    const nov = closeChecklist(closable(), "2026-11", "2026-12-02T10:00");
    expect(nov.items.find((i) => i.id === "previous_closed")).toMatchObject({
      ok: false,
      label: "Close Oct 2026 first",
    });
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
    expect(c.items.filter((i) => i.severity === "warn" && !i.ok).map((i) => i.id)).toEqual([
      "reasons",
      "recurring",
      "loans",
    ]);
    expect(c.items.find((i) => i.id === "reasons")?.label).toBe(
      "Add a reason to 1 transfer to people (Rs 1,500)",
    );
    expect(c.items.find((i) => i.id === "recurring")?.label).toBe(
      "1 recurring payment not seen: iCloud (Rs 900)",
    );
    expect(c.items.find((i) => i.id === "loans")?.label).toBe(
      "Loan installment not seen: Bicycle (Rs 9,000)",
    );
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
    expect(doc.transactions).toHaveLength(5); // 3 + the two b/f rows
    expect(doc.categories.map((c: { id: string }) => c.id)).toEqual(["bills", "bills.electricity", "food"]);
  });
  it("changes when month content changes, not when other months change", async () => {
    const a = closable();
    const base = await buildSnapshot(a, "2026-10");
    const other = withRows(a, { transactions: [txn({ occurred_at: "2026-11-02T10:00", amount: -1 })] });
    expect((await buildSnapshot(other, "2026-10")).sha256).toBe(base.sha256);
    const t0 = a.transactions.find((t) => t.flow !== "carry");
    const changed = apply(a, t0 ? [{ table: "transactions", row: { ...t0, reason: "edited" } }] : []);
    expect((await buildSnapshot(changed, "2026-10")).sha256).not.toBe(base.sha256);
  });
});
