import { describe, expect, it } from "vitest";
import {
  datasetFromRecords,
  mutationToRecord,
  pullPage,
  type RowRecord,
  recordToRow,
} from "../src/lib/store.ts";

const rec = (
  tbl: string,
  id: string,
  version: number,
  data: Record<string, unknown> = {},
  deleted = 0,
): RowRecord => ({
  tbl,
  id,
  version,
  deleted,
  data: JSON.stringify({ id, ...data }),
});

describe("mutation → row mapping", () => {
  it("moves version/deleted out of the JSON", () => {
    const r = mutationToRecord({
      table: "goals",
      row: { id: "g1", name: "Bike", version: 7, deleted: false },
    });
    expect(r).toEqual({
      tbl: "goals",
      id: "g1",
      deleted: 0,
      data: JSON.stringify({ id: "g1", name: "Bike" }),
    });
  });

  it("maps tombstones", () => {
    const r = mutationToRecord({ table: "rules", row: { id: "r1", deleted: true } });
    expect(r.deleted).toBe(1);
    expect(recordToRow({ ...r, version: 3 })).toEqual({ id: "r1", version: 3, deleted: true });
  });

  it("round-trips through a record", () => {
    const row = { id: "t1", amount: -500, reason: null };
    const r = mutationToRecord({ table: "transactions", row });
    expect(recordToRow({ ...r, version: 12 })).toEqual({ ...row, version: 12, deleted: false });
  });

  it("builds a dataset from live rows only", () => {
    const ds = datasetFromRecords([
      rec("accounts", "sadapay", 1, { name: "SadaPay" }),
      rec("goals", "g1", 2, {}, 1),
      rec("unknown_table", "x", 3),
    ]);
    expect(ds.accounts).toEqual([{ id: "sadapay", name: "SadaPay", version: 1, deleted: false }]);
    expect(ds.goals).toEqual([]);
    expect(ds.transactions).toEqual([]);
  });
});

describe("pull paging", () => {
  it("groups by table and reports the last version", () => {
    const page = pullPage(
      [rec("accounts", "a", 5), rec("settings", "s", 6), rec("accounts", "b", 7, {}, 1)],
      4,
      10,
    );
    expect(page.more).toBe(false);
    expect(page.version).toBe(7);
    expect(Object.keys(page.changes)).toEqual(["accounts", "settings"]);
    expect(page.changes.accounts?.map((r) => [r.id, r.deleted])).toEqual([
      ["a", false],
      ["b", true],
    ]);
  });

  it("flags more pages when the query returned limit + 1 rows", () => {
    const rows = [1, 2, 3, 4].map((v) => rec("goals", `g${v}`, v));
    const page = pullPage(rows, 0, 3);
    expect(page.more).toBe(true);
    expect(page.version).toBe(3);
    expect(page.changes.goals).toHaveLength(3);
  });

  it("keeps the client's version when nothing changed", () => {
    expect(pullPage([], 42, 10)).toEqual({ version: 42, changes: {}, more: false });
  });
});
